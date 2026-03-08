// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义渗透流水线主工作流编排逻辑：阶段推进、并行分组、重试策略与状态汇总。
 * 该文件决定整个系统的执行时序与容错行为。
 */

/**
 * Temporal workflow for Lumin pentest pipeline.
 * Lumin 渗透测试流水线的 `Temporal` 主工作流。
 *
 * Orchestrates the penetration testing workflow:
 * 负责按既定顺序组织渗透测试流程：
 * 1. Pre-Reconnaissance (sequential)
 * 1. 预侦察阶段（串行）
 * 2. Reconnaissance (sequential)
 * 2. 侦察阶段（串行）
 * 3-4. Vulnerability + Exploitation (5 pipelined pairs in parallel)
 * 3-4. 漏洞分析与利用（五组流水线并行）
 *      Each pair: vuln agent → queue check → conditional exploit
 *      每组流程：`vuln` 代理 → 队列检查 → 按条件执行 `exploit`
 *      No synchronization barrier - exploits start when their vuln finishes
 *      无全局同步屏障，某条 `vuln` 完成后其 `exploit` 可立即开始
 * 5. Reporting (sequential)
 * 5. 报告阶段（串行）
 *
 * Features:
 * 关键特性：
 * - Queryable state via getProgress
 * - 通过 `getProgress` 查询实时状态
 * - Automatic retry with backoff for transient/billing errors
 * - 对瞬时错误与计费异常采用退避重试
 * - Non-retryable classification for permanent errors
 * - 对永久性错误直接标记为不可重试
 * - Audit correlation via workflowId
 * - 通过 `workflowId` 关联审计链路
 * - Graceful failure handling: pipelines continue if one fails
 * - 单条流水线失败时，其余流水线继续执行
 *
 *
 * 本工作流是全局编排入口，按“先串后并”的方式执行各代理任务：
 * - `pre-recon` 与 `recon` 串行，保证上下文完整；
 * - 五组 `vuln`→`exploit` 采用并行流水线，单组内先判定后利用；
 * - `reporting` 收口产出最终报告。
 */

import {
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities.js';
import type { ActivityInput } from './activities.js';
import {
  getProgress,
  type PipelineInput,
  type PipelineState,
  type PipelineProgress,
  type PipelineSummary,
  type VulnExploitPipelineResult,
  type AgentMetrics,
} from './shared.js';
import type { VulnType } from '../queue-validation.js';
import chalk from 'chalk';

// Retry configuration for production (long intervals for billing recovery)
// 生产模式优先稳定性，对计费与限流类错误给足恢复时间窗口。
const PRODUCTION_RETRY = {
  initialInterval: '5 minutes',
  maximumInterval: '30 minutes',
  backoffCoefficient: 2,
  maximumAttempts: 50,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'PermissionError',
    'InvalidRequestError',
    'RequestTooLargeError',
    'ConfigurationError',
    'InvalidTargetError',
    'ExecutionLimitError',
  ],
};

// Retry configuration for pipeline testing (fast iteration)
// 流水线测试模式缩短重试间隔，提升验证反馈速度。
const TESTING_RETRY = {
  initialInterval: '10 seconds',
  maximumInterval: '30 seconds',
  backoffCoefficient: 2,
  maximumAttempts: 5,
  nonRetryableErrorTypes: PRODUCTION_RETRY.nonRetryableErrorTypes,
};

// Activity proxy with production retry configuration (default)
// 默认 `activity` 代理，适用于真实任务执行。
const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '60 minutes', // Extended for sub-agent execution (SDK blocks event loop during Task tool calls)
  retry: PRODUCTION_RETRY,
});

// Activity proxy with testing retry configuration (fast)
// 测试代理，减少等待时间，便于快速迭代。
const testActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 minutes', // Extended for sub-agent execution in testing
  retry: TESTING_RETRY,
});

/**
 * Compute aggregated metrics from the current pipeline state.
 * 从当前流水线状态汇总指标。
 * Called on both success and failure to provide partial metrics.
 * 无论成功或失败都会计算摘要，便于审计与排障。
 *
 * 用途：汇总当前状态中的成本、轮次与耗时。
 * 关键参数：`state` 提供阶段状态与各代理指标。
 * 返回值：返回可序列化的汇总对象。
 * 失败分支：本函数只做内存计算，不抛出业务异常。
 */
function computeSummary(state: PipelineState): PipelineSummary {
  const metrics = Object.values(state.agentMetrics);
  return {
    totalCostUsd: metrics.reduce((sum, m) => sum + (m.costUsd ?? 0), 0),
    totalDurationMs: Date.now() - state.startTime,
    totalTurns: metrics.reduce((sum, m) => sum + (m.numTurns ?? 0), 0),
    agentCount: state.completedAgents.length,
  };
}

export async function pentestPipelineWorkflow(
  input: PipelineInput
): Promise<PipelineState> {
  const { workflowId } = workflowInfo();

  // Select activity proxy based on testing mode
  // 根据测试模式选择 `activity` 代理。
  // Pipeline testing uses fast retry intervals (10s) for quick iteration
  // 依据输入模式选择不同重试策略的 `activity` 代理。
  const a = input.pipelineTestingMode ? testActs : acts;

  // Workflow state (queryable)
  // 可查询状态对象，供查询接口实时读取进度。
  const state: PipelineState = {
    status: 'running',
    currentPhase: null,
    currentAgent: null,
    completedAgents: [],
    failedAgent: null,
    error: null,
    startTime: Date.now(),
    agentMetrics: {},
    summary: null,
  };

  // Register query handler for real-time progress inspection
  // 向外暴露 getProgress 查询，返回运行中快照而非最终结果。
  setHandler(getProgress, (): PipelineProgress => ({
    ...state,
    workflowId,
    elapsedMs: Date.now() - state.startTime,
  }));

  // Build ActivityInput with required workflowId for audit correlation
  // 构建包含 workflowId 的 ActivityInput，保证审计可关联。
  // Activities require workflowId (non-optional), PipelineInput has it optional
  // `Activity` 侧要求 `workflowId` 必填，而 `PipelineInput` 中为可选字段。
  // Use spread to conditionally include optional properties (exactOptionalPropertyTypes)
  // 将可选输入规范化为 `ActivityInput`，确保审计链路有稳定 `workflowId`。
  const activityInput: ActivityInput = {
    webUrl: input.webUrl,
    repoPath: input.repoPath,
    workflowId,
    ...(input.configPath !== undefined && { configPath: input.configPath }),
    ...(input.outputPath !== undefined && { outputPath: input.outputPath }),
    ...(input.pipelineTestingMode !== undefined && {
      pipelineTestingMode: input.pipelineTestingMode,
    }),
  };

  try {
    // === Phase 1: Pre-Reconnaissance ===
    // 前置侦察，生成后续阶段依赖的基础上下文。
    state.currentPhase = 'pre-recon';
    state.currentAgent = 'pre-recon';
    await a.logPhaseTransition(activityInput, 'pre-recon', 'start');
    state.agentMetrics['pre-recon'] =
      await a.runPreReconAgent(activityInput);
    state.completedAgents.push('pre-recon');
    await a.logPhaseTransition(activityInput, 'pre-recon', 'complete');

    // === Phase 2: Reconnaissance ===
    // 补充攻击面映射，准备漏洞专项分析输入。
    state.currentPhase = 'recon';
    state.currentAgent = 'recon';
    await a.logPhaseTransition(activityInput, 'recon', 'start');
    state.agentMetrics['recon'] = await a.runReconAgent(activityInput);
    state.completedAgents.push('recon');
    await a.logPhaseTransition(activityInput, 'recon', 'complete');

    // === Phases 3-4: Vulnerability Analysis + Exploitation (Pipelined) ===
    // 第 3-4 阶段：漏洞分析与利用按流水线并行执行。
    // Each vuln type runs as an independent pipeline:
    // 每个 `vuln` 类型独立运行为一条流水线。
    // vuln agent → queue check → conditional exploit agent
    // 流程为：`vuln` 代理 → 队列检查 → 条件触发 `exploit` 代理。
    // This eliminates the synchronization barrier between phases - each exploit
    // 该设计移除阶段同步屏障，使 `exploit` 无需等待全部 `vuln` 完成。
    // starts immediately when its vuln agent finishes, not waiting for all.
    // 取消“全部漏洞阶段完成后再利用”的屏障，缩短总执行时间。
    state.currentPhase = 'vulnerability-exploitation';
    state.currentAgent = 'pipelines';
    await a.logPhaseTransition(activityInput, 'vulnerability-exploitation', 'start');

    // Helper: Run a single vuln→exploit pipeline
    // 单条流水线模板：漏洞分析 -> 队列判定 -> 条件利用。
    async function runVulnExploitPipeline(
      vulnType: VulnType,
      runVulnAgent: () => Promise<AgentMetrics>,
      runExploitAgent: () => Promise<AgentMetrics>
    ): Promise<VulnExploitPipelineResult> {
      // Step 1: Run vulnerability agent
      // 先产出漏洞分析及候选利用队列。
      const vulnMetrics = await runVulnAgent();

      // Step 2: Check exploitation queue (starts immediately after vuln)
      // 读取队列文件，决定是否进入 `exploit` 阶段。
      const decision = await a.checkExploitationQueue(activityInput, vulnType);

      // Step 3: Conditionally run exploit agent
      // 仅在 shouldExploit=true 时执行，避免无效模型调用。
      let exploitMetrics: AgentMetrics | null = null;
      if (decision.shouldExploit) {
        exploitMetrics = await runExploitAgent();
      }

      return {
        vulnType,
        vulnMetrics,
        exploitMetrics,
        exploitDecision: {
          shouldExploit: decision.shouldExploit,
          vulnerabilityCount: decision.vulnerabilityCount,
        },
        error: null,
      };
    }

    // Run all 5 pipelines in parallel with graceful failure handling
    // 并行运行 5 条流水线，并启用优雅失败策略。
    // Promise.allSettled ensures other pipelines continue if one fails
    // 单条流水线失败不会拖垮全局，最大化保留可用结果。
    const pipelineResults = await Promise.allSettled([
      runVulnExploitPipeline(
        'injection',
        () => a.runInjectionVulnAgent(activityInput),
        () => a.runInjectionExploitAgent(activityInput)
      ),
      runVulnExploitPipeline(
        'xss',
        () => a.runXssVulnAgent(activityInput),
        () => a.runXssExploitAgent(activityInput)
      ),
      runVulnExploitPipeline(
        'auth',
        () => a.runAuthVulnAgent(activityInput),
        () => a.runAuthExploitAgent(activityInput)
      ),
      runVulnExploitPipeline(
        'ssrf',
        () => a.runSsrfVulnAgent(activityInput),
        () => a.runSsrfExploitAgent(activityInput)
      ),
      runVulnExploitPipeline(
        'authz',
        () => a.runAuthzVulnAgent(activityInput),
        () => a.runAuthzExploitAgent(activityInput)
      ),
    ]);

    // Aggregate results from all pipelines
    // 将每条流水线的 `vuln` 与 `exploit` 指标回填到统一 `state`。
    const failedPipelines: string[] = [];
    for (const result of pipelineResults) {
      if (result.status === 'fulfilled') {
        const { vulnType, vulnMetrics, exploitMetrics } = result.value;

        // Record vuln agent metrics
        // 记录漏洞阶段指标并标记完成。
        if (vulnMetrics) {
          state.agentMetrics[`${vulnType}-vuln`] = vulnMetrics;
          state.completedAgents.push(`${vulnType}-vuln`);
        }

        // Record exploit agent metrics (if it ran)
        // 仅 `exploit` 实际执行时才写入对应指标。
        if (exploitMetrics) {
          state.agentMetrics[`${vulnType}-exploit`] = exploitMetrics;
          state.completedAgents.push(`${vulnType}-exploit`);
        }
      } else {
        // Pipeline failed - log error but continue with others
        // 失败信息收集到列表，后续统一提示。
        const errorMsg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failedPipelines.push(errorMsg);
      }
    }

    // Log any pipeline failures (workflow continues despite failures)
    // 记录失败摘要但不改为 failed，保持“部分成功可交付”。
    if (failedPipelines.length > 0) {
      console.log(
        `⚠️ ${failedPipelines.length} pipeline(s) failed:`,
        failedPipelines
      );
    }

    // Update phase markers
    // 并行流水线收口后更新阶段状态，进入报告阶段。
    state.currentPhase = 'exploitation';
    state.currentAgent = null;
    await a.logPhaseTransition(activityInput, 'vulnerability-exploitation', 'complete');

    // === Phase 5: Reporting ===
    // 汇总漏洞与利用证据并生成高层可读报告。
    state.currentPhase = 'reporting';
    state.currentAgent = 'report';
    await a.logPhaseTransition(activityInput, 'reporting', 'start');

    // First, assemble the concatenated report from exploitation evidence files
    // 先汇总证据，再让 report agent 做高层总结与润色。
    await a.assembleReportActivity(activityInput);

    // Then run the report agent to add executive summary and clean up
    // 报告代理负责执行摘要与最终整理。
    state.agentMetrics['report'] = await a.runReportAgent(activityInput);
    state.completedAgents.push('report');

    // Inject model metadata into the final report
    // 补充模型元数据，便于后续审计与复盘。
    await a.injectReportMetadataActivity(activityInput);

    // Translate all reports to Chinese
    // 翻译所有报告为中文
    try {
      await a.translateReportsActivity({
        repoPath: activityInput.repoPath,
        apiKey: input.apiKey || '',
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        model: input.model || 'minimax-m2.5',
      });
    } catch (error) {
      // Non-critical - don't fail the workflow
      const err = error as Error;
      console.log(chalk.yellow(`⚠️ Translation failed: ${err.message}`));
    }

    await a.logPhaseTransition(activityInput, 'reporting', 'complete');

    // === Complete ===
    // 标记成功并生成摘要，随后写入 workflow 完成日志。
    state.status = 'completed';
    state.currentPhase = null;
    state.currentAgent = null;
    state.summary = computeSummary(state);

    // Log workflow completion summary
    // 写入全局执行总结（耗时、成本、完成 agent）。
    await a.logWorkflowComplete(activityInput, {
      status: 'completed',
      totalDurationMs: state.summary.totalDurationMs,
      totalCostUsd: state.summary.totalCostUsd,
      completedAgents: state.completedAgents,
      agentMetrics: Object.fromEntries(
        Object.entries(state.agentMetrics).map(([name, m]) => [
          name,
          { durationMs: m.durationMs, costUsd: m.costUsd },
        ])
      ),
    });

    return state;
  } catch (error) {
    state.status = 'failed';
    state.failedAgent = state.currentAgent;
    state.error = error instanceof Error ? error.message : String(error);
    state.summary = computeSummary(state);

    // Log workflow failure summary
    // 失败路径同样记录可用摘要，便于排障。
    await a.logWorkflowComplete(activityInput, {
      status: 'failed',
      totalDurationMs: state.summary.totalDurationMs,
      totalCostUsd: state.summary.totalCostUsd,
      completedAgents: state.completedAgents,
      agentMetrics: Object.fromEntries(
        Object.entries(state.agentMetrics).map(([name, m]) => [
          name,
          { durationMs: m.durationMs, costUsd: m.costUsd },
        ])
      ),
      error: state.error ?? undefined,
    });

    throw error;
  }
}

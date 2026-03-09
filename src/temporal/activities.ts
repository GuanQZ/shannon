// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义 Temporal Activity 实现，承接工作流调度并执行具体代理任务与周边动作。
 * 该文件是“工作流编排”与“实际执行逻辑”之间的桥梁。
 */

/**
 * Temporal activities for Lumin agent execution.
 * Lumin 代理执行的 `Temporal` `activity` 集合。
 *
 * Each activity wraps a single agent execution with:
 * 每个 `activity` 在执行单个代理时都会包含：
 * - Heartbeat loop (2s interval) to signal worker liveness
 * - 以两秒间隔发送心跳，向 `Temporal` 证明 `worker` 仍在存活
 * - Git checkpoint/rollback/commit per attempt
 * - 每次尝试都执行 `Git` 检查点、失败回滚与成功提交
 * - Error classification for Temporal retry behavior
 * - 统一错误分类，供 `Temporal` 决定重试行为
 * - Audit session logging
 * - 审计会话日志记录
 *
 * Temporal handles retries based on error classification:
 * `Temporal` 根据错误分类处理重试：
 * - Retryable: BillingError, TransientError (429, 5xx, network)
 * - 可重试：计费错误与瞬时错误（429、5xx、网络抖动）
 * - Non-retryable: AuthenticationError, PermissionError, ConfigurationError, etc.
 * - 不可重试：鉴权、权限、配置等永久性错误
 *
 * Activity 层是 workflow 与实际执行器之间的防腐层：
 * - `workflow` 只关心编排；
 * - `activity` 负责具体执行、审计、重试分类与 `Git` 状态收敛。
 */

import { heartbeat, ApplicationFailure, Context } from '@temporalio/activity';
import { fs, path } from 'zx';
import chalk from 'chalk';

// Max lengths to prevent Temporal protobuf buffer overflow
// 限制错误消息体积，避免序列化到 `Temporal` 时超出 `protobuf` 缓冲区。
const MAX_ERROR_MESSAGE_LENGTH = 2000;
const MAX_STACK_TRACE_LENGTH = 1000;

// Max retries for output validation errors (agent didn't save deliverables)
// 交付物校验失败的最大重试次数（代理未正确落盘产物时触发）。
// Lower than default 50 since this is unlikely to self-heal
// 交付物缺失通常不是短暂故障，因此重试次数应明显低于默认上限。
const MAX_OUTPUT_VALIDATION_RETRIES = 3;

/**
 * Truncate error message to prevent buffer overflow in Temporal serialization.
 * 错误过长时截断，保留关键信息并降低传输失败风险。
 */
function truncateErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message;
  }
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 20) + '\n[truncated]';
}

/**
 * Truncate stack trace on an ApplicationFailure to prevent buffer overflow.
 * 限制堆栈长度，避免工作流失败对象过大。
 */
function truncateStackTrace(failure: ApplicationFailure): void {
  if (failure.stack && failure.stack.length > MAX_STACK_TRACE_LENGTH) {
    failure.stack = failure.stack.slice(0, MAX_STACK_TRACE_LENGTH) + '\n[stack truncated]';
  }
}

import {
  runClaudePrompt,
  validateAgentOutput,
  type ClaudePromptResult,
} from '../ai/claude-executor.js';
import { loadPrompt } from '../prompts/prompt-manager.js';
import { parseConfig, distributeConfig } from '../config-parser.js';
import { classifyErrorForTemporal } from '../error-handling.js';
import {
  safeValidateQueueAndDeliverable,
  type VulnType,
  type ExploitationDecision,
} from '../queue-validation.js';
import {
  createGitCheckpoint,
  commitGitSuccess,
  rollbackGitWorkspace,
  getGitCommitHash,
} from '../utils/git-manager.js';
import { assembleFinalReport, injectModelIntoReport } from '../phases/reporting.js';
import { translateReports } from '../phases/translation.js';
import { getPromptNameForAgent } from '../types/agents.js';
import { AuditSession } from '../audit/index.js';
import type { WorkflowSummary } from '../audit/workflow-logger.js';
import type { AgentName } from '../types/agents.js';
import type { AgentMetrics } from './shared.js';
import type { DistributedConfig } from '../types/config.js';
import type { SessionMetadata } from '../audit/utils.js';

const HEARTBEAT_INTERVAL_MS = 2000; // Must be < heartbeatTimeout (10min production, 5min testing)
// 心跳周期必须小于 `worker` 配置的 `heartbeatTimeout`，否则任务会被误判超时。

/**
 * Input for all agent activities.
 * 所有代理 `activity` 统一使用的输入结构。
 * Matches PipelineInput but with required workflowId for audit correlation.
 * 与 `PipelineInput` 基本一致，但 `workflowId` 为必填，用于审计关联。
 *
 * 用途：描述所有代理活动的统一入参。
 * 关键参数：`webUrl` 与 `repoPath` 表示目标与仓库；`workflowId` 用于全链路关联。
 * 返回值：作为类型声明不直接返回值。
 * 失败分支：类型约束不满足会在编译阶段暴露。
 */
export interface ActivityInput {
  webUrl: string;
  repoPath: string;
  repos?: string;  // Comma-separated list of repo names/URLs for multi-repo mode
  configPath?: string;
  outputPath?: string;
  pipelineTestingMode?: boolean;
  workflowId: string;
}

export interface TranslationActivityInput {
  repoPath: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Core activity implementation.
 * 核心 activity 实现。
 *
 * Executes a single agent with:
 * 执行单个代理时的标准步骤：
 * 1. Heartbeat loop for worker liveness
 * 1. 启动心跳循环，保持 worker 存活信号
 * 2. Config loading (if configPath provided)
 * 2. 按需加载配置（提供 configPath 时）
 * 3. Audit session initialization
 * 3. 初始化审计会话
 * 4. Prompt loading
 * 4. 加载并渲染提示词
 * 5. Git checkpoint before execution
 * 5. 执行前创建 Git 检查点
 * 6. Agent execution (single attempt)
 * 6. 执行单次代理调用（重试由 Temporal 负责）
 * 7. Output validation
 * 7. 校验输出产物
 * 8. Git commit on success, rollback on failure
 * 8. 成功提交 Git，失败回滚工作区
 * 9. Error classification for Temporal retry
 * 9. 进行错误分类并交给 Temporal 决策
 *
 * 该函数是所有 agent activity 的公共模板实现。
 * 通过“薄包装 + 公共核心”模式，避免每个 agent 重复实现同样的可靠性逻辑。
 *
 * 用途：执行单个代理活动并统一处理审计、检查点与异常分类。
 * 关键参数：`agentName` 指定代理类型，`input` 提供运行上下文。
 * 返回值：返回该代理的耗时、成本、轮次与模型信息。
 * 失败分支：失败时抛出 `ApplicationFailure`，由 `Temporal` 按可重试性处理。
 */
async function runAgentActivity(
  agentName: AgentName,
  input: ActivityInput
): Promise<AgentMetrics> {
  const {
    webUrl,
    repoPath,
    configPath,
    outputPath,
    pipelineTestingMode = false,
    workflowId,
  } = input;

  const startTime = Date.now();

  // Get attempt number from Temporal context (tracks retries automatically)
  // attempt 由 Temporal 自动维护，可用于审计与重试上限判定。
  const attemptNumber = Context.current().info.attempt;

  // Heartbeat loop - signals worker is alive to Temporal server
  // 长任务期间持续心跳，避免被 Temporal 误判为 worker 卡死。
  const heartbeatInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    heartbeat({ agent: agentName, elapsedSeconds: elapsed, attempt: attemptNumber });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // 1. Load config (if provided)
    // 解析用户配置并分发到 prompt 层；配置错误会阻断当前 activity。
    let distributedConfig: DistributedConfig | null = null;
    if (configPath) {
      try {
        const config = await parseConfig(configPath);
        distributedConfig = distributeConfig(config);
      } catch (err) {
        throw new Error(`Failed to load config ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Build session metadata for audit
    // 构建审计上下文，确保同一 workflow 的日志可追溯。
    const sessionMetadata: SessionMetadata = {
      id: workflowId,
      webUrl,
      repoPath,
      ...(outputPath && { outputPath }),
    };

    // 2.5. Create screenshots directory for exploitation evidence
    // 为 exploitation 阶段创建截图目录，避免 Agent 因 Bash 工具不可用而无法创建目录
    const screenshotsDir = path.join(repoPath, 'screenshots');
    try {
      if (!(await fs.pathExists(screenshotsDir))) {
        await fs.mkdir(screenshotsDir, { recursive: true });
        console.log(`📁 Created screenshots directory: ${screenshotsDir}`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to create screenshots directory: ${err}`);
      // Continue anyway - agent may still work
    }

    // 3. Initialize audit session (idempotent, safe across retries)
    // 幂等初始化，兼容重试场景下的重复调用。
    const auditSession = new AuditSession(sessionMetadata);
    await auditSession.initialize();

    // 4. Load prompt
    // 按 agentName 映射 prompt 模板，并注入变量与配置。
    const promptName = getPromptNameForAgent(agentName);
    const prompt = await loadPrompt(
      promptName,
      { webUrl, repoPath },
      distributedConfig,
      pipelineTestingMode
    );

    // 5. Create git checkpoint before execution
    // 执行前创建检查点，便于失败时恢复到干净工作区。
    await createGitCheckpoint(repoPath, agentName, attemptNumber);
    await auditSession.startAgent(agentName, prompt, attemptNumber);

    // 6. Execute agent (single attempt - Temporal handles retries)
    // 这里仅执行单次；重试由 Temporal 驱动，不在本函数内循环。
    const result: ClaudePromptResult = await runClaudePrompt(
      prompt,
      repoPath,
      '', // context
      agentName, // description
      agentName,
      chalk.cyan,
      sessionMetadata,
      auditSession,
      attemptNumber
    );

    // 6.5. Sanity check: Detect spending cap that slipped through all detection layers
    // 6.5 兜底检查：识别所有检测层都漏掉的额度上限异常。
    // Defense-in-depth: A successful agent execution should never have ≤2 turns with $0 cost
    // 短对话且零成本通常代表额度/网关异常，而非真实分析完成。
    if (result.success && (result.turns ?? 0) <= 2 && (result.cost || 0) === 0) {
      const resultText = result.result || '';
      const looksLikeBillingError = /spending|cap|limit|budget|resets/i.test(resultText);

      if (looksLikeBillingError) {
        await rollbackGitWorkspace(repoPath, 'spending cap detected');
        await auditSession.endAgent(agentName, {
          attemptNumber,
          duration_ms: result.duration,
          cost_usd: 0,
          total_tokens: result.totalTokens || 0,
          success: false,
          model: result.model,
          error: `Spending cap likely reached: ${resultText.slice(0, 100)}`,
        });
        // Throw as billing error so Temporal retries with long backoff
        // 显式归类为计费错误，可触发较长退避重试。
        throw new Error(`Spending cap likely reached: ${resultText.slice(0, 100)}`);
      }
    }

    // 7. Handle execution failure
    // 失败时先回滚工作区，再写审计结束事件并抛出错误供 Temporal 处理。
    if (!result.success) {
      await rollbackGitWorkspace(repoPath, 'execution failure');
      await auditSession.endAgent(agentName, {
        attemptNumber,
        duration_ms: result.duration,
        cost_usd: result.cost || 0,
        total_tokens: result.totalTokens || 0,
        success: false,
        model: result.model,
        error: result.error || 'Execution failed',
      });
      throw new Error(result.error || 'Agent execution failed');
    }

    // 8. Validate output
    // 强制校验交付物是否落盘，避免“模型答复成功但产物缺失”的假成功。
    const validationPassed = await validateAgentOutput(result, agentName, repoPath);
    if (!validationPassed) {
      await rollbackGitWorkspace(repoPath, 'validation failure');
      await auditSession.endAgent(agentName, {
        attemptNumber,
        duration_ms: result.duration,
        cost_usd: result.cost || 0,
        total_tokens: result.totalTokens || 0,
        success: false,
        model: result.model,
        error: 'Output validation failed',
      });

      // Limit output validation retries (unlikely to self-heal)
      // 达到上限后转为 nonRetryable，避免无限消耗。
      if (attemptNumber >= MAX_OUTPUT_VALIDATION_RETRIES) {
        throw ApplicationFailure.nonRetryable(
          `Agent ${agentName} failed output validation after ${attemptNumber} attempts`,
          'OutputValidationError',
          [{ agentName, attemptNumber, elapsed: Date.now() - startTime }]
        );
      }
      // Let Temporal retry (will be classified as OutputValidationError)
      // 低于上限时让 `Temporal` 按策略重试。
      throw new Error(`Agent ${agentName} failed output validation`);
    }

    // 9. Success - commit and log
    // 成功路径记录 checkpoint 并提交，形成可审计变更点。
    const commitHash = await getGitCommitHash(repoPath);
    await auditSession.endAgent(agentName, {
      attemptNumber,
      duration_ms: result.duration,
      cost_usd: result.cost || 0,
      total_tokens: result.totalTokens || 0,
      success: true,
      model: result.model,
      ...(commitHash && { checkpoint: commitHash }),
    });
    await commitGitSuccess(repoPath, agentName);

    // 10. Return metrics
    // 返回 workflow 侧可聚合的统一指标结构。
    return {
      durationMs: Date.now() - startTime,
      inputTokens: null, // Not currently exposed by SDK wrapper
      outputTokens: null,
      costUsd: result.cost ?? null,
      numTurns: result.turns ?? null,
      model: result.model,
    };
  } catch (error) {
    // Rollback git workspace before Temporal retry to ensure clean state
    // 异常路径先清理工作区，避免脏状态影响后续重试。
    try {
      await rollbackGitWorkspace(repoPath, 'error recovery');
    } catch (rollbackErr) {
      // Log but don't fail - rollback is best-effort
      // 回滚失败仅记录，不覆盖原始业务错误。
      console.error(`Failed to rollback git workspace for ${agentName}:`, rollbackErr);
    }

    // If error is already an ApplicationFailure (e.g., from our retry limit logic),
    // 若错误本身已是 ApplicationFailure（例如由重试上限逻辑抛出），
    // re-throw it directly without re-classifying
    // 避免二次包装导致错误语义丢失。
    if (error instanceof ApplicationFailure) {
      throw error;
    }

    // Classify error for Temporal retry behavior
    // 统一映射为可重试或不可重试，交给 `Temporal` 选择路径。
    const classified = classifyErrorForTemporal(error);
    // Truncate message to prevent protobuf buffer overflow
    // 错误文本在序列化前做长度收敛。
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = truncateErrorMessage(rawMessage);

    if (classified.retryable) {
      // Temporal will retry with configured backoff
      // 可重试错误进入回退重试通道。
      const failure = ApplicationFailure.create({
        message,
        type: classified.type,
        details: [{ agentName, attemptNumber, elapsed: Date.now() - startTime }],
      });
      truncateStackTrace(failure);
      throw failure;
    } else {
      // Fail immediately - no retry
      // 不可重试错误直接终止，避免无效重试。
      const failure = ApplicationFailure.nonRetryable(message, classified.type, [
        { agentName, attemptNumber, elapsed: Date.now() - startTime },
      ]);
      truncateStackTrace(failure);
      throw failure;
    }
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// === Individual Agent Activity Exports ===
// 各导出函数仅绑定 agent 名称，统一复用 runAgentActivity。
// Each function is a thin wrapper around runAgentActivity with the agent name.
// 以下导出函数仅做“agent 名称绑定”，核心逻辑全部复用 runAgentActivity。

export async function runPreReconAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('pre-recon', input);
}

export async function runReconAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('recon', input);
}

export async function runInjectionVulnAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('injection-vuln', input);
}

export async function runXssVulnAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('xss-vuln', input);
}

export async function runAuthVulnAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('auth-vuln', input);
}

export async function runSsrfVulnAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('ssrf-vuln', input);
}

export async function runAuthzVulnAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('authz-vuln', input);
}

export async function runInjectionExploitAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('injection-exploit', input);
}

export async function runXssExploitAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('xss-exploit', input);
}

export async function runAuthExploitAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('auth-exploit', input);
}

export async function runSsrfExploitAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('ssrf-exploit', input);
}

export async function runAuthzExploitAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('authz-exploit', input);
}

export async function runReportAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity('report', input);
}

/**
 * Assemble the final report by concatenating exploitation evidence files.
 * 通过拼接 exploitation 证据文件生成最终报告草稿。
 * This must be called BEFORE runReportAgent to create the file that the report agent will modify.
 * 必须在 runReportAgent 之前执行，以先准备报告代理要修改的目标文件。
 *
 * 报告代理执行前先准备基础证据文档，避免 report 阶段输入缺失。
 */
export async function assembleReportActivity(input: ActivityInput): Promise<void> {
  const { repoPath } = input;
  console.log(chalk.blue('📝 Assembling deliverables from specialist agents...'));
  try {
    await assembleFinalReport(repoPath);
  } catch (error) {
    const err = error as Error;
    console.log(chalk.yellow(`⚠️ Error assembling final report: ${err.message}`));
    // Don't throw - the report agent can still create content even if no exploitation files exist
    // 报告汇总失败不阻断主流程，让报告代理继续尽可能产出。
  }
}

/**
 * Inject model metadata into the final report.
 * 将模型元数据注入最终报告。
 * This must be called AFTER runReportAgent to add the model information to the Executive Summary.
 * 必须在 runReportAgent 之后执行，向 Executive Summary 增补模型信息。
 *
 * 属于增强型后处理，不影响主流程成功判定。
 */
export async function injectReportMetadataActivity(input: ActivityInput): Promise<void> {
  const { repoPath, outputPath } = input;
  if (!outputPath) {
    console.log(chalk.yellow('⚠️ No output path provided, skipping model injection'));
    return;
  }
  try {
    await injectModelIntoReport(repoPath, outputPath);
  } catch (error) {
    const err = error as Error;
    console.log(chalk.yellow(`⚠️ Error injecting model into report: ${err.message}`));
    // Don't throw - this is a non-critical enhancement
    // 模型信息注入是增强项，失败时不中断任务。
  }
}

/**
 * Translate all reports to Chinese after Reporting phase.
 * 报告阶段完成后翻译所有报告为中文。
 *
 * This is a non-critical enhancement - failures don't block workflow completion.
 * 这是增强功能，失败不会阻塞工作流完成。
 */
export async function translateReportsActivity(
  input: TranslationActivityInput
): Promise<void> {
  const { repoPath, apiKey, baseUrl, model } = input;

  console.log(chalk.blue('🔄 Starting report translation to Chinese...'));

  try {
    const result = await translateReports(repoPath, {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
    });

    if (result.success) {
      console.log(chalk.green(`✅ All ${result.translatedFiles.length} reports translated successfully`));
    } else {
      console.log(chalk.yellow(`⚠️ Translation completed with ${result.failedFiles.length} failures`));
      for (const failure of result.failedFiles) {
        console.log(chalk.yellow(`  - ${failure.path}: ${failure.error}`));
      }
    }
  } catch (error) {
    const err = error as Error;
    console.log(chalk.yellow(`⚠️ Translation activity error: ${err.message}`));
    // Don't throw - this is a non-critical enhancement
  }
}

/**
 * Check if exploitation should run for a given vulnerability type.
 * 判断指定漏洞类型是否需要执行 `exploit` 阶段。
 * Reads the vulnerability queue file and returns the decision.
 * 读取漏洞队列文件并返回决策结果。
 *
 * This activity allows the workflow to skip exploit agents entirely
 * 该 `activity` 允许工作流在无漏洞时直接跳过 `exploit` 代理，
 * when no vulnerabilities were found, saving API calls and time.
 * 以减少不必要的 API 调用与执行时间。
 *
 * Error handling:
 * 错误处理策略：
 * - Retryable errors (missing files, invalid JSON): re-throw for Temporal retry
 * - 可重试错误（缺失文件、JSON 无效）：抛出并交给 Temporal 重试
 * - Non-retryable errors: skip exploitation gracefully
 * - 不可重试错误：优雅跳过 `exploit`
 *
 * 用途：在执行利用前做必要性判定，减少无效调用。
 * 关键参数：`input` 提供仓库路径，`vulnType` 指定漏洞类别。
 * 返回值：返回是否利用、漏洞数量与重试建议。
 * 失败分支：可重试错误直接抛出，不可重试错误返回“跳过利用”。
 */
export async function checkExploitationQueue(
  input: ActivityInput,
  vulnType: VulnType
): Promise<ExploitationDecision> {
  const { repoPath } = input;

  const result = await safeValidateQueueAndDeliverable(vulnType, repoPath);

  if (result.success && result.data) {
    const { shouldExploit, vulnerabilityCount } = result.data;
    console.log(
      chalk.blue(
        `🔍 ${vulnType}: ${shouldExploit ? `${vulnerabilityCount} vulnerabilities found` : 'no vulnerabilities, skipping exploitation'}`
      )
    );
    return result.data;
  }

  // Validation failed - check if we should retry or skip
  // 校验失败后按错误可恢复性选择“抛错重试”或“优雅跳过”。
  const error = result.error;
  if (error?.retryable) {
    // Re-throw retryable errors so Temporal can retry the vuln agent
    // 把重试决策交给 Temporal。
    console.log(chalk.yellow(`⚠️ ${vulnType}: ${error.message} (retrying)`));
    throw error;
  }

  // Non-retryable error - skip exploitation gracefully
  // 非关键或不可恢复错误不阻断整体流程，直接跳过 `exploit`。
  console.log(
    chalk.yellow(`⚠️ ${vulnType}: ${error?.message ?? 'Unknown error'}, skipping exploitation`)
  );
  return {
    shouldExploit: false,
    shouldRetry: false,
    vulnerabilityCount: 0,
    vulnType,
  };
}

/**
 * Log phase transition to the unified workflow log.
 * 记录阶段切换事件到统一 `workflow` 日志。
 * Called at phase boundaries for per-workflow logging.
 * 在阶段边界写入日志，便于按时间线观察 `workflow` 运行。
 *
 * 用途：在阶段开始与结束时写入统一日志。
 * 关键参数：`phase` 标识阶段，`event` 标识开始或完成。
 * 返回值：无返回值。
 * 失败分支：审计初始化或写入失败会抛出异常给上层处理。
 */
export async function logPhaseTransition(
  input: ActivityInput,
  phase: string,
  event: 'start' | 'complete'
): Promise<void> {
  const { webUrl, repoPath, outputPath, workflowId } = input;

  const sessionMetadata: SessionMetadata = {
    id: workflowId,
    webUrl,
    repoPath,
    ...(outputPath && { outputPath }),
  };

  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize();

  if (event === 'start') {
    await auditSession.logPhaseStart(phase);
  } else {
    await auditSession.logPhaseComplete(phase);
  }
}

/**
 * Log workflow completion with full summary to the unified workflow log.
 * 将工作流完成摘要写入统一 `workflow` 日志。
 * Called at the end of the workflow to write a summary breakdown.
 * 写入执行结果总览（成功/失败、成本、耗时、完成列表）。
 *
 * 用途：在工作流结束时落盘总览摘要。
 * 关键参数：`summary` 提供状态、耗时、成本与错误信息。
 * 返回值：无返回值。
 * 失败分支：日志写入失败会抛出异常。
 */
export async function logWorkflowComplete(
  input: ActivityInput,
  summary: WorkflowSummary
): Promise<void> {
  const { webUrl, repoPath, outputPath, workflowId } = input;

  const sessionMetadata: SessionMetadata = {
    id: workflowId,
    webUrl,
    repoPath,
    ...(outputPath && { outputPath }),
  };

  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize();
  await auditSession.logWorkflowComplete(summary);
}

// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 实现 `AI` 代理核心执行器，负责提示词装配、模型调用、消息流消费、失败重试与 `Git` 状态收敛。
 * 入口函数负责驱动单个 `agent` 的完整生命周期：执行、校验、提交或回滚。
 *
 * 关键输入：
 * - `prompt` / `context`：模型任务内容与重试补充上下文。
 * - `sourceDir`：目标仓库路径，供模型工具调用与产物校验。
 * - `agentName`：用于选择校验器、`MCP` 工具映射和日志标识。
 *
 * 返回结果：
 * - 成功时返回文本结果、成本、轮次、耗时与模型信息。
 * - 失败时返回错误类别与是否可重试，供 `Temporal` 上层决策。
 *
 * 边界与分支：
 * - 容器模式下切换 `Playwright` 浏览器参数，避免运行时下载失败。
 * - 低成本且极少轮次的异常结果会触发兜底判定，防止把额度异常当作成功。
 */

// Production Claude agent execution with retry, git checkpoints, and audit logging
// 生产级执行器实现，强调稳定性、可回滚与可审计。

import { fs, path } from 'zx';
import chalk, { type ChalkInstance } from 'chalk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import { isRetryableError, getRetryDelay, PentestError } from '../error-handling.js';
import { timingResults, Timer } from '../utils/metrics.js';
import { formatTimestamp } from '../utils/formatting.js';
import { createGitCheckpoint, commitGitSuccess, rollbackGitWorkspace, getGitCommitHash } from '../utils/git-manager.js';
import { AGENT_VALIDATORS, MCP_AGENT_MAPPING } from '../constants.js';
import { AuditSession } from '../audit/index.js';
import { createLuminHelperServer } from '../../lumin-tool-mcp/dist/index.js';
import type { SessionMetadata } from '../audit/utils.js';
import { getPromptNameForAgent } from '../types/agents.js';
import type { AgentName } from '../types/index.js';

import { dispatchMessage } from './message-handlers.js';
import { detectExecutionContext, formatErrorOutput, formatCompletionMessage } from './output-formatters.js';
import { createProgressManager } from './progress-manager.js';
import { createAuditLogger } from './audit-logger.js';
import { getActualModelName } from './router-utils.js';
import { InternalAgentClient, isInternalAgentEnabled } from './providers/internal-agent.js';

declare global {
  var LUMIN_DISABLE_LOADER: boolean | undefined;
}

export interface ClaudePromptResult {
  result?: string | null | undefined;
  success: boolean;
  duration: number;
  turns?: number | undefined;
  cost: number;
  totalTokens?: number | undefined;
  model?: string | undefined;
  partialCost?: number | undefined;
  apiErrorDetected?: boolean | undefined;
  error?: string | undefined;
  errorType?: string | undefined;
  prompt?: string | undefined;
  retryable?: boolean | undefined;
}

interface StdioMcpServer {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

type McpServer = ReturnType<typeof createLuminHelperServer> | StdioMcpServer;

// Configures MCP servers for agent execution, with Docker-specific Chromium handling
// 根据 `agent` 类型动态装配 `MCP` 工具；在容器环境切换浏览器启动参数。
function buildMcpServers(
  sourceDir: string,
  agentName: string | null
): Record<string, McpServer> {
  const luminHelperServer = createLuminHelperServer(sourceDir);

  const mcpServers: Record<string, McpServer> = {
    'lumin-helper': luminHelperServer,
  };

  if (agentName) {
    const promptName = getPromptNameForAgent(agentName as AgentName);
    const playwrightMcpName = MCP_AGENT_MAPPING[promptName as keyof typeof MCP_AGENT_MAPPING] || null;

    if (playwrightMcpName) {
      console.log(chalk.gray(`    Assigned ${agentName} -> ${playwrightMcpName}`));

      const userDataDir = `/tmp/${playwrightMcpName}`;

      // Docker uses system Chromium; local dev uses Playwright's bundled browsers
      // 容器环境中优先使用系统浏览器，避免运行时下载浏览器依赖失败。
      const isDocker = process.env.LUMIN_DOCKER === 'true';

      const mcpArgs: string[] = [
        '@playwright/mcp@latest',
        '--isolated',
        '--user-data-dir', userDataDir,
      ];

      // Docker: Use system Chromium; Local: Use Playwright's bundled browsers
      // 通过命令参数切换浏览器来源，保持本地与容器行为一致。
      if (isDocker) {
        mcpArgs.push('--executable-path', '/usr/bin/chromium-browser');
        mcpArgs.push('--browser', 'chromium');
      }

      const envVars: Record<string, string> = Object.fromEntries(
        Object.entries({
          ...process.env,
          PLAYWRIGHT_HEADLESS: 'true',
          ...(isDocker && { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }),
        }).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );

      mcpServers[playwrightMcpName] = {
        type: 'stdio' as const,
        command: 'npx',
        args: mcpArgs,
        env: envVars,
      };
    }
  }

  return mcpServers;
}

function outputLines(lines: string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}

async function writeErrorLog(
  err: Error & { code?: string; status?: number },
  sourceDir: string,
  fullPrompt: string,
  duration: number
): Promise<void> {
  // 将失败上下文追加写入 `error.log`，便于离线排障。
  // `fullPrompt` 仅保留前缀片段，避免日志体积过大或泄露过多上下文。
  try {
    const errorLog = {
      timestamp: formatTimestamp(),
      agent: 'claude-executor',
      error: {
        name: err.constructor.name,
        message: err.message,
        code: err.code,
        status: err.status,
        stack: err.stack
      },
      context: {
        sourceDir,
        prompt: fullPrompt.slice(0, 200) + '...',
        retryable: isRetryableError(err)
      },
      duration
    };
    const logPath = path.join(sourceDir, 'error.log');
    await fs.appendFile(logPath, JSON.stringify(errorLog) + '\n');
  } catch (logError) {
    const logErrMsg = logError instanceof Error ? logError.message : String(logError);
    console.log(chalk.gray(`    (Failed to write error log: ${logErrMsg})`));
  }
}

export async function validateAgentOutput(
  result: ClaudePromptResult,
  agentName: string | null,
  sourceDir: string
): Promise<boolean> {
  console.log(chalk.blue(`    Validating ${agentName} agent output`));
  // 验证器只关注“必须产物是否存在/结构是否正确”，
  // 不判断模型文本质量，职责边界清晰。

  try {
    // Check if agent completed successfully
    // 先做快速失败判定，避免无意义校验。
    if (!result.success || !result.result) {
      console.log(chalk.red(`    Validation failed: Agent execution was unsuccessful`));
      return false;
    }

    // Get validator function for this agent
    // 按 `agentName` 在常量映射表中选择对应校验器。
    const validator = agentName ? AGENT_VALIDATORS[agentName as keyof typeof AGENT_VALIDATORS] : undefined;

    if (!validator) {
      console.log(chalk.yellow(`    No validator found for agent "${agentName}" - assuming success`));
      console.log(chalk.green(`    Validation passed: Unknown agent with successful result`));
      return true;
    }

    console.log(chalk.blue(`    Using validator for agent: ${agentName}`));
    console.log(chalk.blue(`    Source directory: ${sourceDir}`));

    // Apply validation function
    // 真正执行文件/结构校验逻辑。
    const validationResult = await validator(sourceDir);

    if (validationResult) {
      console.log(chalk.green(`    Validation passed: Required files/structure present`));
    } else {
      console.log(chalk.red(`    Validation failed: Missing required deliverable files`));
    }

    return validationResult;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`    Validation failed with error: ${errMsg}`));
    return false;
  }
}

// Low-level SDK execution. Handles message streaming, progress, and audit logging.
// 低层执行函数：负责消费 `SDK` 消息流，并同步更新进度与审计日志。
// Exported for Temporal activities to call single-attempt execution.
// 该入口只负责单次执行（不含重试循环），重试策略由上层决定。
export async function runClaudePrompt(
  prompt: string,
  sourceDir: string,
  context: string = '',
  description: string = 'Claude analysis',
  agentName: string | null = null,
  colorFn: ChalkInstance = chalk.cyan,
  sessionMetadata: SessionMetadata | null = null,
  auditSession: AuditSession | null = null,
  attemptNumber: number = 1
): Promise<ClaudePromptResult> {
  const timer = new Timer(`agent-${description.toLowerCase().replace(/\s+/g, '-')}`);
  // `fullPrompt` = context + prompt，用于重试时携带历史补充信息。
  const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

  const execContext = detectExecutionContext(description);
  const progress = createProgressManager(
    { description, useCleanOutput: execContext.useCleanOutput },
    global.LUMIN_DISABLE_LOADER ?? false
  );
  const auditLogger = createAuditLogger(auditSession);

  console.log(chalk.blue(`  正在执行 Claude Code：${description}...`));

  const mcpServers = buildMcpServers(sourceDir, agentName);

  // Build env vars to pass to SDK subprocesses
  // 仅透传必要凭证变量，减少子进程环境噪声。
  const sdkEnv: Record<string, string> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    sdkEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  // Support third-party Anthropic-compatible APIs (MiniMax, DeepSeek, Kimi, etc.)
  if (process.env.ANTHROPIC_BASE_URL) {
    sdkEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.ANTHROPIC_MODEL) {
    sdkEnv.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
  }
  // ANTHROPIC_AUTH_TOKEN is used by some third-party providers
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    sdkEnv.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  const options = {
    model: 'claude-sonnet-4-5-20250929',
    maxTurns: 10_000,
    cwd: sourceDir,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    mcpServers,
    env: sdkEnv,
  };

  if (!execContext.useCleanOutput) {
    console.log(chalk.gray(`    SDK 参数：maxTurns=${options.maxTurns}，cwd=${sourceDir}，permissions=BYPASS`));
  }

  let turnCount = 0;
  let result: string | null = null;
  let apiErrorDetected = false;
  let totalCost = 0;

  progress.start();

  // Check if internal agent is enabled
  // 如果配置了内网 Agent，使用内网 Agent 替代 Claude SDK
  if (isInternalAgentEnabled()) {
    return await runInternalAgentPrompt(
      fullPrompt,
      sourceDir,
      description,
      timer,
      progress,
      auditLogger
    );
  }

  try {
    const messageLoopResult = await processMessageStream(
      fullPrompt,
      options,
      { execContext, description, colorFn, progress, auditLogger },
      timer
    );

    turnCount = messageLoopResult.turnCount;
    result = messageLoopResult.result;
    apiErrorDetected = messageLoopResult.apiErrorDetected;
    totalCost = messageLoopResult.cost;
    const model = messageLoopResult.model;

    // === SPENDING CAP SAFEGUARD ===
    // === SPENDING CAP SAFEGUARD ===。
    // Defense-in-depth: Detect spending cap that slipped through detectApiError().
    // 即便消息分发层漏判，也在执行收口处再次防守。
    // When spending cap is hit, Claude returns a short message with $0 cost.
    // 这是典型异常信号，需要转换为可重试的计费错误。
    // Legitimate agent work NEVER costs $0 with only 1-2 turns.
    // 利用该启发式降低“假成功”写入后续流程的风险。
    if (turnCount <= 2 && totalCost === 0) {
      // 极少轮次 + 零成本 + 关键词命中，高概率为计费上限触发。
      const resultLower = (result || '').toLowerCase();
      const BILLING_KEYWORDS = ['spending', 'cap', 'limit', 'budget', 'resets'];
      const looksLikeBillingError = BILLING_KEYWORDS.some((kw) =>
        resultLower.includes(kw)
      );

      if (looksLikeBillingError) {
        throw new PentestError(
          `Spending cap likely reached (turns=${turnCount}, cost=$0): ${result?.slice(0, 100)}`,
          'billing',
          true // Retryable - Temporal will use 5-30 min backoff
        );
      }
    }

    const duration = timer.stop();
    timingResults.agents[execContext.agentKey] = duration;

    if (apiErrorDetected) {
      console.log(chalk.yellow(`  在 ${description} 中检测到 API 异常——失败前将先校验交付物`));
    }

    progress.finish(formatCompletionMessage(execContext, description, turnCount, duration));

    return {
      result,
      success: true,
      duration,
      turns: turnCount,
      cost: totalCost,
      model,
      partialCost: totalCost,
      apiErrorDetected
    };

  } catch (error) {
    const duration = timer.stop();
    timingResults.agents[execContext.agentKey] = duration;

    const err = error as Error & { code?: string; status?: number };

    await auditLogger.logError(err, duration, turnCount);
    progress.stop();
    outputLines(formatErrorOutput(err, execContext, description, duration, sourceDir, isRetryableError(err)));
    await writeErrorLog(err, sourceDir, fullPrompt, duration);

    return {
      error: err.message,
      errorType: err.constructor.name,
      prompt: fullPrompt.slice(0, 100) + '...',
      success: false,
      duration,
      cost: totalCost,
      retryable: isRetryableError(err)
    };
  }
}


interface MessageLoopResult {
  turnCount: number;
  result: string | null;
  apiErrorDetected: boolean;
  cost: number;
  model?: string | undefined;
}

interface MessageLoopDeps {
  // `execContext`：控制输出策略与 `agent` 标识。
  execContext: ReturnType<typeof detectExecutionContext>;
  // `description`：当前任务描述，用于终端与日志展示。
  description: string;
  // `colorFn`：控制台着色函数。
  colorFn: ChalkInstance;
  // `progress`：进度管理器（转圈实现或空操作实现）。
  progress: ReturnType<typeof createProgressManager>;
  // `auditLogger`：审计日志适配器。
  auditLogger: ReturnType<typeof createAuditLogger>;
}

async function processMessageStream(
  fullPrompt: string,
  options: NonNullable<Parameters<typeof query>[0]['options']>,
  deps: MessageLoopDeps,
  timer: Timer
): Promise<MessageLoopResult> {
  const { execContext, description, colorFn, progress, auditLogger } = deps;
  const HEARTBEAT_INTERVAL = 30000;
  // 关闭进度显示器时每三十秒打印一次心跳日志，防止“无输出假死”观感。

  let turnCount = 0;
  let result: string | null = null;
  let apiErrorDetected = false;
  let cost = 0;
  let model: string | undefined;
  let lastHeartbeat = Date.now();

  for await (const message of query({ prompt: fullPrompt, options })) {
    // Heartbeat logging when loader is disabled
    // 在长任务期间定时反馈“仍在运行”。
    const now = Date.now();
    if (global.LUMIN_DISABLE_LOADER && now - lastHeartbeat > HEARTBEAT_INTERVAL) {
      console.log(chalk.blue(`    [${Math.floor((now - timer.startTime) / 1000)}s] ${description} running... (Turn ${turnCount})`));
      lastHeartbeat = now;
    }

    // Increment turn count for assistant messages
    // 按 `assistant` 消息累计轮次，作为成本与异常判断输入。
    if (message.type === 'assistant') {
      turnCount++;
    }

    const dispatchResult = await dispatchMessage(
      message as { type: string; subtype?: string },
      turnCount,
      { execContext, description, colorFn, progress, auditLogger }
    );

    if (dispatchResult.type === 'throw') {
      throw dispatchResult.error;
    }

    if (dispatchResult.type === 'complete') {
      result = dispatchResult.result;
      cost = dispatchResult.cost;
      break;
    }

    if (dispatchResult.type === 'continue') {
      if (dispatchResult.apiErrorDetected) {
        apiErrorDetected = true;
      }
      // Capture model from SystemInitMessage, but override with router model if applicable
      // 路由模式下使用“实际模型名”覆盖 `SDK` 报告值。
      if (dispatchResult.model) {
        model = getActualModelName(dispatchResult.model);
      }
    }
  }

  return { turnCount, result, apiErrorDetected, cost, model };
}

// Internal agent prompt execution
// 使用内网 Agent 替代 Claude SDK 执行任务
async function runInternalAgentPrompt(
  prompt: string,
  sourceDir: string,
  description: string,
  timer: Timer,
  progress: ReturnType<typeof createProgressManager>,
  auditLogger: ReturnType<typeof createAuditLogger>
): Promise<ClaudePromptResult> {
  const internalAgent = InternalAgentClient.create();

  if (!internalAgent) {
    throw new Error('Failed to create internal agent client');
  }

  console.log(chalk.blue(`  正在执行内网 Agent：${description}...`));

  // Track tool calls and turns for console output
  const toolCallNames: string[] = [];
  let turnCount = 0;

  try {
    // Initialize session
    await internalAgent.initSession();

    // Prepend working directory info to prompt so LLM knows where the source code is
    const promptWithWorkingDir = `注意：目标源代码仓库位于工作目录: ${sourceDir}\n所有文件操作都在此目录下进行。\n\n---\n\n${prompt}`;

    // Stream processing: real-time feedback during execution
    // Track turn count by counting assistant messages
    const chatResponse = await internalAgent.chat(promptWithWorkingDir, async (message) => {
      // Track turn count - each assistant message is a new turn
      if (message.role === 'assistant') {
        turnCount++;
      }

      // Log to audit system for dashboard display
      // 1. LLM text response (with turn count)
      if (message.content && message.content.trim() && !message.toolUse && !message.toolResult) {
        await auditLogger.logLlmResponse(turnCount, message.content);
      }
      // 2. Tool call start
      if (message.toolUse) {
        await auditLogger.logToolStart(message.toolUse.name, message.toolUse.input);
      }
      // 3. Tool call result
      if (message.toolResult) {
        await auditLogger.logToolEnd(message.toolResult.output);
      }

      // Only collect tool call names for console debugging
      if (message.toolUse) {
        toolCallNames.push(message.toolUse.name);
      }
    });

    const duration = timer.stop();
    timingResults.agents[`internal-agent-${description.toLowerCase().replace(/\s+/g, '-')}`] = duration;

    const execContext = {
      isParallelExecution: false,
      useCleanOutput: false,
      agentType: 'internal-agent',
      agentKey: 'internal-agent',
    };

    progress.finish(formatCompletionMessage(
      execContext,
      description,
      turnCount || 1,
      duration
    ));

    // Log tool calls to console (kept for debugging)
    if (toolCallNames.length > 0) {
      console.log(chalk.gray(`    Tool calls: ${toolCallNames.join(', ')}`));
    }

    return {
      result: chatResponse.result,
      success: chatResponse.success,
      duration,
      turns: turnCount || 1,
      cost: 0,
      model: 'internal-agent',
    };
  } catch (error) {
    const duration = timer.stop();
    const err = error as Error;

    await auditLogger.logError(err, duration, turnCount || 1);
    progress.stop();

    console.log(chalk.red(`    内网 Agent 执行失败: ${err.message}`));

    return {
      error: err.message,
      errorType: err.constructor.name,
      prompt: prompt.slice(0, 100) + '...',
      success: false,
      duration,
      cost: 0,
      retryable: isRetryableError(err),
    };
  }
}

// Main entry point for agent execution. Handles retries, git checkpoints, and validation.
// 高层重试入口，封装“检查点 -> 执行 -> 校验 -> 提交或回滚”的完整闭环。
export async function runClaudePromptWithRetry(
  prompt: string,
  sourceDir: string,
  _allowedTools: string = 'Read',
  context: string = '',
  description: string = 'Claude analysis',
  agentName: string | null = null,
  colorFn: ChalkInstance = chalk.cyan,
  sessionMetadata: SessionMetadata | null = null
): Promise<ClaudePromptResult> {
  const maxRetries = 3;
  // 默认最多 3 次，平衡成功率与成本。
  let lastError: Error | undefined;
  let retryContext = context;

  console.log(chalk.cyan(`Starting ${description} with ${maxRetries} max attempts`));

  let auditSession: AuditSession | null = null;
  if (sessionMetadata && agentName) {
    auditSession = new AuditSession(sessionMetadata);
    await auditSession.initialize();
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 每次重试前都创建 `git` 检查点，保证可回溯。
    await createGitCheckpoint(sourceDir, description, attempt);

    if (auditSession && agentName) {
      const fullPrompt = retryContext ? `${retryContext}\n\n${prompt}` : prompt;
      await auditSession.startAgent(agentName, fullPrompt, attempt);
    }

    try {
      const result = await runClaudePrompt(
        prompt, sourceDir, retryContext,
        description, agentName, colorFn, sessionMetadata, auditSession, attempt
      );

      if (result.success) {
        const validationPassed = await validateAgentOutput(result, agentName, sourceDir);

        if (validationPassed) {
          if (result.apiErrorDetected) {
            console.log(chalk.yellow(`Validation: Ready for exploitation despite API error warnings`));
          }

          if (auditSession && agentName) {
            const commitHash = await getGitCommitHash(sourceDir);
            const endResult: {
              attemptNumber: number;
              duration_ms: number;
              cost_usd: number;
              total_tokens: number;
              success: true;
              checkpoint?: string;
            } = {
              attemptNumber: attempt,
              duration_ms: result.duration,
              cost_usd: result.cost || 0,
              total_tokens: result.totalTokens || 0,
              success: true,
            };
            if (commitHash) {
              endResult.checkpoint = commitHash;
            }
            await auditSession.endAgent(agentName, endResult);
          }

          await commitGitSuccess(sourceDir, description);
          console.log(chalk.green.bold(`${description} completed successfully on attempt ${attempt}/${maxRetries}`));
          return result;
        // Validation failure is retryable - agent might succeed on retry with cleaner workspace
        // 交付物缺失常见于中间步骤中断，清理工作区后重试通常可以恢复。
        } else {
          console.log(chalk.yellow(`${description} completed but output validation failed`));

          if (auditSession && agentName) {
            await auditSession.endAgent(agentName, {
              attemptNumber: attempt,
              duration_ms: result.duration,
              cost_usd: result.partialCost || result.cost || 0,
              total_tokens: result.totalTokens || 0,
              success: false,
              error: 'Output validation failed',
              isFinalAttempt: attempt === maxRetries
            });
          }

          if (result.apiErrorDetected) {
            console.log(chalk.yellow(`API Error detected with validation failure - treating as retryable`));
            lastError = new Error('API Error: terminated with validation failure');
          } else {
            lastError = new Error('Output validation failed');
          }

          if (attempt < maxRetries) {
            await rollbackGitWorkspace(sourceDir, 'validation failure');
            continue;
          } else {
            throw new PentestError(
              `Agent ${description} failed output validation after ${maxRetries} attempts. Required deliverable files were not created.`,
              'validation',
              false,
              { description, sourceDir, attemptsExhausted: maxRetries }
            );
          }
        }
      }

    } catch (error) {
      const err = error as Error & { duration?: number; cost?: number; partialResults?: unknown };
      lastError = err;

      if (auditSession && agentName) {
        await auditSession.endAgent(agentName, {
          attemptNumber: attempt,
          duration_ms: err.duration || 0,
          cost_usd: err.cost || 0,
          total_tokens: 0,
          success: false,
          error: err.message,
          isFinalAttempt: attempt === maxRetries
        });
      }

      if (!isRetryableError(err)) {
        // 不可重试错误立即终止，并执行一次清理回滚。
        console.log(chalk.red(`${description} failed with non-retryable error: ${err.message}`));
        await rollbackGitWorkspace(sourceDir, 'non-retryable error cleanup');
        throw err;
      }

      if (attempt < maxRetries) {
        // 可重试错误执行指数退避等待，并可附带 partialResults 作为下一轮上下文。
        // 这里先回滚工作区，再进入指数退避等待，避免脏状态传播到下一轮。
        await rollbackGitWorkspace(sourceDir, 'retryable error cleanup');

        const delay = getRetryDelay(err, attempt);
        const delaySeconds = (delay / 1000).toFixed(1);
        console.log(chalk.yellow(`${description} failed (attempt ${attempt}/${maxRetries})`));
        console.log(chalk.gray(`    Error: ${err.message}`));
        console.log(chalk.gray(`    Workspace rolled back, retrying in ${delaySeconds}s...`));

        if (err.partialResults) {
          retryContext = `${context}\n\nPrevious partial results: ${JSON.stringify(err.partialResults)}`;
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        await rollbackGitWorkspace(sourceDir, 'final failure cleanup');
        console.log(chalk.red(`${description} failed after ${maxRetries} attempts`));
        console.log(chalk.red(`    Final error: ${err.message}`));
      }
    }
  }

  throw lastError;
}

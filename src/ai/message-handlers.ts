// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义 `AI` `SDK` 消息事件的分发与处理逻辑，将增量输出、工具事件与状态事件转换为统一结构。
 * 该文件用于隔离消息协议细节，避免执行器主流程被事件处理细节污染。
 */

// Pure functions for processing SDK message types
// 本文件函数尽量保持纯函数风格，输入消息 -> 输出结构化结果，
// 便于测试与在不同执行器环境中复用。

import { PentestError } from '../error-handling.js';
import { filterJsonToolCalls } from '../utils/output-formatter.js';
import { formatTimestamp } from '../utils/formatting.js';
import chalk from 'chalk';
import { getActualModelName } from './router-utils.js';
import {
  formatAssistantOutput,
  formatResultOutput,
  formatToolUseOutput,
  formatToolResultOutput,
} from './output-formatters.js';
import { costResults } from '../utils/metrics.js';
import type { AuditLogger } from './audit-logger.js';
import type { ProgressManager } from './progress-manager.js';
import type {
  AssistantMessage,
  SDKAssistantMessageError,
  ResultMessage,
  ToolUseMessage,
  ToolResultMessage,
  AssistantResult,
  ResultData,
  ToolUseData,
  ToolResultData,
  ApiErrorDetection,
  ContentBlock,
  SystemInitMessage,
  ExecutionContext,
} from './types.js';
import type { ChalkInstance } from 'chalk';

// Token calculation: Claude Sonnet ~$10/1M average
const TOKENS_PER_DOLLAR = 100_000;

// Handles both array and string content formats from SDK
// `SDK` 的 `message.content` 可能是数组（结构化内容块）或字符串，
// 此函数统一抽取可读文本，供日志与终端显示使用。
export function extractMessageContent(message: AssistantMessage): string {
  const messageContent = message.message;

  if (Array.isArray(messageContent.content)) {
    return messageContent.content
      .map((c: ContentBlock) => c.text || JSON.stringify(c))
      .join('\n');
  }

  return String(messageContent.content);
}

// Extracts only text content (no tool_use JSON) to avoid false positives in error detection
// 错误检测只看自然语言文本，忽略工具调用结构化数据，
// 防止报告内容中的关键词误触发 `API` 错误判定。
export function extractTextOnlyContent(message: AssistantMessage): string {
  const messageContent = message.message;

  if (Array.isArray(messageContent.content)) {
    return messageContent.content
      .filter((c: ContentBlock) => c.type === 'text' || c.text)
      .map((c: ContentBlock) => c.text || '')
      .join('\n');
  }

  return String(messageContent.content);
}

export function detectApiError(content: string): ApiErrorDetection {
  if (!content || typeof content !== 'string') {
    return { detected: false };
  }

  const lowerContent = content.toLowerCase();

  // === BILLING/SPENDING CAP ERRORS (Retryable with long backoff) ===
  // 命中计费上限属于可恢复错误，交由上层以长退避重试。
  // When Claude Code hits its spending cap, it returns a short message like
  // 部分计费异常会“伪装成正常文本回复”而非抛异常。
  // "Spending cap reached resets 8am" instead of throwing an error.
  // 例如会返回类似“达到额度上限，将在稍后重置”的文本，而不是直接抛异常。
  // These should retry with 5-30 min backoff so workflows can recover when cap resets.
  // 识别后标记为可重试，让工作流等待额度恢复后继续。
  const BILLING_PATTERNS = [
    'spending cap',
    'spending limit',
    'cap reached',
    'budget exceeded',
    'usage limit',
  ];

  const isBillingError = BILLING_PATTERNS.some((pattern) =>
    lowerContent.includes(pattern)
  );

  if (isBillingError) {
    return {
      detected: true,
      shouldThrow: new PentestError(
        `Billing limit reached: ${content.slice(0, 100)}`,
        'billing',
        true // RETRYABLE - Temporal will use 5-30 min backoff
      ),
    };
  }

  // === SESSION LIMIT (Non-retryable) ===
  // 会话上限通常意味着配置或账户状态问题，直接判定不可重试。
  // Different from spending cap - usually means something is fundamentally wrong
  // 这与额度上限不同，通常表示配置或环境存在根本问题。
  if (lowerContent.includes('session limit reached')) {
    return {
      detected: true,
      shouldThrow: new PentestError('Session limit reached', 'billing', false),
    };
  }

  // Non-fatal API errors - detected but continue
  // 部分错误仅做标记，不立即抛出，让后续校验阶段再决定是否失败。
  if (lowerContent.includes('api error') || lowerContent.includes('terminated')) {
    return { detected: true };
  }

  return { detected: false };
}

// Maps SDK structured error types to our error handling.
// 将 `SDK` 的枚举错误映射到 Lumin 的统一错误模型，
// 统一控制可重试策略，便于 `Temporal` 编排层处理。
function handleStructuredError(
  errorType: SDKAssistantMessageError,
  content: string
): ApiErrorDetection {
  switch (errorType) {
    case 'billing_error':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Billing error (structured): ${content.slice(0, 100)}`,
          'billing',
          true // Retryable with backoff
        ),
      };
    case 'rate_limit':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Rate limit hit (structured): ${content.slice(0, 100)}`,
          'network',
          true // Retryable with backoff
        ),
      };
    case 'authentication_failed':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Authentication failed: ${content.slice(0, 100)}`,
          'config',
          false // Not retryable - needs API key fix
        ),
      };
    case 'server_error':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Server error (structured): ${content.slice(0, 100)}`,
          'network',
          true // Retryable
        ),
      };
    case 'invalid_request':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Invalid request: ${content.slice(0, 100)}`,
          'config',
          false // Not retryable - needs code fix
        ),
      };
    case 'max_output_tokens':
      return {
        detected: true,
        shouldThrow: new PentestError(
          `Max output tokens reached: ${content.slice(0, 100)}`,
          'billing',
          true // Retryable - may succeed with different content
        ),
      };
    case 'unknown':
    default:
      return { detected: true };
  }
}

export function handleAssistantMessage(
  message: AssistantMessage,
  turnCount: number
): AssistantResult {
  const content = extractMessageContent(message);
  const cleanedContent = filterJsonToolCalls(content);

  // Prefer structured error field from SDK, fall back to text-sniffing
  // 优先使用 `SDK` 结构化错误字段，缺失时再回退到文本识别。
  // Use text-only content for error detection to avoid false positives
  // 错误检测只使用纯文本内容，避免误判。
  // from tool_use JSON (e.g. security reports containing "usage limit")
  // 例如报告中出现额度相关关键词时，不应被工具调用结构化数据误导。
  let errorDetection: ApiErrorDetection;
  if (message.error) {
    errorDetection = handleStructuredError(message.error, content);
  } else {
    const textOnlyContent = extractTextOnlyContent(message);
    errorDetection = detectApiError(textOnlyContent);
  }

  const result: AssistantResult = {
    content,
    cleanedContent,
    apiErrorDetected: errorDetection.detected,
    logData: {
      turn: turnCount,
      content,
      timestamp: formatTimestamp(),
    },
  };

  // Only add shouldThrow if it exists (exactOptionalPropertyTypes compliance)
  // 避免在严格可选类型下写入 `undefined` 字段。
  if (errorDetection.shouldThrow) {
    result.shouldThrow = errorDetection.shouldThrow;
  }

  return result;
}

// Final message of a query with cost/duration info
// `result` 消息标志一次模型调用结束，携带最终文本、成本与耗时。
export function handleResultMessage(message: ResultMessage): ResultData {
  const cost = message.total_cost_usd || 0;
  const totalTokens = Math.round(cost * TOKENS_PER_DOLLAR);

  const result: ResultData = {
    result: message.result || null,
    cost,
    total_tokens: totalTokens,
    duration_ms: message.duration_ms || 0,
    permissionDenials: message.permission_denials?.length || 0,
  };

  // Only add subtype if it exists (exactOptionalPropertyTypes compliance)
  // 保持与类型系统一致，不主动注入空字段。
  if (message.subtype) {
    result.subtype = message.subtype;
  }

  // Capture stop_reason for diagnostics (helps debug early stops, budget exceeded, etc.)
  // 记录停止原因便于定位“提前停止/预算限制”等问题。
    if (message.stop_reason !== undefined) {
    result.stop_reason = message.stop_reason;
    if (message.stop_reason && message.stop_reason !== 'end_turn') {
        console.log(chalk.yellow(`    停止原因：${message.stop_reason}`));
    }
  }

  return result;
}

export function handleToolUseMessage(message: ToolUseMessage): ToolUseData {
  return {
    toolName: message.name,
    parameters: message.input || {},
    timestamp: formatTimestamp(),
  };
}

// Truncates long results for display (500 char limit), preserves full content for logging
// 终端展示采用截断策略控制噪音，但审计日志仍保留完整结果。
export function handleToolResultMessage(message: ToolResultMessage): ToolResultData {
  const content = message.content;
  const contentStr =
    typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  const displayContent =
    contentStr.length > 500
      ? `${contentStr.slice(0, 500)}...\n[Result truncated - ${contentStr.length} total chars]`
      : contentStr;

  return {
    content,
    displayContent,
    timestamp: formatTimestamp(),
  };
}

// Output helper for console logging
// 统一逐行输出，避免重复编写循环逻辑。
function outputLines(lines: string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}

// Message dispatch result types
// `continue` 表示继续消费流；`complete` 表示拿到最终结果；`throw` 表示中断并抛错。
export type MessageDispatchAction =
  | { type: 'continue'; apiErrorDetected?: boolean | undefined; model?: string | undefined }
  | { type: 'complete'; result: string | null; cost: number }
  | { type: 'throw'; error: Error };

export interface MessageDispatchDeps {
  // `execContext`：当前执行上下文（并行与串行、展示策略、`agent` 标识等）。
  execContext: ExecutionContext;
  // `description`：当前代理任务的人类可读名称，用于终端展示。
  description: string;
  // `colorFn`：输出着色函数，便于不同阶段风格区分。
  colorFn: ChalkInstance;
  // `progress`：进度管理器，用于在流式输出和转圈提示之间协调。
  progress: ProgressManager;
  // `auditLogger`：审计日志适配器，负责持久化模型与工具事件。
  auditLogger: AuditLogger;
}

// Dispatches SDK messages to appropriate handlers and formatters
// 消息分发主入口。按消息类型路由到对应处理函数，
// 并返回三态结果，驱动上层流式循环。
export async function dispatchMessage(
  message: { type: string; subtype?: string },
  turnCount: number,
  deps: MessageDispatchDeps
): Promise<MessageDispatchAction> {
  const { execContext, description, colorFn, progress, auditLogger } = deps;

  switch (message.type) {
    case 'assistant': {
      const assistantResult = handleAssistantMessage(message as AssistantMessage, turnCount);

      if (assistantResult.shouldThrow) {
        return { type: 'throw', error: assistantResult.shouldThrow };
      }

      if (assistantResult.cleanedContent.trim()) {
        progress.stop();
        outputLines(formatAssistantOutput(
          assistantResult.cleanedContent,
          execContext,
          turnCount,
          description,
          colorFn
        ));
        progress.start();
      }

      await auditLogger.logLlmResponse(turnCount, assistantResult.content);

      if (assistantResult.apiErrorDetected) {
        console.log(chalk.red(`    在助手响应中检测到 API 异常`));
        return { type: 'continue', apiErrorDetected: true };
      }

      return { type: 'continue' };
    }

    case 'system': {
      if (message.subtype === 'init') {
        const initMsg = message as SystemInitMessage;
        const actualModel = getActualModelName(initMsg.model);
        if (!execContext.useCleanOutput) {
          console.log(chalk.blue(`    模型：${actualModel}，权限模式：${initMsg.permissionMode}`));
          if (initMsg.mcp_servers && initMsg.mcp_servers.length > 0) {
            const mcpStatus = initMsg.mcp_servers.map(s => `${s.name}(${s.status})`).join(', ');
            console.log(chalk.blue(`    MCP 服务：${mcpStatus}`));
          }
        }
        // Return actual model for tracking in audit logs
        // 把实际模型名上传给上层，用于审计与成本归因。
        return { type: 'continue', model: actualModel };
      }
      return { type: 'continue' };
    }

    case 'user':
    case 'tool_progress':
    case 'tool_use_summary':
    case 'auth_status':
      return { type: 'continue' };

    case 'tool_use': {
      const toolData = handleToolUseMessage(message as unknown as ToolUseMessage);
      outputLines(formatToolUseOutput(toolData.toolName, toolData.parameters));
      await auditLogger.logToolStart(toolData.toolName, toolData.parameters);
      return { type: 'continue' };
    }

    case 'tool_result': {
      const toolResultData = handleToolResultMessage(message as unknown as ToolResultMessage);
      outputLines(formatToolResultOutput(toolResultData.displayContent));
      await auditLogger.logToolEnd(toolResultData.content);
      return { type: 'continue' };
    }

    case 'result': {
      const resultData = handleResultMessage(message as ResultMessage);
      outputLines(formatResultOutput(resultData, !execContext.useCleanOutput));
      costResults.agents[execContext.agentKey] = resultData.cost;
      costResults.total += resultData.cost;
      return { type: 'complete', result: resultData.result, cost: resultData.cost };
    }

    default:
      console.log(chalk.gray(`    ${message.type}: ${JSON.stringify(message, null, 2)}`));
      return { type: 'continue' };
  }
}

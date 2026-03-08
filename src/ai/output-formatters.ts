// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供控制台输出格式化能力，包括错误信息、完成提示、环境识别与流式文本展现策略。
 * 该文件保证不同运行场景（本地/容器/CI）下日志可读性与展示一致性。
 */

// Pure functions for formatting console output
// 用于格式化控制台输出的纯函数。

import chalk from 'chalk';
import { extractAgentType, formatDuration } from '../utils/formatting.js';
import { getAgentPrefix } from '../utils/output-formatter.js';
import type { ExecutionContext, ResultData } from './types.js';

export function detectExecutionContext(description: string): ExecutionContext {
  const isParallelExecution =
    description.includes('vuln agent') || description.includes('exploit agent');

  const useCleanOutput =
    description.includes('Pre-recon agent') ||
    description.includes('Recon agent') ||
    description.includes('Executive Summary and Report Cleanup') ||
    description.includes('vuln agent') ||
    description.includes('exploit agent');

  const agentType = extractAgentType(description);

  const agentKey = description.toLowerCase().replace(/\s+/g, '-');

  return { isParallelExecution, useCleanOutput, agentType, agentKey };
}

export function formatAssistantOutput(
  cleanedContent: string,
  context: ExecutionContext,
  turnCount: number,
  description: string,
  colorFn: typeof chalk.cyan = chalk.cyan
): string[] {
  if (!cleanedContent.trim()) {
    return [];
  }

  const lines: string[] = [];

  if (context.isParallelExecution) {
    // Compact output for parallel agents with prefixes
    // Compact output for 并行 agents with prefixes。
    const prefix = getAgentPrefix(description);
    lines.push(colorFn(`${prefix} ${cleanedContent}`));
  } else {
    // Full turn output for sequential agents
    // Full turn output for 串行 agents。
    lines.push(colorFn(`\n    第 ${turnCount} 轮（${description}）：`));
    lines.push(colorFn(`    ${cleanedContent}`));
  }

  return lines;
}

export function formatResultOutput(data: ResultData, showFullResult: boolean): string[] {
  const lines: string[] = [];
  const tokens = data.total_tokens || Math.round((data.cost || 0) * 100_000);

  lines.push(chalk.magenta(`\n    已完成：`));
  lines.push(
    chalk.gray(
      `    耗时：${(data.duration_ms / 1000).toFixed(1)}s，${tokens.toLocaleString()} tokens`
    )
  );

  if (data.subtype === 'error_max_turns') {
    lines.push(chalk.red(`    已停止：达到最大轮次限制`));
  } else if (data.subtype === 'error_during_execution') {
    lines.push(chalk.red(`    已停止：执行过程发生错误`));
  }

  if (data.permissionDenials > 0) {
    lines.push(chalk.yellow(`    权限拒绝次数：${data.permissionDenials}`));
  }

  if (showFullResult && data.result && typeof data.result === 'string') {
    if (data.result.length > 1000) {
      lines.push(chalk.magenta(`    ${data.result.slice(0, 1000)}... [总长度 ${data.result.length} 字符]`));
    } else {
      lines.push(chalk.magenta(`    ${data.result}`));
    }
  }

  return lines;
}

export function formatErrorOutput(
  error: Error & { code?: string; status?: number },
  context: ExecutionContext,
  description: string,
  duration: number,
  sourceDir: string,
  isRetryable: boolean
): string[] {
  const lines: string[] = [];

  if (context.isParallelExecution) {
    const prefix = getAgentPrefix(description);
    lines.push(chalk.red(`${prefix} 失败（${formatDuration(duration)}）`));
  } else if (context.useCleanOutput) {
    lines.push(chalk.red(`${context.agentType} 失败（${formatDuration(duration)}）`));
  } else {
    lines.push(chalk.red(`  Claude Code 执行失败：${description}（${formatDuration(duration)}）`));
  }

  lines.push(chalk.red(`    错误类型：${error.constructor.name}`));
  lines.push(chalk.red(`    错误信息：${error.message}`));
  lines.push(chalk.gray(`    代理：${description}`));
  lines.push(chalk.gray(`    工作目录：${sourceDir}`));
  lines.push(chalk.gray(`    可重试：${isRetryable ? '是' : '否'}`));

  if (error.code) {
    lines.push(chalk.gray(`    错误代码：${error.code}`));
  }
  if (error.status) {
    lines.push(chalk.gray(`    HTTP 状态码：${error.status}`));
  }

  return lines;
}

export function formatCompletionMessage(
  context: ExecutionContext,
  description: string,
  turnCount: number,
  duration: number
): string {
  if (context.isParallelExecution) {
    const prefix = getAgentPrefix(description);
    return chalk.green(`${prefix} 完成（${turnCount} 轮，${formatDuration(duration)}）`);
  }

  if (context.useCleanOutput) {
    return chalk.green(
      `${context.agentType.charAt(0).toUpperCase() + context.agentType.slice(1)} 完成！（${turnCount} 轮，${formatDuration(duration)}）`
    );
  }

  return chalk.green(
    `  Claude Code 执行完成：${description}（${turnCount} 轮），耗时 ${formatDuration(duration)}`
  );
}

export function formatToolUseOutput(
  toolName: string,
  input: Record<string, unknown> | undefined
): string[] {
  const lines: string[] = [];

  lines.push(chalk.yellow(`\n    调用工具：${toolName}`));
  if (input && Object.keys(input).length > 0) {
    lines.push(chalk.gray(`    输入参数：${JSON.stringify(input, null, 2)}`));
  }

  return lines;
}

export function formatToolResultOutput(displayContent: string): string[] {
  const lines: string[] = [];

  lines.push(chalk.green(`    工具结果：`));
  if (displayContent) {
    lines.push(chalk.gray(`    ${displayContent}`));
  }

  return lines;
}

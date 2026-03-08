// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责将代理结果转换为统一输出文本，适配终端展示与日志落盘。
 * 该文件用于统一结果可读性，减少调用侧格式化重复逻辑。
 */

import { AGENTS } from '../session-manager.js';

interface ToolCallInput {
  url?: string;
  element?: string;
  key?: string;
  fields?: unknown[];
  text?: string;
  action?: string;
  description?: string;
  todos?: Array<{
    status: string;
    content: string;
  }>;
  [key: string]: unknown;
}

interface ToolCall {
  name: string;
  input?: ToolCallInput;
}

/**
 * Extract domain from URL for display
 * Extract domain 来自 URL for display。
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname || url.slice(0, 30);
  } catch {
    return url.slice(0, 30);
  }
}

/**
 * Summarize TodoWrite updates into clean progress indicators
 * Summarize TodoWrite updates 写入 clean 进度 indicators。
 */
function summarizeTodoUpdate(input: ToolCallInput | undefined): string | null {
  if (!input?.todos || !Array.isArray(input.todos)) {
    return null;
  }

  const todos = input.todos;
  const completed = todos.filter((t) => t.status === 'completed');
  const inProgress = todos.filter((t) => t.status === 'in_progress');

  // Show recently completed tasks
  // Show recently completed tasks。
  if (completed.length > 0) {
    const recent = completed[completed.length - 1]!;
    return `✅ ${recent.content}`;
  }

  // Show current in-progress task
  // Show current in-进度 task。
  if (inProgress.length > 0) {
    const current = inProgress[0]!;
    return `🔄 ${current.content}`;
  }

  return null;
}

/**
 * Get agent prefix for parallel execution
 * Get 代理 prefix for 并行 execution。
 */
export function getAgentPrefix(description: string): string {
  // Map agent names to their prefixes
  // Map 代理 names to their prefixes。
  const agentPrefixes: Record<string, string> = {
    'injection-vuln': '[Injection]',
    'xss-vuln': '[XSS]',
    'auth-vuln': '[Auth]',
    'authz-vuln': '[Authz]',
    'ssrf-vuln': '[SSRF]',
    'injection-exploit': '[Injection]',
    'xss-exploit': '[XSS]',
    'auth-exploit': '[Auth]',
    'authz-exploit': '[Authz]',
    'ssrf-exploit': '[SSRF]',
  };

  // First try to match by agent name directly
  // First try to match by 代理 name directly。
  for (const [agentName, prefix] of Object.entries(agentPrefixes)) {
    const agent = AGENTS[agentName as keyof typeof AGENTS];
    if (agent && description.includes(agent.displayName)) {
      return prefix;
    }
  }

  // Fallback to partial matches for backwards compatibility
  // 回退 to partial matches for backwards compatibility。
  if (description.includes('injection')) return '[Injection]';
  if (description.includes('xss')) return '[XSS]';
  if (description.includes('authz')) return '[Authz]'; // Check authz before auth
  if (description.includes('auth')) return '[Auth]';
  if (description.includes('ssrf')) return '[SSRF]';

  return '[Agent]';
}

/**
 * Format browser tool calls into clean progress indicators
 * 格式 browser 工具 calls 写入 clean 进度 indicators。
 */
function formatBrowserAction(toolCall: ToolCall): string {
  const toolName = toolCall.name;
  const input = toolCall.input || {};

  // Core Browser Operations
  // Core Browser Operations。
  if (toolName === 'mcp__playwright__browser_navigate') {
    const url = input.url || '';
    const domain = extractDomain(url);
    return `🌐 Navigating to ${domain}`;
  }

  if (toolName === 'mcp__playwright__browser_navigate_back') {
    return `⬅️ Going back`;
  }

  // Page Interaction
  // Page Interaction。
  if (toolName === 'mcp__playwright__browser_click') {
    const element = input.element || 'element';
    return `🖱️ Clicking ${element.slice(0, 25)}`;
  }

  if (toolName === 'mcp__playwright__browser_hover') {
    const element = input.element || 'element';
    return `👆 Hovering over ${element.slice(0, 20)}`;
  }

  if (toolName === 'mcp__playwright__browser_type') {
    const element = input.element || 'field';
    return `⌨️ Typing in ${element.slice(0, 20)}`;
  }

  if (toolName === 'mcp__playwright__browser_press_key') {
    const key = input.key || 'key';
    return `⌨️ Pressing ${key}`;
  }

  // Form Handling
  // Form 处理。
  if (toolName === 'mcp__playwright__browser_fill_form') {
    const fieldCount = input.fields?.length || 0;
    return `📝 Filling ${fieldCount} form fields`;
  }

  if (toolName === 'mcp__playwright__browser_select_option') {
    return `📋 Selecting dropdown option`;
  }

  if (toolName === 'mcp__playwright__browser_file_upload') {
    return `📁 Uploading file`;
  }

  // Page Analysis
  // Page Analysis。
  if (toolName === 'mcp__playwright__browser_snapshot') {
    return `📸 Taking page snapshot`;
  }

  if (toolName === 'mcp__playwright__browser_take_screenshot') {
    return `📸 Taking screenshot`;
  }

  if (toolName === 'mcp__playwright__browser_evaluate') {
    return `🔍 Running JavaScript analysis`;
  }

  // Waiting & Monitoring
  // Waiting & Monitoring。
  if (toolName === 'mcp__playwright__browser_wait_for') {
    if (input.text) {
      return `⏳ Waiting for "${input.text.slice(0, 20)}"`;
    }
    return `⏳ Waiting for page response`;
  }

  if (toolName === 'mcp__playwright__browser_console_messages') {
    return `📜 Checking console logs`;
  }

  if (toolName === 'mcp__playwright__browser_network_requests') {
    return `🌐 Analyzing network traffic`;
  }

  // Tab Management
  // Tab Management。
  if (toolName === 'mcp__playwright__browser_tabs') {
    const action = input.action || 'managing';
    return `🗂️ ${action} browser tab`;
  }

  // Dialog Handling
  // Dialog 处理。
  if (toolName === 'mcp__playwright__browser_handle_dialog') {
    return `💬 Handling browser dialog`;
  }

  // Fallback for any missed tools
  // 回退 for any missed 工具。
  const actionType = toolName.split('_').pop();
  return `🌐 Browser: ${actionType}`;
}

/**
 * Filter out JSON tool calls from content, with special handling for Task calls
 * Filter out JSON 工具 calls 来自 内容, with special 处理 for Task calls。
 */
export function filterJsonToolCalls(content: string | null | undefined): string {
  if (!content || typeof content !== 'string') {
    return content || '';
  }

  const lines = content.split('\n');
  const processedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    // 跳过 empty lines。
    if (trimmed === '') {
      continue;
    }

    // Check if this is a JSON tool call
    // 检查 如果 this is a JSON 工具 call。
    if (trimmed.startsWith('{"type":"tool_use"')) {
      try {
        const toolCall = JSON.parse(trimmed) as ToolCall;

        // Special handling for Task tool calls
        // Special 处理 for Task 工具 calls。
        if (toolCall.name === 'Task') {
          const description = toolCall.input?.description || 'analysis agent';
          processedLines.push(`🚀 Launching ${description}`);
          continue;
        }

        // Special handling for TodoWrite tool calls
        // Special 处理 for TodoWrite 工具 calls。
        if (toolCall.name === 'TodoWrite') {
          const summary = summarizeTodoUpdate(toolCall.input);
          if (summary) {
            processedLines.push(summary);
          }
          continue;
        }

        // Special handling for browser tool calls
        // Special 处理 for browser 工具 calls。
        if (toolCall.name.startsWith('mcp__playwright__browser_')) {
          const browserAction = formatBrowserAction(toolCall);
          if (browserAction) {
            processedLines.push(browserAction);
          }
          continue;
        }

        // Hide all other tool calls (Read, Write, Grep, etc.)
        // Hide all other 工具 calls (读取, 写入, Grep, etc.)。
        continue;
      } catch {
        // If JSON parsing fails, treat as regular text
        // 如果 JSON parsing fails, treat as regular text。
        processedLines.push(line);
      }
    } else {
      // Keep non-JSON lines (assistant text)
      // Keep non-JSON lines (assistant text)。
      processedLines.push(line);
    }
  }

  return processedLines.join('\n');
}

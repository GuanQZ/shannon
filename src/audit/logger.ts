// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供追加写（append-only）日志能力，记录各代理阶段输入输出、状态与关键事件。
 * 该文件保证日志可追溯且尽量避免覆盖写导致的信息丢失。
 */

/**
 * Append-Only Agent Logger
 * Append-仅 代理 日志器。
 *
 * Provides crash-safe, append-only logging for agent execution.
 * Provides crash-安全, append-仅 日志记录 for 代理 execution.。
 * Uses file streams with immediate flush to prevent data loss.
 * Uses 文件 streams with immediate flush to 防止 data loss.。
 */

import fs from 'fs';
import {
  generateLogPath,
  generateChineseLogPath,
  generatePromptPath,
  type SessionMetadata,
} from './utils.js';
import { atomicWrite } from '../utils/file-io.js';
import { InternalAgentClient, isInternalAgentEnabled } from '../ai/providers/internal-agent.js';
import { formatTimestamp } from '../utils/formatting.js';

interface LogEvent {
  type: string;
  timestamp: string;
  data: unknown;
}

// Check if event type should be displayed in dashboard (filtered view)
function shouldDisplayEvent(eventType: string, eventData: unknown): boolean {
  // Always include agent start/end
  if (eventType === 'agent_start' || eventType === 'agent_end') {
    return true;
  }

  // For llm_response, check the content
  if (eventType === 'llm_response') {
    const data = eventData as { content?: string };
    if (data?.content) {
      try {
        const parsed = JSON.parse(data.content);
        // Include thinking and text, exclude tool_use
        if (parsed.type === 'thinking' || parsed.type === 'text' || !parsed.type) {
          return true;
        }
      } catch {
        // If not JSON, include as text
        return data.content.trim().length > 0;
      }
    }
  }

  return false;
}

// Extract displayable content from event
function extractDisplayContent(eventType: string, eventData: unknown): string | null {
  if (eventType === 'agent_start') {
    const data = eventData as { agentName?: string };
    return `Agent ${data.agentName || 'unknown'} started`;
  }

  if (eventType === 'agent_end') {
    const data = eventData as { agentName?: string; success?: boolean };
    return `Agent ${data.agentName || 'unknown'} ${data.success ? 'completed successfully' : 'failed'}`;
  }

  if (eventType === 'llm_response') {
    const data = eventData as { content?: string };
    if (data?.content) {
      try {
        const parsed = JSON.parse(data.content);
        if (parsed.type === 'thinking') {
          return parsed.thinking;
        }
        if (parsed.type === 'text' || !parsed.type) {
          return data.content;
        }
      } catch {
        return data.content;
      }
    }
  }

  return null;
}

// Translate text to Chinese using internal agent (chat method only)
async function translateToChinese(text: string): Promise<string> {
  // Skip if already contains Chinese
  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (chineseRegex.test(text)) {
    return text;
  }

  // Use internal agent via chat
  if (isInternalAgentEnabled()) {
    const internalAgent = InternalAgentClient.create();
    if (!internalAgent) {
      console.warn('[Chinese Translation] Failed to create internal agent client, skipping translation');
      return text;
    }

    try {
      await internalAgent.initSession();

      const prompt = `Translate to Simplified Chinese. Keep technical terms (CVEs, payloads, endpoints, HTTP methods, file paths, code) in English. Output ONLY the translation:

${text}`;

      const response = await internalAgent.chat(prompt);
      if (response.success && response.result) {
        console.log('[Chinese Translation] Translated:', text.substring(0, 50), '->', response.result.substring(0, 50));
        return response.result;
      } else {
        console.warn('[Chinese Translation] Chat failed or no result, skipping translation');
        return text;
      }
    } catch (error) {
      console.error('[Chinese Translation] Error:', error);
      return text;
    }
  }

  // No fallback - if internal agent is not configured, return original text
  console.warn('[Chinese Translation] Internal agent not enabled, skipping translation');
  return text;
}

/**
 * AgentLogger - Manages append-only logging for a single agent execution
 * AgentLogger - Manages append-仅 日志记录 for a single 代理 execution。
 */
export class AgentLogger {
  private sessionMetadata: SessionMetadata;
  private agentName: string;
  private attemptNumber: number;
  private timestamp: number;
  private logPath: string;
  private chineseLogPath: string;
  private stream: fs.WriteStream | null = null;
  private chineseStream: fs.WriteStream | null = null;
  private isOpen: boolean = false;

  constructor(sessionMetadata: SessionMetadata, agentName: string, attemptNumber: number) {
    this.sessionMetadata = sessionMetadata;
    this.agentName = agentName;
    this.attemptNumber = attemptNumber;
    this.timestamp = Date.now();

    // Generate log file path
    // 生成 log 文件 path。
    this.logPath = generateLogPath(sessionMetadata, agentName, this.timestamp, attemptNumber);

    // Generate Chinese log file path
    // 生成中文 log 文件 path。
    this.chineseLogPath = generateChineseLogPath(sessionMetadata, agentName);
  }

  /**
   * Initialize the log stream (creates file and opens stream)
   * Initialize the log stream (creates 文件 and opens stream)。
   */
  async initialize(): Promise<void> {
    if (this.isOpen) {
      return; // Already initialized
    }

    // Create write stream with append mode and auto-flush
    // 创建 写入 stream with append 模式 and auto-flush。
    this.stream = fs.createWriteStream(this.logPath, {
      flags: 'a', // Append mode
      encoding: 'utf8',
      autoClose: true,
    });

    // Create Chinese log stream (overwrite mode - each run starts fresh)
    // 创建中文 log stream（覆盖模式 - 每次运行重新开始）。
    this.chineseStream = fs.createWriteStream(this.chineseLogPath, {
      flags: 'w', // Write mode (overwrite)
      encoding: 'utf8',
      autoClose: true,
    });

    this.isOpen = true;

    // Write header
    // 写入 header。
    await this.writeHeader();
  }

  /**
   * Write header to log file
   * 写入 header to log 文件。
   */
  private async writeHeader(): Promise<void> {
    const header = [
      `========================================`,
      `Agent: ${this.agentName}`,
      `Attempt: ${this.attemptNumber}`,
      `Started: ${formatTimestamp(this.timestamp)}`,
      `Session: ${this.sessionMetadata.id}`,
      `Web URL: ${this.sessionMetadata.webUrl}`,
      `========================================\n`,
    ].join('\n');

    return this.writeRaw(header);
  }

  /**
   * Write raw text to log file with immediate flush
   * 写入 raw text to log 文件 with immediate flush。
   */
  private writeRaw(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen || !this.stream) {
        reject(new Error('Logger not initialized'));
        return;
      }

      const needsDrain = !this.stream.write(text, 'utf8', (error) => {
        if (error) reject(error);
      });

      if (needsDrain) {
        this.stream.once('drain', resolve);
      } else {
        resolve();
      }
    });
  }

  /**
   * Log an event (tool_start, tool_end, llm_response, etc.)
   * Log an event (tool_start, tool_end, llm_response, etc.)。
   * Events are logged as JSON for parseability
   * Events are logged as JSON for parseability。
   */
  async logEvent(eventType: string, eventData: unknown): Promise<void> {
    const event: LogEvent = {
      type: eventType,
      timestamp: formatTimestamp(),
      data: eventData,
    };

    const eventLine = `${JSON.stringify(event)}\n`;
    await this.writeRaw(eventLine);

    // Also write to Chinese log if this is a displayable event
    // 同时写入中文日志（如果是需要显示的事件）。
    if (shouldDisplayEvent(eventType, eventData)) {
      const displayContent = extractDisplayContent(eventType, eventData);
      if (displayContent) {
        // Translate and write asynchronously (don't block)
        translateToChinese(displayContent).then(chineseContent => {
          const chineseLine = JSON.stringify({
            type: eventType,
            timestamp: formatTimestamp(),
            agent: this.agentName,
            content: chineseContent
          }) + '\n';

          if (this.chineseStream) {
            this.chineseStream.write(chineseLine, 'utf8');
          }
        }).catch(err => {
          console.error('Failed to translate log:', err);
        });
      }
    }
  }

  /**
   * Close the log stream
   * Close the log stream。
   */
  async close(): Promise<void> {
    if (!this.isOpen) {
      return;
    }

    // Close English log stream first
    if (this.stream) {
      await new Promise<void>((resolve) => {
        this.stream!.end(() => {
          resolve();
        });
      });
    }

    // Close Chinese log stream
    if (this.chineseStream) {
      await new Promise<void>((resolve) => {
        this.chineseStream!.end(() => {
          resolve();
        });
      });
    }

    this.isOpen = false;
  }

  /**
   * Save prompt snapshot to prompts directory
   * 保存 prompt snapshot to prompts directory。
   * Static method - doesn't require logger instance
   * Static method - doesn't require 日志器 instance。
   */
  static async savePrompt(
    sessionMetadata: SessionMetadata,
    agentName: string,
    promptContent: string
  ): Promise<void> {
    const promptPath = generatePromptPath(sessionMetadata, agentName);

    // Create header with metadata
    // 创建 header with metadata。
    const header = [
      `# Prompt Snapshot: ${agentName}`,
      ``,
      `**Session:** ${sessionMetadata.id}`,
      `**Web URL:** ${sessionMetadata.webUrl}`,
      `**Saved:** ${formatTimestamp()}`,
      ``,
      `---`,
      ``,
    ].join('\n');

    const fullContent = header + promptContent;

    // Use atomic write for safety
    // 使用 atomic 写入 for safety。
    await atomicWrite(promptPath, fullContent);
  }
}

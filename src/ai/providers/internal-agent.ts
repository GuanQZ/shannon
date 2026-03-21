// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 内网 Agent 适配器
 *
 * 提供与内网 Agent 服务对接的能力，支持：
 * - init_session: 获取 session_id
 * - chat: 发送消息（SSE 流式响应）
 * - 日志记录
 *
 * 环境变量配置：
 * - INTERNAL_AGENT_BASE_URL: 内网 Agent 地址
 * - INTERNAL_AGENT_INIT_SESSION_*: init_session 请求参数
 * - INTERNAL_AGENT_CHAT_*: chat 请求参数
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

interface LuminRuntimeConfig {
  internalAgent?: {
    baseUrl?: string;
    initSession?: {
      appId?: string;
      agentId?: string;
      trCode?: string;
      trVersion?: string;
    };
    chat?: {
      appId?: string;
      trCode?: string;
      trVersion?: string;
      stream?: boolean;
    };
    timeout?: number;
  };
  logging?: {
    level?: string;
    verboseToolCalls?: boolean;
  };
}

let cachedRuntimeConfig: LuminRuntimeConfig | null = null;

/**
 * 加载 lumin.yaml 运行时配置
 */
function loadLuminRuntimeConfig(): LuminRuntimeConfig {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }

  try {
    const configPaths = [
      path.resolve(process.cwd(), 'configs/lumin.yaml'),
      path.resolve(process.cwd(), 'lumin.yaml'),
      '/app/configs/lumin.yaml',
      '/app/lumin.yaml',
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        cachedRuntimeConfig = yaml.load(content) as LuminRuntimeConfig;
        console.log(`[InternalAgent] Loaded runtime config from: ${configPath}`);
        return cachedRuntimeConfig || {};
      }
    }

    console.log('[InternalAgent] No runtime config file found, using defaults');
  } catch (error) {
    console.warn(`[InternalAgent] Failed to load runtime config: ${error}`);
  }

  return {};
}

export interface InternalAgentConfig {
  baseUrl: string;
  initSession: {
    appId: string;
    trCode: string;
    trVersion: string;
    agentId: string;
  };
  chat: {
    appId: string;
    trCode: string;
    trVersion: string;
    stream: boolean;
  };
  timeout: number;
}

export interface InitSessionResponse {
  resCode: string;
  resMessage?: string;
  responseId?: string;
  timestamp?: number;
  data: {
    session_id?: string;
    sessionId?: string;
  };
}

export interface ChatMessageEvent {
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  tool_calls?: Array<{
    name: string;
    args: string;
    id: string;
    type: string;
  }>;
}

export interface ChatStartedEvent {
  chat_id: string;
}

export interface DoneEvent {
  code: string;
  success: boolean;
}

export interface SSEEvent {
  event: string;
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  // Dashboard-compatible format for tool_use/tool_result
  toolUse?: {
    name: string;
    input: Record<string, unknown>;
  };
  toolResult?: {
    name: string;
    output: string;
  };
}

export interface ChatResponse {
  result: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  messages: ChatMessage[];  // All messages for audit logging
  success: boolean;
  chatId?: string | undefined;
}

/**
 * 从环境变量加载内网 Agent 配置
 */
export function loadInternalAgentConfig(): InternalAgentConfig | null {
  const baseUrl = process.env.INTERNAL_AGENT_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  // 加载运行时配置
  const runtimeConfig = loadLuminRuntimeConfig();
  const timeout = runtimeConfig.internalAgent?.timeout || 120000; // 默认 2 分钟

  const config: InternalAgentConfig = {
    baseUrl: baseUrl.replace(/\/$/, ''), // 移除末尾斜杠
    initSession: {
      appId: process.env.INTERNAL_AGENT_INIT_SESSION_APP_ID || '',
      trCode: process.env.INTERNAL_AGENT_INIT_SESSION_TR_CODE || '',
      trVersion: process.env.INTERNAL_AGENT_INIT_SESSION_TR_VERSION || '1.0',
      agentId: process.env.INTERNAL_AGENT_INIT_SESSION_AGENT_ID || '',
    },
    chat: {
      appId: process.env.INTERNAL_AGENT_CHAT_APP_ID || '',
      trCode: process.env.INTERNAL_AGENT_CHAT_TR_CODE || '',
      trVersion: process.env.INTERNAL_AGENT_CHAT_TR_VERSION || '1.0',
      stream: process.env.INTERNAL_AGENT_CHAT_STREAM === 'true',
    },
    timeout,
  };

  return config;
}

/**
 * 检查是否配置了内网 Agent
 */
export function isInternalAgentEnabled(): boolean {
  return loadInternalAgentConfig() !== null;
}

/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * 解析 SSE 事件流
 */
async function* parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      let done = false;
      let value: Uint8Array;

      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
      } catch (readError) {
        throw new Error(`Failed to read from stream: ${readError instanceof Error ? readError.message : String(readError)}`);
      }

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('event:')) {
          currentEvent = trimmedLine.slice(6).trim();
          continue;
        }

        if (trimmedLine.startsWith('data:')) {
          const data = trimmedLine.slice(6).trim();

          if (data.startsWith('{')) {
            let eventType = currentEvent || 'message';

            // Fallback: infer event type from data content if currentEvent is empty
            if (!currentEvent || currentEvent === 'message') {
              if (data.includes('"chat_id"')) {
                eventType = 'chat_started';
              } else if (data.includes('"code"') && data.includes('"success"')) {
                eventType = 'done';
              }
            }

            yield { event: eventType, data };
          }

          // Reset currentEvent after yielding
          currentEvent = '';
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      // Ignore cancel errors during cleanup
    }
    reader.releaseLock();
  }
}

/**
 * 内网 Agent 客户端
 */
export class InternalAgentClient {
  private config: InternalAgentConfig;
  private sessionId: string | null = null;
  private requestId: string;

  constructor(config: InternalAgentConfig) {
    this.config = config;
    this.requestId = generateUUID();
  }

  /**
   * 带超时的 fetch 请求
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.log(`[InternalAgent] Request timeout after ${this.config.timeout}ms: ${url}`);
      controller.abort();
    }, this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 初始化会话，获取 session_id
   */
  async initSession(): Promise<string> {
    const url = `${this.config.baseUrl}/agent-api/${this.config.initSession.agentId}/chatabc/init_session`;

    const body = {
      appId: this.config.initSession.appId,
      trCode: this.config.initSession.trCode,
      trVersion: this.config.initSession.trVersion,
      timestamp: Date.now(),
      requestId: this.requestId,
      data: {
        prompt_variables: [],
      },
    };

    console.log(`[InternalAgent] Calling init_session: ${url}`);
    console.log(`[InternalAgent] Request body: ${JSON.stringify(body)}`);

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`init_session failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as InitSessionResponse;

    console.log(`[InternalAgent] init_session response: ${JSON.stringify(data)}`);

    // Lenient check - just log warning if not success, don't fail
    if (data.resCode && data.resCode !== 'FAIAG0000' && data.resCode !== '0000') {
      console.warn(`[InternalAgent] init_session returned non-success code: ${data.resCode}, message: ${data.resMessage}`);
    }

    // Support both session_id (snake_case) and sessionId (camelCase)
    this.sessionId = data.data.session_id || data.data.sessionId || null;
    console.log(`[InternalAgent] Session initialized: ${this.sessionId}`);

    if (!this.sessionId) {
      throw new Error('Failed to get session_id from init_session response');
    }

    return this.sessionId;
  }

  /**
   * 发送聊天消息
   * @param prompt - 聊天提示词
   * @param onMessage - 可选的流式回调，每收到一条消息时调用
   */
  async chat(prompt: string, onMessage?: (message: ChatMessage) => void | Promise<void>): Promise<ChatResponse> {
    if (!this.sessionId) {
      throw new Error('Session not initialized. Call initSession() first.');
    }

    const url = `${this.config.baseUrl}/agent-api/${this.config.initSession.agentId}/chatabc/chat`;
    this.requestId = generateUUID();

    const body = {
      appId: this.config.chat.appId,
      trCode: this.config.chat.trCode,
      trVersion: this.config.chat.trVersion,
      timestamp: Date.now(),
      requestId: this.requestId,
      data: {
        session_id: this.sessionId,
        txt: prompt,
        stream: this.config.chat.stream,
        files: [],
      },
    };

    console.log(`[InternalAgent] Calling chat: ${url}`);
    console.log(`[InternalAgent] Prompt length: ${prompt.length} chars`);

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`chat failed: ${response.status} ${response.statusText}`);
    }

    // Parse SSE stream
    let result = '';
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];
    const messages: ChatMessage[] = [];  // For audit logging with tool_use/tool_result format
    let chatId: string | undefined;
    let success = false;

    try {
      for await (const event of parseSSEStream(response)) {
        const eventData = JSON.parse(event.data);
        const msgType = eventData.type;

        console.log(`[InternalAgent] SSE event: ${event.event}, type: ${msgType}`);

        if (event.event === 'chat_started') {
          const startedEvent = eventData as ChatStartedEvent;
          chatId = startedEvent.chat_id;
          console.log(`[InternalAgent] Chat started: ${chatId}`);
        }

        if (event.event === 'message') {
          // Handle AIMessageChunk (can have both text content AND tool_calls)
          if (msgType === 'AIMessageChunk') {
            // First, send text content via callback for real-time logging
            if (eventData.content && eventData.content.trim()) {
              result += eventData.content;

              // Stream callback for text content (separate from tool_calls)
              if (onMessage) {
                const textMessage: ChatMessage = {
                  role: 'assistant',
                  content: eventData.content,
                };
                await onMessage(textMessage);
              }
            }

            // Then, send tool_calls separately if present
            if (eventData.tool_calls && eventData.tool_calls.length > 0) {
              for (const toolCall of eventData.tool_calls) {
                console.log(`[InternalAgent] Tool call: ${toolCall.name}`);

                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(toolCall.args);
                } catch {
                  args = { raw: toolCall.args };
                }

                toolCalls.push({
                  name: toolCall.name,
                  args,
                  id: toolCall.id,
                });

                // Add tool_use message for audit logging (dashboard format)
                const toolUseMessage: ChatMessage = {
                  role: 'assistant',
                  content: JSON.stringify({
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.name,
                    input: args,
                  }),
                  toolUse: {
                    name: toolCall.name,
                    input: args,
                  },
                };
                messages.push(toolUseMessage);

                // Stream callback for real-time processing
                if (onMessage) {
                  await onMessage(toolUseMessage);
                }
              }
            }
          } else if (msgType === 'function') {
            // Tool result - may or may not have name field
            const toolName = eventData.name || 'unknown';
            const toolOutput = typeof eventData.content === 'string'
              ? eventData.content
              : JSON.stringify(eventData.content);

            console.log(`[InternalAgent] Tool result: ${toolName}, hasName: ${!!eventData.name}`);

            const toolResultMessage: ChatMessage = {
              role: 'user',
              content: JSON.stringify({
                type: 'tool_result',
                name: toolName,
                output: toolOutput,
              }),
              toolResult: {
                name: toolName,
                output: toolOutput,
              },
            };
            messages.push(toolResultMessage);

            // Stream callback for real-time processing
            if (onMessage) {
              await onMessage(toolResultMessage);
            }
          } else {
            // Regular text content (non-AIMessageChunk)
            if (eventData.content) {
              result += eventData.content;

              // Stream callback for text content
              if (onMessage && eventData.content.trim()) {
                const textMessage: ChatMessage = {
                  role: 'assistant',
                  content: eventData.content,
                };
                await onMessage(textMessage);
              }
            }
          }
        }

        if (event.event === 'done') {
          const doneEvent = eventData as DoneEvent;
          success = doneEvent.success;
          console.log(`[InternalAgent] Chat done: code=${doneEvent.code}, success=${doneEvent.success}`);
          break;
        }
      }
    } catch (error) {
      console.error(`[InternalAgent] Error parsing SSE stream:`, error);
      throw error;
    }

    // If no text but have tool calls, generate summary
    if (!result && toolCalls.length > 0) {
      result = `[Tool calls executed: ${toolCalls.map(t => t.name).join(', ')}]`;
    }

    // Add final assistant message with text content (if any)
    if (result) {
      messages.push({
        role: 'assistant',
        content: result,
      });
    }

    return {
      result,
      toolCalls,
      messages,
      success,
      chatId,
    };
  }

  /**
   * 获取当前 session_id
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 创建内网 Agent 客户端的工厂函数
   */
  static create(): InternalAgentClient | null {
    const config = loadInternalAgentConfig();

    if (!config) {
      return null;
    }

    return new InternalAgentClient(config);
  }
}

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

export interface ChatResponse {
  result: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
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
          currentEvent = trimmedLine.slice(5).trim();
          continue;
        }

        if (trimmedLine.startsWith('data:')) {
          const data = trimmedLine.slice(5).trim();

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

    const response = await fetch(url, {
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
   */
  async chat(prompt: string): Promise<ChatResponse> {
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

    const response = await fetch(url, {
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
    let chatId: string | undefined;
    let success = false;

    try {
      for await (const event of parseSSEStream(response)) {
        const eventData = JSON.parse(event.data);

        console.log(`[InternalAgent] SSE event: ${event.event}`);

        if (event.event === 'chat_started') {
          const startedEvent = eventData as ChatStartedEvent;
          chatId = startedEvent.chat_id;
          console.log(`[InternalAgent] Chat started: ${chatId}`);
        }

        if (event.event === 'message') {
          const message = eventData as ChatMessageEvent;

          // Log tool calls
          if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
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
            }
          }

          // Accumulate text content
          if (message.content) {
            result += message.content;
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

    return {
      result,
      toolCalls,
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

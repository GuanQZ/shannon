// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义 AI 执行链路中的消息、回调、上下文等核心类型，约束执行器与处理器之间的数据契约。
 * 该文件用于提升编译期安全性，降低跨模块数据结构漂移风险。
 */

// Type definitions for Claude executor message processing pipeline
// 类型 definitions for Claude executor 消息 processing 流水线。

export interface ExecutionContext {
  isParallelExecution: boolean;
  useCleanOutput: boolean;
  agentType: string;
  agentKey: string;
}

export interface ProcessingState {
  turnCount: number;
  result: string | null;
  apiErrorDetected: boolean;
  totalCost: number;
  partialCost: number;
  lastHeartbeat: number;
}

export interface ProcessingResult {
  result: string | null;
  turnCount: number;
  apiErrorDetected: boolean;
  totalCost: number;
}

export interface AssistantResult {
  content: string;
  cleanedContent: string;
  apiErrorDetected: boolean;
  shouldThrow?: Error;
  logData: {
    turn: number;
    content: string;
    timestamp: string;
  };
}

export interface ResultData {
  result: string | null;
  cost: number;
  total_tokens: number;
  duration_ms: number;
  subtype?: string;
  stop_reason?: string | null;
  permissionDenials: number;
}

export interface ToolUseData {
  toolName: string;
  parameters: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResultData {
  content: unknown;
  displayContent: string;
  timestamp: string;
}

export interface ContentBlock {
  type?: string;
  text?: string;
}

export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'unknown';

export interface AssistantMessage {
  type: 'assistant';
  error?: SDKAssistantMessageError;
  message: {
    content: ContentBlock[] | string;
  };
}

export interface ResultMessage {
  type: 'result';
  result?: string;
  total_cost_usd?: number;
  total_tokens?: number;
  duration_ms?: number;
  subtype?: string;
  stop_reason?: string | null;
  permission_denials?: unknown[];
}

export interface ToolUseMessage {
  type: 'tool_use';
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResultMessage {
  type: 'tool_result';
  content?: unknown;
}

export interface ApiErrorDetection {
  detected: boolean;
  shouldThrow?: Error;
}

// Message types from SDK stream
// SDK 流式消息类型。
export type SdkMessage =
  | AssistantMessage
  | ResultMessage
  | ToolUseMessage
  | ToolResultMessage
  | SystemInitMessage
  | UserMessage;

export interface SystemInitMessage {
  type: 'system';
  subtype: 'init';
  model?: string;
  permissionMode?: string;
  mcp_servers?: Array<{ name: string; status: string }>;
}

export interface UserMessage {
  type: 'user';
}

// Dispatch result types for message processing
// 消息处理分发结果类型。
export type MessageDispatchResult =
  | { action: 'continue' }
  | { action: 'break'; result: string | null; cost: number }
  | { action: 'throw'; error: Error };

export interface MessageDispatchContext {
  turnCount: number;
  execContext: ExecutionContext;
  description: string;
  colorFn: (text: string) => string;
  useCleanOutput: boolean;
}

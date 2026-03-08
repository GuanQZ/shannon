// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义错误上下文、错误分类与错误结果载荷类型，支撑统一错误处理链路。
 * 该文件用于约束错误信息结构，提升诊断一致性。
 */

/**
 * Error type definitions
 * 错误 类型 definitions。
 */

export type PentestErrorType =
  | 'config'
  | 'network'
  | 'tool'
  | 'prompt'
  | 'filesystem'
  | 'validation'
  | 'billing'
  | 'unknown';

export interface PentestErrorContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  context: string;
  error: {
    name: string;
    message: string;
    type: PentestErrorType;
    retryable: boolean;
    stack?: string;
  };
}

export interface ToolErrorResult {
  tool: string;
  output: string;
  status: 'error';
  duration: number;
  success: false;
  error: Error;
}

export interface PromptErrorResult {
  success: false;
  error: Error;
}

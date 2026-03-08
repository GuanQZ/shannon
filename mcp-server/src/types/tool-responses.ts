// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义 MCP 工具标准响应载荷结构，统一成功/失败结果表达。
 * 该文件用于提高工具调用链路的可解析性与稳定性。
 */

/**
 * Tool Response Type Definitions
 * 工具 Response 类型 Definitions。
 *
 * Defines structured response formats for MCP tools to ensure
 * Defines structured response formats for MCP 工具 to 确保。
 * consistent error handling and success reporting.
 * consistent 错误 处理 and success reporting.。
 */

export interface ErrorResponse {
  status: 'error';
  message: string;
  errorType: string; // ValidationError, FileSystemError, CryptoError, etc.
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface SuccessResponse {
  status: 'success';
  message: string;
}

export interface SaveDeliverableResponse {
  status: 'success';
  message: string;
  filepath: string;
  deliverableType: string;
  validated: boolean; // true if queue JSON was validated
}

export interface GenerateTotpResponse {
  status: 'success';
  message: string;
  totpCode: string;
  timestamp: string;
  expiresIn: number; // seconds until expiration
}

export type ToolResponse =
  | ErrorResponse
  | SuccessResponse
  | SaveDeliverableResponse
  | GenerateTotpResponse;

export interface ToolResultContent {
  type: string;
  text: string;
}

export interface ToolResult {
  content: ToolResultContent[];
  isError: boolean;
}

/**
 * Helper to create tool result from response
 * 根据 response 创建工具结果。
 * MCP tools should return this format
 * MCP 工具应统一返回该结构。
 */
export function createToolResult(response: ToolResponse): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: response.status === 'error',
  };
}

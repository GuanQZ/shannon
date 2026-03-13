// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 封装 MCP 工具错误格式化逻辑，将异常转换为可读且结构化的错误结果。
 * 该文件用于统一错误呈现并降低排障成本。
 */

/**
 * Error Formatting Utilities
 * 错误 Formatting Utilities。
 *
 * Helper functions for creating structured error responses.
 * 辅助 函数 for creating structured 错误 responses.。
 */

import type { ErrorResponse } from '../types/tool-responses.js';

/**
 * Create a validation error response
 * 创建 a 校验 错误 response。
 */
export function createValidationError(
  message: string,
  retryable: boolean = true,
  context?: Record<string, unknown>
): ErrorResponse {
  return {
    status: 'error',
    message,
    errorType: 'ValidationError',
    retryable,
    ...(context !== undefined && { context }),
  };
}

/**
 * Create a crypto error response
 * 创建 a crypto 错误 response。
 */
export function createCryptoError(
  message: string,
  retryable: boolean = false,
  context?: Record<string, unknown>
): ErrorResponse {
  return {
    status: 'error',
    message,
    errorType: 'CryptoError',
    retryable,
    ...(context !== undefined && { context }),
  };
}

/**
 * Create a generic error response
 * 创建 a generic 错误 response。
 */
export function createGenericError(
  error: unknown,
  retryable: boolean = false,
  context?: Record<string, unknown>
): ErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

  return {
    status: 'error',
    message,
    errorType,
    retryable,
    ...(context !== undefined && { context }),
  };
}

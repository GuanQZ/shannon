// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 校验任务队列与交付物关联关系，确保 MCP 工具调用符合流程约束。
 * 该文件用于防止错误阶段写入或非法任务提交。
 */

/**
 * Queue Validator
 * 队列校验器。
 *
 * Validates JSON structure for vulnerability queue files.
 * 用于校验漏洞队列文件的 JSON 结构。
 * Ported from tools/save_deliverable.js (lines 56-75).
 * 逻辑移植自 tools/save_deliverable.js（56-75 行）。
 */

import type { VulnerabilityQueue } from '../types/deliverables.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
  data?: VulnerabilityQueue;
}

/**
 * Validate JSON structure for queue files
 * 校验队列文件的 JSON 结构。
 * Queue files must have a 'vulnerabilities' array
 * 队列文件必须包含 `vulnerabilities` 数组。
 */
export function validateQueueJson(content: string): ValidationResult {
  try {
    const parsed = JSON.parse(content) as unknown;

    // Type guard for the parsed result
    // 对解析结果执行类型守卫。
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        valid: false,
        message: `Invalid queue structure: Expected an object. Got: ${typeof parsed}`,
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Queue files must have a 'vulnerabilities' array
    // 队列文件必须包含 `vulnerabilities` 字段。
    if (!('vulnerabilities' in obj)) {
      return {
        valid: false,
        message: `Invalid queue structure: Missing 'vulnerabilities' property. Expected: {"vulnerabilities": [...]}`,
      };
    }

    if (!Array.isArray(obj.vulnerabilities)) {
      return {
        valid: false,
        message: `Invalid queue structure: 'vulnerabilities' must be an array. Expected: {"vulnerabilities": [...]}`,
      };
    }

    return {
      valid: true,
      data: parsed as VulnerabilityQueue,
    };
  } catch (error) {
    return {
      valid: false,
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

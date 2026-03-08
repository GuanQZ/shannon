// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供时间、时长、文本等格式化函数，统一日志与报告中的展示风格。
 * 该文件用于提升输出一致性与可读性。
 */

/**
 * Formatting Utilities
 * Formatting Utilities。
 *
 * Generic formatting functions for durations, timestamps, and percentages.
 * Generic formatting 函数 for durations, timestamps, and percentages.。
 */

/**
 * Format duration in milliseconds to human-readable string
 * 格式 耗时 in milliseconds to human-readable string。
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format timestamp to ISO 8601 string
 * 格式 timestamp to ISO 8601 string。
 */
export function formatTimestamp(timestamp: number = Date.now()): string {
  return new Date(timestamp).toISOString();
}

/**
 * Calculate percentage
 * Calculate percentage。
 */
export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

/**
 * Extract agent type from description string for display purposes
 * Extract 代理 类型 来自 description string for display purposes。
 */
export function extractAgentType(description: string): string {
  if (description.includes('Pre-recon')) {
    return 'pre-reconnaissance';
  }
  if (description.includes('Recon')) {
    return 'reconnaissance';
  }
  if (description.includes('Report')) {
    return 'report generation';
  }
  return 'analysis';
}

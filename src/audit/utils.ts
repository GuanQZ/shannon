// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供审计系统通用工具函数，如路径构建、时间格式化与安全写入辅助逻辑。
 * 该文件用于复用横切能力，减少审计模块内部重复代码。
 */

/**
 * Audit System Utilities
 * 审计 系统 Utilities。
 *
 * Core utility functions for path generation, atomic writes, and formatting.
 * Core utility 函数 for path generation, atomic writes, and formatting.。
 * All functions are pure and crash-safe.
 * All 函数 are pure and crash-安全.。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Lumin repository root
// Get Lumin repository root。
export const LUMIN_ROOT = path.resolve(__dirname, '..', '..');
export const AUDIT_LOGS_DIR = path.join(LUMIN_ROOT, 'audit-logs');

export interface SessionMetadata {
  id: string;
  webUrl: string;
  repoPath?: string;
  outputPath?: string;
  [key: string]: unknown;
}

/**
 * Extract and sanitize hostname from URL for use in identifiers
 * Extract and sanitize hostname 来自 URL for 使用 in identifiers。
 */
export function sanitizeHostname(url: string): string {
  return new URL(url).hostname.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Generate standardized session identifier from workflow ID
 * 生成 standardized session identifier 来自 工作流 ID。
 * Workflow IDs already contain hostname, so we use them directly
 * 工作流 IDs already contain hostname, so we 使用 them directly。
 */
export function generateSessionIdentifier(sessionMetadata: SessionMetadata): string {
  return sessionMetadata.id;
}

/**
 * Generate path to audit log directory for a session
 * 生成 path to 审计 log directory for a session。
 * Uses custom outputPath if provided, otherwise defaults to AUDIT_LOGS_DIR
 * Uses custom outputPath 如果 provided, otherwise defaults to AUDIT_LOGS_DIR。
 */
export function generateAuditPath(sessionMetadata: SessionMetadata): string {
  const sessionIdentifier = generateSessionIdentifier(sessionMetadata);
  const baseDir = sessionMetadata.outputPath || AUDIT_LOGS_DIR;
  return path.join(baseDir, sessionIdentifier);
}

/**
 * Generate path to agent log file
 * 生成 path to 代理 log 文件。
 */
export function generateLogPath(
  sessionMetadata: SessionMetadata,
  agentName: string,
  timestamp: number,
  attemptNumber: number
): string {
  const auditPath = generateAuditPath(sessionMetadata);
  const filename = `${timestamp}_${agentName}_attempt-${attemptNumber}.log`;
  return path.join(auditPath, 'agents', filename);
}

/**
 * Generate path to Chinese agent log file (filtered, for dashboard display)
 * 生成 path to 中文代理日志文件（已过滤，用于仪表板显示）。
 * 存放在 chinese-agents/ 目录
 */
export function generateChineseLogPath(
  sessionMetadata: SessionMetadata,
  agentName: string
): string {
  const auditPath = generateAuditPath(sessionMetadata);
  // 中文日志按 agent 名称组织，每个 agent 一个文件，方便前端读取
  return path.join(auditPath, 'chinese-agents', `${agentName}.zh.log`);
}

/**
 * Generate path to prompt snapshot file
 * 生成 path to prompt snapshot 文件。
 */
export function generatePromptPath(sessionMetadata: SessionMetadata, agentName: string): string {
  const auditPath = generateAuditPath(sessionMetadata);
  return path.join(auditPath, 'prompts', `${agentName}.md`);
}

/**
 * Generate path to session.json file
 * 生成 path to session.JSON 文件。
 */
export function generateSessionJsonPath(sessionMetadata: SessionMetadata): string {
  const auditPath = generateAuditPath(sessionMetadata);
  return path.join(auditPath, 'session.json');
}

/**
 * Generate path to workflow.log file
 * 生成 path to 工作流.log 文件。
 */
export function generateWorkflowLogPath(sessionMetadata: SessionMetadata): string {
  const auditPath = generateAuditPath(sessionMetadata);
  return path.join(auditPath, 'workflow.log');
}

/**
 * Ensure directory exists (idempotent, race-safe)
 * 确保 directory exists (idempotent, race-安全)。
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore EEXIST errors (race condition safe)
    // Ignore EEXIST 错误 (race condition 安全)。
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Atomic write using temp file + rename pattern
 * Atomic 写入 使用 temp 文件 + rename 模式。
 * Guarantees no partial writes or corruption on crash
 * Guarantees no partial writes or corruption 于 crash。
 */
export async function atomicWrite(filePath: string, data: object | string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  try {
    // Write to temp file
    // 写入 to temp 文件。
    await fs.writeFile(tempPath, content, 'utf8');

    // Atomic rename (POSIX guarantee: atomic on same filesystem)
    // Atomic rename (POSIX guarantee: atomic 于 same filesystem)。
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    // Clean up temp 文件 于 failure。
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
      // Ignore cleanup 错误。
    }
    throw error;
  }
}

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
 * Read and parse JSON file
 * 读取 and 解析 JSON 文件。
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

/**
 * Check if file exists
 * 检查 如果 文件 exists。
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize audit directory structure for a session
 * Initialize 审计 directory 结构 for a session。
 * Creates: audit-logs/{sessionId}/, agents/, chinese-agents/, prompts/
 * Creates: 审计-logs/{sessionId}/, agents/, chinese-agents/, prompts/。
 */
export async function initializeAuditStructure(sessionMetadata: SessionMetadata): Promise<void> {
  const auditPath = generateAuditPath(sessionMetadata);
  const agentsPath = path.join(auditPath, 'agents');
  const chineseAgentsPath = path.join(auditPath, 'chinese-agents');
  const promptsPath = path.join(auditPath, 'prompts');

  await ensureDirectory(auditPath);
  await ensureDirectory(agentsPath);
  await ensureDirectory(chineseAgentsPath);
  await ensureDirectory(promptsPath);
}

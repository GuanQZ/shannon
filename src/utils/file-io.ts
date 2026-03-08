// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 封装通用文件读写、目录创建与安全持久化逻辑，供多模块复用。
 * 该文件降低文件系统操作重复实现与边界处理遗漏风险。
 */

/**
 * File I/O Utilities
 * 文件 I/O Utilities。
 *
 * Core utility functions for file operations including atomic writes,
 * Core utility 函数 for 文件 operations including atomic writes,。
 * directory creation, and JSON file handling.
 * directory creation, and JSON 文件 处理.。
 */

import fs from 'fs/promises';

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

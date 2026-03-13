// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供 lumin-tool-mcp 侧文件写入/目录处理等底层操作，支撑工具安全落盘。
 * 该文件隔离文件系统细节，提升工具实现复用性。
 */

/**
 * File Operations Utilities
 * 文件操作工具。
 *
 * Handles file system operations for deliverable saving.
 * 封装交付物保存相关的文件系统操作。
 * Ported from tools/save_deliverable.js (lines 117-130).
 * 逻辑移植自 tools/save_deliverable.js（117-130 行）。
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Save deliverable file to deliverables/ directory
 * 将交付物文件保存到 `deliverables/` 目录。
 *
 * @param targetDir - Target directory for deliverables (passed explicitly to avoid race conditions)
 * @param targetDir - Target directory for deliverables (passed explicitly to avoid race conditions)。
 * @param filename - Name of the deliverable file
 * @param filename - 交付物文件名。
 * @param content - File content to save
 * @param content - 需要写入的文件内容。
 */
export function saveDeliverableFile(targetDir: string, filename: string, content: string): string {
  const deliverablesDir = join(targetDir, 'deliverables');
  const filepath = join(deliverablesDir, filename);

  // Ensure deliverables directory exists
  // 确保 deliverables 目录存在。
  try {
    mkdirSync(deliverablesDir, { recursive: true });
  } catch {
    throw new Error(`Cannot create deliverables directory at ${deliverablesDir}`);
  }

  // Write file (atomic write - single operation)
  // 单次写入目标文件。
  writeFileSync(filepath, content, 'utf8');

  return filepath;
}

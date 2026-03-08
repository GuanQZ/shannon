// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责命令行参数与输入路径校验，确保 URL、仓库目录、配置文件等入参可用。
 * 该文件用于在最前置环节拦截用户输入错误，降低后续执行失败率。
 */

import { fs, path } from 'zx';

interface ValidationResult {
  valid: boolean;
  error?: string;
  path?: string;
}

// Helper function: Validate web URL
// 辅助函数：校验 Web URL。
export function validateWebUrl(url: string): ValidationResult {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Web URL must use HTTP or HTTPS protocol' };
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'Web URL must have a valid hostname' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid web URL format' };
  }
}

// Helper function: Validate local repository path
// 辅助函数：校验本地仓库路径。
export async function validateRepoPath(repoPath: string): Promise<ValidationResult> {
  try {
    // Check if path exists
    // 检查路径是否存在。
    if (!(await fs.pathExists(repoPath))) {
      return { valid: false, error: 'Repository path does not exist' };
    }

    // Check if it's a directory
    // 检查路径是否为目录。
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Repository path must be a directory' };
    }

    // Check if it's readable
    // 检查目录是否可读。
    try {
      await fs.access(repoPath, fs.constants.R_OK);
    } catch {
      return { valid: false, error: 'Repository path is not readable' };
    }

    // Convert to absolute path
    // 转换为绝对路径并返回。
    const absolutePath = path.resolve(repoPath);
    return { valid: true, path: absolutePath };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Invalid repository path: ${errMsg}` };
  }
}

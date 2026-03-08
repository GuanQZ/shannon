// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责运行环境初始化与前置检查（目录、变量、依赖状态），为工作流执行准备基础上下文。
 * 该文件用于统一启动行为，减少环境差异导致的问题。
 */

import { $, fs, path } from 'zx';
import chalk from 'chalk';
import { PentestError } from '../error-handling.js';

// Pure function: Setup local repository for testing
// 纯函数：为测试准备本地仓库环境。
export async function setupLocalRepo(repoPath: string): Promise<string> {
  try {
    const sourceDir = path.resolve(repoPath);

    // MCP servers are now configured via mcpServers option in claude-executor.js
    // MCP 服务已通过 `claude-executor.ts` 中的 `mcpServers` 选项统一配置。
    // No need for pre-setup with claude CLI
    // 启动前不再需要额外执行 claude CLI 预配置。

    // Initialize git repository if not already initialized and create checkpoint
    // 若仓库尚未初始化，则先初始化 Git 并创建检查点。
    try {
      // Check if it's already a git repository
      // 检查目标目录是否已经是 Git 仓库。
      const isGitRepo = await fs.pathExists(path.join(sourceDir, '.git'));

      if (!isGitRepo) {
        await $`cd ${sourceDir} && git init`;
        console.log(chalk.blue('✅ Git repository initialized'));
      }

      // Configure git for pentest agent
      // 配置渗透代理使用的 Git 用户信息。
      await $`cd ${sourceDir} && git config user.name "Pentest Agent"`;
      await $`cd ${sourceDir} && git config user.email "agent@localhost"`;

      // Create initial checkpoint
      // 创建初始检查点提交。
      await $`cd ${sourceDir} && git add -A && git commit -m "Initial checkpoint: Local repository setup" --allow-empty`;
      console.log(chalk.green('✅ Initial checkpoint created'));
    } catch (gitError) {
      const errMsg = gitError instanceof Error ? gitError.message : String(gitError);
      console.log(chalk.yellow(`⚠️ Git setup warning: ${errMsg}`));
      // Non-fatal - continue without Git setup
      // 该步骤非致命，失败时继续执行后续流程。
    }

    // MCP tools (save_deliverable, generate_totp) are now available natively via lumin-helper MCP server
    // `save_deliverable` 与 `generate_totp` 已由 `lumin-helper` MCP 服务原生提供。
    // No need to copy bash scripts to target repository
    // 不再需要把 Bash 脚本复制到目标仓库。

    return sourceDir;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new PentestError(`Local repository setup failed: ${errMsg}`, 'filesystem', false, {
      repoPath,
      originalError: errMsg,
    });
  }
}

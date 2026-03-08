#!/usr/bin/env node
// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * Temporal 客户端入口，用于启动渗透工作流并向服务端提交运行参数。
 * 该文件通常被 CLI 调用，是用户触发一次任务的关键入口之一。
 */

/**
 * Temporal client for starting Shannon pentest pipeline workflows.
 * `Temporal` 客户端，用于启动 Shannon 渗透测试流水线工作流。
 *
 * Starts a workflow and optionally waits for completion with progress polling.
 * 启动工作流，并可按需轮询等待任务完成。
 *
 * Usage:
 * 用法：
 *   npm run temporal:start -- <webUrl> <repoPath> [options]
 * `npm run temporal:start -- <webUrl> <repoPath> [options]`
 *   # or
 * 或
 *   node dist/temporal/client.js <webUrl> <repoPath> [options]
 * `node dist/temporal/client.js <webUrl> <repoPath> [options]`
 *
 * Options:
 * 参数：
 *   --config <path>       Configuration file path
 * `--config <path>` 指定配置文件路径。
 *   --output <path>       Output directory for audit logs
 * `--output <path>` 指定审计输出目录。
 *   --pipeline-testing    Use minimal prompts for fast testing
 * `--pipeline-testing` 启用快速测试模式。
 *   --workflow-id <id>    Custom workflow ID (default: shannon-<timestamp>)
 * `--workflow-id <id>` 指定自定义工作流标识。
 *   --wait                Wait for workflow completion with progress polling
 * `--wait` 轮询等待任务完成。
 *
 * Environment:
 * 环境变量：
 *   TEMPORAL_ADDRESS - Temporal server address (default: localhost:7233)
 * `TEMPORAL_ADDRESS`：`Temporal` 服务地址，默认 `localhost:7233`。
 *
 * 用途：作为命令行入口创建并启动工作流。
 * 关键参数：目标地址、仓库路径、可选配置和输出目录。
 * 返回值：主流程完成后无返回值。
 * 失败分支：连接失败、参数错误或工作流失败时以非零状态退出。
 */

import { Connection, Client } from '@temporalio/client';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { displaySplashScreen } from '../splash-screen.js';
import { sanitizeHostname } from '../audit/utils.js';
// Import types only - these don't pull in workflow runtime code
// 仅导入类型，避免拉入工作流运行时代码。
import type { PipelineInput, PipelineState, PipelineProgress } from './shared.js';

dotenv.config();

// Query name must match the one defined in workflows.ts
// 查询名称必须与 `workflows.ts` 中定义保持一致。
const PROGRESS_QUERY = 'getProgress';

function showUsage(): void {
  console.log(chalk.cyan.bold('\nShannon Temporal Client'));
  console.log(chalk.gray('启动渗透测试流水线工作流\n'));
  console.log(chalk.yellow('用法：'));
  console.log(
    '  node dist/temporal/client.js <webUrl> <repoPath> [options]\n'
  );
  console.log(chalk.yellow('参数：'));
  console.log('  --config <path>       配置文件路径');
  console.log('  --output <path>       审计日志输出目录');
  console.log('  --pipeline-testing    启用最小提示词快速测试模式');
  console.log('  --workflow-id <id>    自定义工作流 ID（默认：shannon-<timestamp>）');
  console.log('  --wait                轮询等待工作流完成\n');
  console.log(chalk.yellow('示例：'));
  console.log('  node dist/temporal/client.js https://example.com /path/to/repo');
  console.log(
    '  node dist/temporal/client.js https://example.com /path/to/repo --config config.yaml\n'
  );
}

async function startPipeline(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showUsage();
    process.exit(0);
  }

  // Parse arguments
  // 解析命令行参数。
  let webUrl: string | undefined;
  let repoPath: string | undefined;
  let configPath: string | undefined;
  let outputPath: string | undefined;
  let displayOutputPath: string | undefined; // Host path for display purposes
  let pipelineTestingMode = false;
  let customWorkflowId: string | undefined;
  let waitForCompletion = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        configPath = nextArg;
        i++;
      }
    } else if (arg === '--output') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        outputPath = nextArg;
        i++;
      }
    } else if (arg === '--display-output') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        displayOutputPath = nextArg;
        i++;
      }
    } else if (arg === '--workflow-id') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        customWorkflowId = nextArg;
        i++;
      }
    } else if (arg === '--pipeline-testing') {
      pipelineTestingMode = true;
    } else if (arg === '--wait') {
      waitForCompletion = true;
    } else if (arg && !arg.startsWith('-')) {
      if (!webUrl) {
        webUrl = arg;
      } else if (!repoPath) {
        repoPath = arg;
      }
    }
  }

  if (!webUrl || !repoPath) {
    console.log(chalk.red('错误：webUrl 和 repoPath 为必填参数'));
    showUsage();
    process.exit(1);
  }

  // Display splash screen
  // Display splash screen。
  await displaySplashScreen();

  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  console.log(chalk.gray(`正在连接 Temporal：${address}...`));

  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  try {
    const hostname = sanitizeHostname(webUrl);
    const workflowId = customWorkflowId || `${hostname}_shannon-${Date.now()}`;

    const input: PipelineInput = {
      webUrl,
      repoPath,
      ...(configPath && { configPath }),
      ...(outputPath && { outputPath }),
      ...(pipelineTestingMode && { pipelineTestingMode }),
      ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
      ...(process.env.ANTHROPIC_BASE_URL && { baseUrl: process.env.ANTHROPIC_BASE_URL }),
      ...(process.env.ANTHROPIC_MODEL && { model: process.env.ANTHROPIC_MODEL }),
    };

    // Determine output directory for display
    // 计算展示用输出目录。
    // Use displayOutputPath (host path) if provided, otherwise fall back to outputPath or default
    // 优先使用 `displayOutputPath`，否则回退到 `outputPath` 或默认目录。
    const effectiveDisplayPath = displayOutputPath || outputPath || './audit-logs';
    const outputDir = `${effectiveDisplayPath}/${workflowId}`;

    console.log(chalk.green.bold(`✓ 工作流已启动：${workflowId}`));
    console.log();
    console.log(chalk.white('  目标地址：   ') + chalk.cyan(webUrl));
    console.log(chalk.white('  代码仓库：   ') + chalk.cyan(repoPath));
    if (configPath) {
      console.log(chalk.white('  配置文件：   ') + chalk.cyan(configPath));
    }
    if (displayOutputPath) {
      console.log(chalk.white('  输出目录：   ') + chalk.cyan(displayOutputPath));
    }
    if (pipelineTestingMode) {
      console.log(chalk.white('  运行模式：   ') + chalk.yellow('流水线测试'));
    }
    console.log();

    // Start workflow by name (not by importing the function)
    // 按名称启动工作流，避免直接导入函数。
    const handle = await client.workflow.start<(input: PipelineInput) => Promise<PipelineState>>(
      'pentestPipelineWorkflow',
      {
        taskQueue: 'shannon-pipeline',
        workflowId,
        args: [input],
      }
    );

    if (!waitForCompletion) {
      console.log(chalk.bold('进度查看：'));
      console.log(chalk.white('  Web UI:  ') + chalk.blue(`http://localhost:8233/namespaces/default/workflows/${workflowId}`));
      console.log(chalk.white('  Logs:    ') + chalk.gray(`./shannon logs ID=${workflowId}`));
      console.log(chalk.white('  Query:   ') + chalk.gray(`./shannon query ID=${workflowId}`));
      console.log();
      console.log(chalk.bold('输出位置：'));
      console.log(chalk.white('  报告目录： ') + chalk.cyan(outputDir));
      console.log();
      return;
    }

    // Poll for progress every 30 seconds
    // 每三十秒轮询一次进度。
    const progressInterval = setInterval(async () => {
      try {
        const progress = await handle.query<PipelineProgress>(PROGRESS_QUERY);
        const elapsed = Math.floor(progress.elapsedMs / 1000);
        console.log(
          chalk.gray(`[${elapsed}s]`),
          chalk.cyan(`阶段：${progress.currentPhase || '未知'}`),
          chalk.gray(`| 智能体：${progress.currentAgent || '无'}`),
          chalk.gray(`| 完成数：${progress.completedAgents.length}/13`)
        );
      } catch {
        // Workflow may have completed
        // 工作流可能已经完成。
      }
    }, 30000);

    try {
      const result = await handle.result();
      clearInterval(progressInterval);

      console.log(chalk.green.bold('\n流水线执行成功完成！'));
      if (result.summary) {
        console.log(chalk.gray(`总耗时：${Math.floor(result.summary.totalDurationMs / 1000)}s`));
        console.log(chalk.gray(`完成智能体数：${result.summary.agentCount}`));
        console.log(chalk.gray(`总轮次：${result.summary.totalTurns}`));
        console.log(chalk.gray(`总成本：$${result.summary.totalCostUsd.toFixed(4)}`));
      }
    } catch (error) {
      clearInterval(progressInterval);
      console.error(chalk.red.bold('\n流水线执行失败：'), error);
      process.exit(1);
    }
  } finally {
    await connection.close();
  }
}

startPipeline().catch((err) => {
  console.error(chalk.red('客户端错误：'), err);
  process.exit(1);
});

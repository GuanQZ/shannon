#!/usr/bin/env node
// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供工作流查询工具，用于读取当前执行状态、阶段进度与摘要信息。
 * 该文件增强了长任务场景下的可观测性与运维排障能力。
 */

/**
 * Temporal query tool for inspecting Shannon workflow progress.
 * `Temporal` 查询工具，用于查看 Shannon 工作流进度。
 *
 * Queries a running or completed workflow and displays its state.
 * 查询运行中或已完成的工作流，并展示其当前状态。
 *
 * Usage:
 * 用法：
 *   npm run temporal:query -- <workflowId>
 * `npm run temporal:query -- <workflowId>`
 *   # or
 * 或
 *   node dist/temporal/query.js <workflowId>
 * `node dist/temporal/query.js <workflowId>`
 *
 * Environment:
 * 环境变量：
 *   TEMPORAL_ADDRESS - Temporal server address (default: localhost:7233)
 * `TEMPORAL_ADDRESS`：`Temporal` 服务地址，默认 `localhost:7233`。
 *
 * 用途：读取工作流实时进度并输出可读摘要。
 * 关键参数：`workflowId` 用于定位具体执行实例。
 * 返回值：主流程完成后无返回值。
 * 失败分支：工作流不存在或查询失败时以非零状态退出。
 */

import { Connection, Client } from '@temporalio/client';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

// Query name must match the one defined in workflows.ts
// 查询名称必须与 `workflows.ts` 中定义保持一致。
const PROGRESS_QUERY = 'getProgress';

// Types duplicated from shared.ts to avoid importing workflow APIs
// 这些类型从 `shared.ts` 复制而来，用于避免导入工作流接口。
interface AgentMetrics {
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  numTurns: number | null;
  model?: string | undefined;
}

interface PipelineProgress {
  status: 'running' | 'completed' | 'failed';
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgent: string | null;
  error: string | null;
  startTime: number;
  agentMetrics: Record<string, AgentMetrics>;
  workflowId: string;
  elapsedMs: number;
}

function showUsage(): void {
  console.log(chalk.cyan.bold('\nShannon Temporal Query Tool'));
  console.log(chalk.gray('查询运行中工作流的执行进度\n'));
  console.log(chalk.yellow('用法：'));
  console.log('  node dist/temporal/query.js <workflowId>\n');
  console.log(chalk.yellow('示例：'));
  console.log('  node dist/temporal/query.js shannon-1704672000000\n');
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return chalk.yellow(status);
    case 'completed':
      return chalk.green(status);
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function queryWorkflow(): Promise<void> {
  const workflowId = process.argv[2];

  if (!workflowId || workflowId === '--help' || workflowId === '-h') {
    showUsage();
    process.exit(workflowId ? 0 : 1);
  }

  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  try {
    const handle = client.workflow.getHandle(workflowId);
    const progress = await handle.query<PipelineProgress>(PROGRESS_QUERY);

    console.log(chalk.cyan.bold('\n工作流进度'));
    console.log(chalk.gray('\u2500'.repeat(40)));
    console.log(`${chalk.white('工作流 ID：')} ${progress.workflowId}`);
    console.log(`${chalk.white('状态：')} ${getStatusColor(progress.status)}`);
    console.log(
      `${chalk.white('当前阶段：')} ${progress.currentPhase || '无'}`
    );
    console.log(
      `${chalk.white('当前智能体：')} ${progress.currentAgent || '无'}`
    );
    console.log(`${chalk.white('已耗时：')} ${formatDuration(progress.elapsedMs)}`);
    console.log(
      `${chalk.white('已完成：')} ${progress.completedAgents.length}/13 个智能体`
    );

    if (progress.completedAgents.length > 0) {
      console.log(chalk.gray('\n已完成智能体：'));
      for (const agent of progress.completedAgents) {
        const metrics = progress.agentMetrics[agent];
        const duration = metrics ? formatDuration(metrics.durationMs) : '未知';
        const cost = metrics?.costUsd ? `$${metrics.costUsd.toFixed(4)}` : '';
        const model = metrics?.model ? ` [${metrics.model}]` : '';
        console.log(
          chalk.green(`  - ${agent}`) +
            chalk.blue(model) +
            chalk.gray(` (${duration}${cost ? ', ' + cost : ''})`)
        );
      }
    }

    if (progress.error) {
      console.log(chalk.red(`\n错误：${progress.error}`));
      console.log(chalk.red(`失败智能体：${progress.failedAgent}`));
    }

    console.log();
  } catch (error) {
    const err = error as Error;
    if (err.message?.includes('not found')) {
      console.log(chalk.red(`未找到工作流：${workflowId}`));
    } else {
      console.error(chalk.red('查询失败：'), err.message);
    }
    process.exit(1);
  } finally {
    await connection.close();
  }
}

queryWorkflow().catch((err) => {
  console.error(chalk.red('查询异常：'), err);
  process.exit(1);
});

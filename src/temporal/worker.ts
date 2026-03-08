#!/usr/bin/env node
// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * Temporal Worker 进程入口，负责注册工作流与活动并持续消费任务队列。
 * 该文件是后台执行引擎的运行基座。
 */

/**
 * Temporal worker for Shannon pentest pipeline.
 * `Temporal` `worker`，用于执行 Shannon 渗透测试流水线。
 *
 * Polls the 'shannon-pipeline' task queue and executes activities.
 * 持续轮询 `shannon-pipeline` 任务队列并执行活动。
 * Handles up to 25 concurrent activities to support multiple parallel workflows.
 * 最多并发处理二十五个活动，用于支撑多条并行工作流。
 *
 * Usage:
 * 用法：
 *   npm run temporal:worker
 * `npm run temporal:worker`
 *   # or
 * 或
 *   node dist/temporal/worker.js
 * `node dist/temporal/worker.js`
 *
 * Environment:
 * 环境变量：
 *   TEMPORAL_ADDRESS - Temporal server address (default: localhost:7233)
 * `TEMPORAL_ADDRESS`：`Temporal` 服务地址，默认 `localhost:7233`。
 *
 * 用途：创建并运行后台执行进程，承接工作流与活动任务。
 * 关键参数：`TEMPORAL_ADDRESS` 决定连接目标。
 * 返回值：常驻进程函数无返回值。
 * 失败分支：连接、打包或运行失败时抛错并退出。
 */

import { NativeConnection, Worker, bundleWorkflowCode } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import chalk from 'chalk';
import * as activities from './activities.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runWorker(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  console.log(chalk.cyan(`正在连接 Temporal：${address}...`));

  const connection = await NativeConnection.connect({ address });

  // Bundle workflows for Temporal's V8 isolate
  // 预先打包工作流代码，供隔离执行环境加载。
  console.log(chalk.gray('正在打包工作流代码...'));
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.join(__dirname, 'workflows.js'),
  });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    workflowBundle,
    activities,
    taskQueue: 'shannon-pipeline',
    maxConcurrentActivityTaskExecutions: 25, // Support multiple parallel workflows (5 agents × ~5 workflows)
  });

  // Graceful shutdown handling
  // 注册优雅关停处理，确保收到信号后有序停止。
  const shutdown = async (): Promise<void> => {
    console.log(chalk.yellow('\n正在关闭 worker...'));
    worker.shutdown();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(chalk.green('Shannon worker 已启动'));
  console.log(chalk.gray('任务队列：shannon-pipeline'));
  console.log(chalk.gray('按 Ctrl+C 停止\n'));

  try {
    await worker.run();
  } finally {
    await connection.close();
    console.log(chalk.gray('Worker 已停止'));
  }
}

runWorker().catch((err) => {
  console.error(chalk.red('Worker 运行失败：'), err);
  process.exit(1);
});

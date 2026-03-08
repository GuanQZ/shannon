// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供计时与指标统计工具，用于采集阶段/代理执行耗时和运行数据。
 * 该文件支撑性能分析、进度展示与报告指标输出。
 */

import chalk from 'chalk';
import { formatDuration } from './formatting.js';

// Timing utilities
// Timing utilities。

export class Timer {
  name: string;
  startTime: number;
  endTime: number | null = null;

  constructor(name: string) {
    this.name = name;
    this.startTime = Date.now();
  }

  stop(): number {
    this.endTime = Date.now();
    return this.duration();
  }

  duration(): number {
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }
}

interface TimingResultsAgents {
  [key: string]: number;
}

interface TimingResults {
  total: Timer | null;
  agents: TimingResultsAgents;
}

interface CostResultsAgents {
  [key: string]: number;
}

interface CostResults {
  agents: CostResultsAgents;
  total: number;
}

// Global timing and cost tracker
// Global timing and 成本 tracker。
export const timingResults: TimingResults = {
  total: null,
  agents: {},
};

export const costResults: CostResults = {
  agents: {},
  total: 0,
};

// Function to display comprehensive timing summary
// 函数 to display comprehensive timing summary。
export const displayTimingSummary = (): void => {
  if (!timingResults.total) {
    console.log(chalk.yellow('No timing data available'));
    return;
  }

  const totalDuration = timingResults.total.stop();

  console.log(chalk.cyan.bold('\n⏱️  TIMING SUMMARY'));
  console.log(chalk.gray('─'.repeat(60)));

  // Total execution time
  // Total execution time。
  console.log(chalk.cyan(`📊 Total Execution Time: ${formatDuration(totalDuration)}`));
  console.log();

  // Agent breakdown
  // 代理 breakdown。
  if (Object.keys(timingResults.agents).length > 0) {
    console.log(chalk.magenta.bold('🤖 Agent Breakdown:'));
    let agentTotal = 0;
    for (const [agent, duration] of Object.entries(timingResults.agents)) {
      const percentage = ((duration / totalDuration) * 100).toFixed(1);
      const displayName = agent.replace(/-/g, ' ');
      console.log(
        chalk.magenta(
          `  ${displayName.padEnd(20)} ${formatDuration(duration).padStart(8)} (${percentage}%)`
        )
      );
      agentTotal += duration;
    }
    console.log(
      chalk.gray(
        `  ${'Agents Total'.padEnd(20)} ${formatDuration(agentTotal).padStart(8)} (${((agentTotal / totalDuration) * 100).toFixed(1)}%)`
      )
    );
  }

  // Cost breakdown
  // 成本 breakdown。
  if (Object.keys(costResults.agents).length > 0) {
    console.log(chalk.green.bold('\n💰 Cost Breakdown:'));
    for (const [agent, cost] of Object.entries(costResults.agents)) {
      const displayName = agent.replace(/-/g, ' ');
      console.log(chalk.green(`  ${displayName.padEnd(20)} $${cost.toFixed(4).padStart(8)}`));
    }
    console.log(chalk.gray(`  ${'Total Cost'.padEnd(20)} $${costResults.total.toFixed(4).padStart(8)}`));
  }

  console.log(chalk.gray('─'.repeat(60)));
};

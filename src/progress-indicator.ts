// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供命令行进度展示能力，负责将多阶段、多代理执行状态以可视化文本形式实时输出。
 * 该文件提升了长时间渗透任务的人机可观测性，便于用户跟踪当前阶段、耗时与异常。
 */

import chalk from 'chalk';

export class ProgressIndicator {
  private message: string;
  private frames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex: number = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(message: string = 'Working...') {
    this.message = message;
  }

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameIndex = 0;

    this.interval = setInterval(() => {
      // Clear the line and write the spinner
      // Clear the line and 写入 the spinner。
      process.stdout.write(
        `\r${chalk.cyan(this.frames[this.frameIndex])} ${chalk.dim(this.message)}`
      );
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 100);
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Clear the spinner line
    // Clear the spinner line。
    process.stdout.write('\r' + ' '.repeat(this.message.length + 5) + '\r');
    this.isRunning = false;
  }

  finish(successMessage: string = 'Complete'): void {
    this.stop();
    console.log(chalk.green(`✓ ${successMessage}`));
  }
}

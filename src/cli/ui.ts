// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 管理 CLI 交互界面输出，包括启动提示、阶段性状态展示与终态反馈。
 * 该文件将业务执行结果转化为对用户友好的交互信息。
 */

import chalk from 'chalk';
import { displaySplashScreen } from '../splash-screen.js';

// Helper function: Display help information
// 输出 CLI 帮助文档，集中展示命令格式、参数解释、示例与运行前提。
// 该函数只负责展示，不做任何参数解析或环境校验。
export function showHelp(): void {
  console.log(chalk.cyan.bold('AI 渗透测试代理系统'));
  console.log(chalk.gray('自动化安全评估工具\n'));

  console.log(chalk.yellow.bold('用法：'));
  console.log('  shannon <WEB_URL> <REPO_PATH> [--config config.yaml] [--output /path/to/reports]\n');

  console.log(chalk.yellow.bold('参数：'));
  console.log('  --config <file>      认证与测试参数的 YAML 配置文件');
  console.log('  --output <path>      自定义会话输出目录（默认：./audit-logs/）');
  console.log('  --pipeline-testing   使用最小提示词进行快速流水线测试（生成最小交付物）');
  console.log('  --disable-loader     关闭动态进度加载动画（日志与转圈冲突时可用）');
  console.log('  --help               显示帮助信息\n');

  console.log(chalk.yellow.bold('示例：'));
  console.log('  shannon "https://example.com" "/path/to/local/repo"');
  console.log('  shannon "https://example.com" "/path/to/local/repo" --config auth.yaml');
  console.log('  shannon "https://example.com" "/path/to/local/repo" --output /path/to/reports');
  console.log('  shannon "https://example.com" "/path/to/local/repo" --pipeline-testing\n');

  console.log(chalk.yellow.bold('要求：'));
  console.log('  • WEB_URL 必须以 http:// 或 https:// 开头');
  console.log('  • REPO_PATH 必须是可访问的本地目录');
  console.log('  • 仅可测试你拥有或获得授权的系统\n');

  console.log(chalk.yellow.bold('环境变量：'));
  console.log('  PENTEST_MAX_RETRIES    AI 智能体重试次数（默认：3）');
}

// Export the splash screen function for use in main
// 将启动欢迎页透传给主入口，避免主入口直接依赖 splash-screen 模块路径。
export { displaySplashScreen };

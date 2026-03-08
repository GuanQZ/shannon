// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 启动前检测外部安全工具与运行环境依赖（如 nmap、subfinder、whatweb）是否可用。
 * 该文件用于在任务执行前尽早暴露环境问题，避免中途失败造成时间与资源浪费。
 */

import { $ } from 'zx';
import chalk from 'chalk';

type ToolName = 'nmap' | 'subfinder' | 'whatweb' | 'schemathesis';

export type ToolAvailability = Record<ToolName, boolean>;

// Check availability of required tools
// 检查必需工具的可用性。
export const checkToolAvailability = async (): Promise<ToolAvailability> => {
  const tools: ToolName[] = ['nmap', 'subfinder', 'whatweb', 'schemathesis'];
  const availability: ToolAvailability = {
    nmap: false,
    subfinder: false,
    whatweb: false,
    schemathesis: false
  };

  console.log(chalk.blue('🔧 正在检查工具可用性...'));

  for (const tool of tools) {
    try {
      await $`command -v ${tool}`;
      availability[tool] = true;
      console.log(chalk.green(`  ✅ ${tool} - 可用`));
    } catch {
      availability[tool] = false;
      console.log(chalk.yellow(`  ⚠️ ${tool} - 未找到`));
    }
  }

  return availability;
};

// Handle missing tools with user-friendly messages
// 以用户友好的方式处理缺失工具提示。
export const handleMissingTools = (toolAvailability: ToolAvailability): ToolName[] => {
  const missing = (Object.entries(toolAvailability) as Array<[ToolName, boolean]>)
    .filter(([, available]) => !available)
    .map(([tool]) => tool);

  if (missing.length > 0) {
    console.log(chalk.yellow(`\n⚠️ 缺失工具：${missing.join(', ')}`));
    console.log(chalk.gray('部分能力将受限，请安装缺失工具以获得完整功能。'));

    // Provide installation hints
    // 提供安装提示。
    const installHints: Record<ToolName, string> = {
      'nmap': 'brew install nmap (macOS) or apt install nmap (Ubuntu)',
      'subfinder': 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
      'whatweb': 'gem install whatweb',
      'schemathesis': 'pip install schemathesis'
    };

    console.log(chalk.gray('\n安装建议：'));
    missing.forEach(tool => {
      console.log(chalk.gray(`  ${tool}: ${installHints[tool]}`));
    });
    console.log('');
  }

  return missing;
};

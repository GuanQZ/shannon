// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * MCP 服务入口工厂，负责注册 Shannon 所需工具（保存交付物、生成 TOTP）并暴露统一服务实例。
 * 该文件是主流程与 MCP 工具能力连接的桥接层。
 */

/**
 * Lumin Helper MCP Server
 * Lumin 辅助 MCP 服务。
 *
 * In-process MCP server providing save_deliverable and generate_totp tools
 * 进程内 MCP 服务，提供 save_deliverable 与 generate_totp 两个工具。
 * for Lumin penetration testing agents.
 * 面向 Lumin 渗透测试代理使用。
 *
 * Replaces bash script invocations with native tool access.
 * 用原生工具访问替代 bash 脚本调用。
 *
 * Uses factory pattern to create tools with targetDir captured in closure,
 * 使用工厂模式创建工具，并通过闭包捕获 targetDir，
 * ensuring thread-safety when multiple workflows run in parallel.
 * 在多个工作流并行时仍能保持线程安全。
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createSaveDeliverableTool } from './tools/save-deliverable.js';
import { generateTotpTool } from './tools/generate-totp.js';

/**
 * Create Lumin Helper MCP Server with target directory context
 * 创建带目标目录上下文的 Lumin 辅助 MCP 服务。
 *
 * Each workflow should create its own MCP server instance with its targetDir.
 * 每个工作流都应创建自己的 MCP 服务实例并绑定独立 targetDir。
 * The save_deliverable tool captures targetDir in a closure, preventing race
 * save_deliverable 工具通过闭包捕获 targetDir，可避免竞态问题。
 * conditions when multiple workflows run in parallel.
 * 这样可避免并行工作流之间互相写错目录。
 */
export function createLuminHelperServer(targetDir: string): ReturnType<typeof createSdkMcpServer> {
  // Create save_deliverable tool with targetDir in closure (no global variable)
  // 创建带 targetDir 闭包的 save_deliverable 工具，不依赖全局变量。
  const saveDeliverableTool = createSaveDeliverableTool(targetDir);

  return createSdkMcpServer({
    name: 'lumin-helper',
    version: '1.0.0',
    tools: [saveDeliverableTool, generateTotpTool],
  });
}

// Export factory for direct usage if needed
// Export factory for direct usage 如果 needed。
export { createSaveDeliverableTool } from './tools/save-deliverable.js';
export { generateTotpTool } from './tools/generate-totp.js';

// Backward compatibility alias
export const createShannonHelperServer = createLuminHelperServer;

// Export types for external use
// Export 类型 for external 使用。
export * from './types/index.js';

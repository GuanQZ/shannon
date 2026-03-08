// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供交付物持久化 MCP 工具实现，将 agent 产出写入目标仓库约定目录。
 * 该文件用于规范结果落盘，保障报告与中间产物可追踪。
 */

/**
 * save_deliverable MCP Tool
 * save_deliverable MCP 工具。
 *
 * Saves deliverable files with automatic validation.
 * 自动校验并保存交付物文件。
 * Replaces tools/save_deliverable.js bash script.
 * 用 TypeScript 实现替代 tools/save_deliverable.js 脚本。
 *
 * Uses factory pattern to capture targetDir in closure, avoiding race conditions
 * 采用工厂模式通过闭包捕获 targetDir，避免竞态条件。
 * when multiple workflows run in parallel.
 * 适用于多个工作流并行执行的场景。
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { DeliverableType, DELIVERABLE_FILENAMES, isQueueType } from '../types/deliverables.js';
import { createToolResult, type ToolResult, type SaveDeliverableResponse } from '../types/tool-responses.js';
import { validateQueueJson } from '../validation/queue-validator.js';
import { saveDeliverableFile } from '../utils/file-operations.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';

/**
 * Input schema for save_deliverable tool
 * save_deliverable 工具的输入参数模式。
 */
export const SaveDeliverableInputSchema = z.object({
  deliverable_type: z.nativeEnum(DeliverableType).describe('Type of deliverable to save'),
  content: z.string().min(1).optional().describe('File content (markdown for analysis/evidence, JSON for queues). Optional if file_path is provided.'),
  file_path: z.string().optional().describe('Path to a file whose contents should be used as the deliverable content. Relative paths are resolved against the deliverables directory. Use this instead of content for large reports to avoid output token limits.'),
});

export type SaveDeliverableInput = z.infer<typeof SaveDeliverableInputSchema>;

/**
 * Check if a path is contained within a base directory.
 * 检查路径是否位于指定基础目录之内。
 * Prevents path traversal attacks (e.g., ../../../etc/passwd).
 * 用于防止路径穿越攻击（如 ../../../etc/passwd）。
 */
function isPathContained(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

/**
 * Resolve deliverable content from either inline content or a file path.
 * 从内联内容或文件路径中解析交付物文本内容。
 * Returns the content string on success, or a ToolResult error on failure.
 * 成功时返回内容字符串，失败时返回 ToolResult 错误对象。
 */
function resolveContent(
  args: SaveDeliverableInput,
  targetDir: string,
): string | ToolResult {
  if (args.content) {
    return args.content;
  }

  if (!args.file_path) {
    return createToolResult(createValidationError(
      'Either "content" or "file_path" must be provided',
      true,
      { deliverableType: args.deliverable_type },
    ));
  }

  const resolvedPath = path.isAbsolute(args.file_path)
    ? args.file_path
    : path.resolve(targetDir, args.file_path);

  // Security: Prevent path traversal outside targetDir
  // 安全控制：阻止路径遍历到 targetDir 之外。
  if (!isPathContained(targetDir, resolvedPath)) {
    return createToolResult(createValidationError(
      `Path "${args.file_path}" resolves outside allowed directory`,
      false,
      { deliverableType: args.deliverable_type, allowedBase: targetDir },
    ));
  }

  try {
    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch (readError) {
    return createToolResult(createValidationError(
      `Failed to read file at ${resolvedPath}: ${readError instanceof Error ? readError.message : String(readError)}`,
      true,
      { deliverableType: args.deliverable_type, filePath: resolvedPath },
    ));
  }
}

/**
 * Create save_deliverable handler with targetDir captured in closure.
 * 创建带 targetDir 闭包的 save_deliverable 处理器。
 *
 * This factory pattern ensures each MCP server instance has its own targetDir,
 * 工厂模式确保每个 MCP 服务实例都绑定独立 targetDir，
 * preventing race conditions when multiple workflows run in parallel.
 * 避免并行工作流之间出现目录写入竞态。
 */
function createSaveDeliverableHandler(targetDir: string) {
  return async function saveDeliverable(args: SaveDeliverableInput): Promise<ToolResult> {
    try {
      const { deliverable_type } = args;

      const contentOrError = resolveContent(args, targetDir);
      if (typeof contentOrError !== 'string') {
        return contentOrError;
      }
      const content = contentOrError;

      if (isQueueType(deliverable_type)) {
        const queueValidation = validateQueueJson(content);
        if (!queueValidation.valid) {
          return createToolResult(createValidationError(
            queueValidation.message ?? 'Invalid queue JSON',
            true,
            { deliverableType: deliverable_type, expectedFormat: '{"vulnerabilities": [...]}' },
          ));
        }
      }

      const filename = DELIVERABLE_FILENAMES[deliverable_type];
      const filepath = saveDeliverableFile(targetDir, filename, content);

      const successResponse: SaveDeliverableResponse = {
        status: 'success',
        message: `Deliverable saved successfully: ${filename}`,
        filepath,
        deliverableType: deliverable_type,
        validated: isQueueType(deliverable_type),
      };

      return createToolResult(successResponse);
    } catch (error) {
      return createToolResult(createGenericError(
        error,
        false,
        { deliverableType: args.deliverable_type },
      ));
    }
  };
}

/**
 * Factory function to create save_deliverable tool with targetDir in closure
 * 工厂函数：创建带 targetDir 闭包的 save_deliverable 工具。
 *
 * Each MCP server instance should call this with its own targetDir to ensure
 * 每个 MCP 服务实例都应传入自己的 targetDir，
 * deliverables are saved to the correct workflow's directory.
 * 以确保交付物写入正确的工作流目录。
 */
export function createSaveDeliverableTool(targetDir: string) {
  return tool(
    'save_deliverable',
    'Saves deliverable files with automatic validation. Queue files must have {"vulnerabilities": [...]} structure. For large reports, write the file to disk first then pass file_path instead of inline content to avoid output token limits.',
    SaveDeliverableInputSchema.shape,
    createSaveDeliverableHandler(targetDir)
  );
}

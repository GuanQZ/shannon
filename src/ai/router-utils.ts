// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供模型路由相关工具函数，用于解析多模型路由场景下“实际生效的模型名称”。
 * 该文件支撑路由模式下的可观测性与审计一致性，便于成本统计和问题定位。
 */

/**
 * Get the actual model name being used.
 * Get the actual 模型 name being used.。
 * When using claude-code-router, the SDK reports its configured model (claude-sonnet)
 * 当 使用 claude-code-router, the SDK reports its configured 模型 (claude-sonnet)。
 * but the actual model is determined by ROUTER_DEFAULT env var.
 * but the actual 模型 is determined by ROUTER_DEFAULT env var.。
 */
export function getActualModelName(sdkReportedModel?: string): string | undefined {
  const routerBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const routerDefault = process.env.ROUTER_DEFAULT;

  // If router mode is active and ROUTER_DEFAULT is set, use that
  // 如果 router 模式 is active and ROUTER_DEFAULT is set, 使用 that。
  if (routerBaseUrl && routerDefault) {
    // ROUTER_DEFAULT format: "provider,model" (e.g., "gemini,gemini-2.5-pro")
    // ROUTER_DEFAULT 格式: "provider,模型" (e.g., "gemini,gemini-2.5-pro")。
    const parts = routerDefault.split(',');
    if (parts.length >= 2) {
      return parts.slice(1).join(','); // Handle model names with commas
    }
  }

  // Fall back to SDK-reported model
  // Fall back to SDK-reported 模型。
  return sdkReportedModel;
}

/**
 * Check if router mode is active.
 * 检查 如果 router 模式 is active.。
 */
export function isRouterMode(): boolean {
  return !!process.env.ANTHROPIC_BASE_URL && !!process.env.ROUTER_DEFAULT;
}

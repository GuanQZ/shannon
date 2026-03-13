// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 定义交付物对象结构与相关类型，约束保存工具输入输出契约。
 * 该文件确保不同 agent 输出在类型层面一致。
 */

/**
 * Deliverable Type Definitions
 * 交付物类型定义。
 *
 * Maps deliverable types to their filenames and defines validation requirements.
 * 定义交付物类型与文件名映射，并声明对应校验要求。
 * Must match the exact mappings from tools/save_deliverable.js.
 * 必须与 tools/save_deliverable.js 中的映射保持一致。
 */

export enum DeliverableType {
  // Pre-recon agent
  // 预侦察代理。
  CODE_ANALYSIS = 'CODE_ANALYSIS',

  // Recon agent
  // 侦察代理。
  RECON = 'RECON',

  // Vulnerability analysis agents
  // 漏洞分析代理。
  INJECTION_ANALYSIS = 'INJECTION_ANALYSIS',
  INJECTION_QUEUE = 'INJECTION_QUEUE',

  XSS_ANALYSIS = 'XSS_ANALYSIS',
  XSS_QUEUE = 'XSS_QUEUE',

  AUTH_ANALYSIS = 'AUTH_ANALYSIS',
  AUTH_QUEUE = 'AUTH_QUEUE',

  AUTHZ_ANALYSIS = 'AUTHZ_ANALYSIS',
  AUTHZ_QUEUE = 'AUTHZ_QUEUE',

  SSRF_ANALYSIS = 'SSRF_ANALYSIS',
  SSRF_QUEUE = 'SSRF_QUEUE',

  // Exploitation agents
  // 利用代理。
  INJECTION_EVIDENCE = 'INJECTION_EVIDENCE',
  XSS_EVIDENCE = 'XSS_EVIDENCE',
  AUTH_EVIDENCE = 'AUTH_EVIDENCE',
  AUTHZ_EVIDENCE = 'AUTHZ_EVIDENCE',
  SSRF_EVIDENCE = 'SSRF_EVIDENCE',
}

/**
 * Hard-coded filename mappings from agent prompts
 * 来自代理提示模板的固定文件名映射。
 * Must match tools/save_deliverable.js exactly
 * 必须与 tools/save_deliverable.js 完全一致。
 */
export const DELIVERABLE_FILENAMES: Record<DeliverableType, string> = {
  [DeliverableType.CODE_ANALYSIS]: 'code_analysis_deliverable.md',
  [DeliverableType.RECON]: 'recon_deliverable.md',
  [DeliverableType.INJECTION_ANALYSIS]: 'injection_analysis_deliverable.md',
  [DeliverableType.INJECTION_QUEUE]: 'injection_exploitation_queue.json',
  [DeliverableType.XSS_ANALYSIS]: 'xss_analysis_deliverable.md',
  [DeliverableType.XSS_QUEUE]: 'xss_exploitation_queue.json',
  [DeliverableType.AUTH_ANALYSIS]: 'auth_analysis_deliverable.md',
  [DeliverableType.AUTH_QUEUE]: 'auth_exploitation_queue.json',
  [DeliverableType.AUTHZ_ANALYSIS]: 'authz_analysis_deliverable.md',
  [DeliverableType.AUTHZ_QUEUE]: 'authz_exploitation_queue.json',
  [DeliverableType.SSRF_ANALYSIS]: 'ssrf_analysis_deliverable.md',
  [DeliverableType.SSRF_QUEUE]: 'ssrf_exploitation_queue.json',
  [DeliverableType.INJECTION_EVIDENCE]: 'injection_exploitation_evidence.md',
  [DeliverableType.XSS_EVIDENCE]: 'xss_exploitation_evidence.md',
  [DeliverableType.AUTH_EVIDENCE]: 'auth_exploitation_evidence.md',
  [DeliverableType.AUTHZ_EVIDENCE]: 'authz_exploitation_evidence.md',
  [DeliverableType.SSRF_EVIDENCE]: 'ssrf_exploitation_evidence.md',
};

/**
 * Queue types that require JSON validation
 * 需要 JSON 校验的队列类型。
 */
export const QUEUE_TYPES: DeliverableType[] = [
  DeliverableType.INJECTION_QUEUE,
  DeliverableType.XSS_QUEUE,
  DeliverableType.AUTH_QUEUE,
  DeliverableType.AUTHZ_QUEUE,
  DeliverableType.SSRF_QUEUE,
];

/**
 * Type guard to check if a deliverable type is a queue
 * 类型守卫：判断交付物类型是否属于队列。
 */
export function isQueueType(type: string): boolean {
  return QUEUE_TYPES.includes(type as DeliverableType);
}

/**
 * Vulnerability queue structure
 * 漏洞 队列 结构。
 */
export interface VulnerabilityQueue {
  vulnerabilities: VulnerabilityItem[];
}

export interface VulnerabilityItem {
  [key: string]: unknown;
}

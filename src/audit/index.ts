// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 审计模块统一导出入口，聚合会话、日志与指标能力供执行流程按需引用。
 * 该文件降低调用方对内部目录结构的耦合。
 */

/**
 * Unified Audit & Metrics System
 * Unified 审计 & Metrics 系统。
 *
 * Public API for the audit system. Provides crash-safe, append-only logging
 * Public API for the 审计 系统. Provides crash-安全, append-仅 日志记录。
 * and comprehensive metrics tracking for Lumin penetration testing sessions.
 * and comprehensive metrics tracking for Lumin penetration testing sessions.。
 *
 * IMPORTANT: Session objects must have an 'id' field (NOT 'sessionId')
 * IMPORTANT: Session objects must have an 'id' field (NOT 'sessionId')。
 * Example: { id: "uuid", webUrl: "...", repoPath: "..." }
 * Example: { id: "uuid", webUrl: "...", repoPath: "..." }。
 *
 * @module audit
 * @module 审计。
 */

export { AuditSession } from './audit-session.js';
export { AgentLogger } from './logger.js';
export { WorkflowLogger } from './workflow-logger.js';
export { MetricsTracker } from './metrics-tracker.js';
export * as AuditUtils from './utils.js';

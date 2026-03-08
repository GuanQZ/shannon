// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 为 AI 执行过程提供审计日志适配层，封装“启用/禁用审计”两种模式的统一调用接口。
 * 该文件通过空对象模式降低调用方分支判断复杂度，保证日志链路稳定。
 */

// Null Object pattern for audit logging - callers never check for null
// 审计日志采用空对象模式，调用方无需判空。

import type { AuditSession } from '../audit/index.js';
import { formatTimestamp } from '../utils/formatting.js';

export interface AuditLogger {
  logLlmResponse(turn: number, content: string): Promise<void>;
  logToolStart(toolName: string, parameters: unknown): Promise<void>;
  logToolEnd(result: unknown): Promise<void>;
  logError(error: Error, duration: number, turns: number): Promise<void>;
}

class RealAuditLogger implements AuditLogger {
  private auditSession: AuditSession;

  constructor(auditSession: AuditSession) {
    this.auditSession = auditSession;
  }

  async logLlmResponse(turn: number, content: string): Promise<void> {
    await this.auditSession.logEvent('llm_response', {
      turn,
      content,
      timestamp: formatTimestamp(),
    });
  }

  async logToolStart(toolName: string, parameters: unknown): Promise<void> {
    await this.auditSession.logEvent('tool_start', {
      toolName,
      parameters,
      timestamp: formatTimestamp(),
    });
  }

  async logToolEnd(result: unknown): Promise<void> {
    await this.auditSession.logEvent('tool_end', {
      result,
      timestamp: formatTimestamp(),
    });
  }

  async logError(error: Error, duration: number, turns: number): Promise<void> {
    await this.auditSession.logEvent('error', {
      message: error.message,
      errorType: error.constructor.name,
      stack: error.stack,
      duration,
      turns,
      timestamp: formatTimestamp(),
    });
  }
}

/** Null Object implementation - all methods are safe no-ops */
/* * 空值 对象 implementation - all methods are 安全 no-ops。 */
class NullAuditLogger implements AuditLogger {
  async logLlmResponse(_turn: number, _content: string): Promise<void> {}

  async logToolStart(_toolName: string, _parameters: unknown): Promise<void> {}

  async logToolEnd(_result: unknown): Promise<void> {}

  async logError(_error: Error, _duration: number, _turns: number): Promise<void> {}
}

// Returns no-op when auditSession is null
// 当 auditSession 为空时返回空操作实现。
export function createAuditLogger(auditSession: AuditSession | null): AuditLogger {
  if (auditSession) {
    return new RealAuditLogger(auditSession);
  }

  return new NullAuditLogger();
}

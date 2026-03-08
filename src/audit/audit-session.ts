// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 审计子系统门面（Facade），统一协调日志记录、指标采集与会话级目录管理。
 * 该文件向上层屏蔽审计实现细节，提供稳定的会话审计入口。
 */

/**
 * Audit Session - Main Facade
 * 审计 Session - Main Facade。
 *
 * Coordinates logger, metrics tracker, and concurrency control for comprehensive
 * Coordinates 日志器, metrics tracker, and concurrency control for comprehensive。
 * crash-safe audit logging.
 * crash-安全 审计 日志记录.。
 */

import { AgentLogger } from './logger.js';
import { WorkflowLogger, type AgentLogDetails, type WorkflowSummary } from './workflow-logger.js';
import { MetricsTracker } from './metrics-tracker.js';
import { initializeAuditStructure, type SessionMetadata } from './utils.js';
import { formatTimestamp } from '../utils/formatting.js';
import { SessionMutex } from '../utils/concurrency.js';

// Global mutex instance
// Global mutex instance。
const sessionMutex = new SessionMutex();

interface AgentEndResult {
  attemptNumber: number;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;
  success: boolean;
  model?: string | undefined;
  error?: string | undefined;
  checkpoint?: string | undefined;
  isFinalAttempt?: boolean | undefined;
}

/**
 * AuditSession - Main audit system facade
 * AuditSession - Main 审计 系统 facade。
 */
export class AuditSession {
  private sessionMetadata: SessionMetadata;
  private sessionId: string;
  private metricsTracker: MetricsTracker;
  private workflowLogger: WorkflowLogger;
  private currentLogger: AgentLogger | null = null;
  private currentAgentName: string | null = null;
  private initialized: boolean = false;

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.sessionId = sessionMetadata.id;

    // Validate required fields
    // 校验 必需 fields。
    if (!this.sessionId) {
      throw new Error('sessionMetadata.id is required');
    }
    if (!this.sessionMetadata.webUrl) {
      throw new Error('sessionMetadata.webUrl is required');
    }

    // Components
    // Components。
    this.metricsTracker = new MetricsTracker(sessionMetadata);
    this.workflowLogger = new WorkflowLogger(sessionMetadata);
  }

  /**
   * Initialize audit session (creates directories, session.json)
   * Initialize 审计 session (creates directories, session.JSON)。
   * Idempotent and race-safe
   * Idempotent and race-安全。
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return; // Already initialized
    }

    // Create directory structure
    // 创建 directory 结构。
    await initializeAuditStructure(this.sessionMetadata);

    // Initialize metrics tracker (loads or creates session.json)
    // Initialize metrics tracker (loads or creates session.json)。
    await this.metricsTracker.initialize();

    // Initialize workflow logger
    // Initialize 工作流 日志器。
    await this.workflowLogger.initialize();

    this.initialized = true;
  }

  /**
   * Ensure initialized (helper for lazy initialization)
   * 确保 initialized (辅助 for lazy initialization)。
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Start agent execution
   * Start 代理 execution。
   */
  async startAgent(
    agentName: string,
    promptContent: string,
    attemptNumber: number = 1
  ): Promise<void> {
    await this.ensureInitialized();

    // Save prompt snapshot (only on first attempt)
    // 保存 prompt snapshot (仅 于 first attempt)。
    if (attemptNumber === 1) {
      await AgentLogger.savePrompt(this.sessionMetadata, agentName, promptContent);
    }

    // Track current agent name for workflow logging
    // Track current 代理 name for 工作流 日志记录。
    this.currentAgentName = agentName;

    // Create and initialize logger for this attempt
    // 创建 and initialize 日志器 for this attempt。
    this.currentLogger = new AgentLogger(this.sessionMetadata, agentName, attemptNumber);
    await this.currentLogger.initialize();

    // Start metrics tracking
    // Start metrics tracking。
    this.metricsTracker.startAgent(agentName, attemptNumber);

    // Log start event
    // Log start event。
    await this.currentLogger.logEvent('agent_start', {
      agentName,
      attemptNumber,
      timestamp: formatTimestamp(),
    });

    // Log to unified workflow log
    // Log to unified 工作流 log。
    await this.workflowLogger.logAgent(agentName, 'start', { attemptNumber });
  }

  /**
   * Log event during agent execution
   * Log event during 代理 execution。
   */
  async logEvent(eventType: string, eventData: unknown): Promise<void> {
    if (!this.currentLogger) {
      throw new Error('No active logger. Call startAgent() first.');
    }

    // Log to agent-specific log file (JSON format)
    // Log to 代理-specific log 文件 (JSON 格式)。
    await this.currentLogger.logEvent(eventType, eventData);

    // Also log to unified workflow log (human-readable format)
    // Also log to unified 工作流 log (human-readable 格式)。
    const data = eventData as Record<string, unknown>;
    const agentName = this.currentAgentName || 'unknown';
    switch (eventType) {
      case 'tool_start':
        await this.workflowLogger.logToolStart(
          agentName,
          String(data.toolName || ''),
          data.parameters
        );
        break;
      case 'llm_response':
        await this.workflowLogger.logLlmResponse(
          agentName,
          Number(data.turn || 0),
          String(data.content || '')
        );
        break;
      // tool_end and error events are intentionally not logged to workflow log
      // tool_end and 错误 events are intentionally not logged to 工作流 log。
      // to reduce noise - the agent completion message captures the outcome
      // to reduce noise - the 代理 completion 消息 captures the outcome。
    }
  }

  /**
   * End agent execution (mutex-protected)
   * End 代理 execution (mutex-protected)。
   */
  async endAgent(agentName: string, result: AgentEndResult): Promise<void> {
    // Log end event
    // Log end event。
    if (this.currentLogger) {
      await this.currentLogger.logEvent('agent_end', {
        agentName,
        success: result.success,
        duration_ms: result.duration_ms,
        cost_usd: result.cost_usd,
        timestamp: formatTimestamp(),
      });

      // Close logger
      // Close 日志器。
      await this.currentLogger.close();
      this.currentLogger = null;
    }

    // Reset current agent name
    // Reset current 代理 name。
    this.currentAgentName = null;

    // Log to unified workflow log
    // Log to unified 工作流 log。
    const agentLogDetails: AgentLogDetails = {
      attemptNumber: result.attemptNumber,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
      success: result.success,
      ...(result.error !== undefined && { error: result.error }),
    };
    await this.workflowLogger.logAgent(agentName, 'end', agentLogDetails);

    // Mutex-protected update to session.json
    // Mutex-protected update to session.json。
    const unlock = await sessionMutex.lock(this.sessionId);
    try {
      // Reload inside mutex to prevent lost updates during parallel exploitation phase
      // Reload inside mutex to 防止 lost updates during 并行 利用 阶段。
      await this.metricsTracker.reload();

      // Update metrics
      // Update metrics。
      await this.metricsTracker.endAgent(agentName, result);
    } finally {
      unlock();
    }
  }

  /**
   * Update session status
   * Update session status。
   */
  async updateSessionStatus(status: 'in-progress' | 'completed' | 'failed'): Promise<void> {
    await this.ensureInitialized();

    const unlock = await sessionMutex.lock(this.sessionId);
    try {
      await this.metricsTracker.reload();
      await this.metricsTracker.updateSessionStatus(status);
    } finally {
      unlock();
    }
  }

  /**
   * Get current metrics (read-only)
   * Get current metrics (读取-仅)。
   */
  async getMetrics(): Promise<unknown> {
    await this.ensureInitialized();
    return this.metricsTracker.getMetrics();
  }

  /**
   * Log phase start to unified workflow log
   * Log 阶段 start to unified 工作流 log。
   */
  async logPhaseStart(phase: string): Promise<void> {
    await this.ensureInitialized();
    await this.workflowLogger.logPhase(phase, 'start');
  }

  /**
   * Log phase completion to unified workflow log
   * Log 阶段 completion to unified 工作流 log。
   */
  async logPhaseComplete(phase: string): Promise<void> {
    await this.ensureInitialized();
    await this.workflowLogger.logPhase(phase, 'complete');
  }

  /**
   * Log workflow completion to unified workflow log
   * Log 工作流 completion to unified 工作流 log。
   */
  async logWorkflowComplete(summary: WorkflowSummary): Promise<void> {
    await this.ensureInitialized();
    await this.workflowLogger.logWorkflowComplete(summary);
  }
}

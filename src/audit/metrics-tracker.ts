// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 跟踪并汇总执行指标（时长、成本、轮次等），为流程监控与报告输出提供量化数据。
 * 该文件支撑性能分析、成本治理与质量回归评估。
 */

/**
 * Metrics Tracker
 * Metrics Tracker。
 *
 * Manages session.json with comprehensive timing, cost, and validation metrics.
 * Manages session.JSON with comprehensive timing, 成本, and 校验 metrics.。
 * Tracks attempt-level data for complete forensic trail.
 * Tracks attempt-level data for complete forensic trail.。
 */

import {
  generateSessionJsonPath,
  type SessionMetadata,
} from './utils.js';
import { atomicWrite, readJson, fileExists } from '../utils/file-io.js';
import { formatTimestamp, calculatePercentage } from '../utils/formatting.js';
import { AGENT_PHASE_MAP, type PhaseName } from '../session-manager.js';
import type { AgentName } from '../types/index.js';

interface AttemptData {
  attempt_number: number;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;
  success: boolean;
  timestamp: string;
  model?: string | undefined;
  error?: string | undefined;
}

interface AgentMetrics {
  status: 'in-progress' | 'success' | 'failed';
  attempts: AttemptData[];
  final_duration_ms: number;
  total_cost_usd: number;
  total_tokens: number;
  model?: string | undefined;
  checkpoint?: string | undefined;
}

interface PhaseMetrics {
  duration_ms: number;
  duration_percentage: number;
  cost_usd: number;
  total_tokens: number;
  agent_count: number;
}

interface SessionData {
  session: {
    id: string;
    webUrl: string;
    repoPath?: string;
    status: 'in-progress' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
  };
  metrics: {
    total_duration_ms: number;
    total_cost_usd: number;
    total_tokens: number;
    phases: Record<string, PhaseMetrics>;
    agents: Record<string, AgentMetrics>;
  };
}

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

interface ActiveTimer {
  startTime: number;
  attemptNumber: number;
}

/**
 * MetricsTracker - Manages metrics for a session
 * MetricsTracker - Manages metrics for a session。
 */
export class MetricsTracker {
  private sessionMetadata: SessionMetadata;
  private sessionJsonPath: string;
  private data: SessionData | null = null;
  private activeTimers: Map<string, ActiveTimer> = new Map();

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.sessionJsonPath = generateSessionJsonPath(sessionMetadata);
  }

  /**
   * Initialize session.json (idempotent)
   * Initialize session.json (idempotent)。
   */
  async initialize(): Promise<void> {
    // Check if session.json already exists
    // 检查 如果 session.JSON already exists。
    const exists = await fileExists(this.sessionJsonPath);

    if (exists) {
      // Load existing data
      // 加载 existing data。
      this.data = await readJson<SessionData>(this.sessionJsonPath);
    } else {
      // Create new session.json
      // 创建 new session.JSON。
      this.data = this.createInitialData();
      await this.save();
    }
  }

  /**
   * Create initial session.json structure
   * 创建 initial session.JSON 结构。
   */
  private createInitialData(): SessionData {
    const sessionData: SessionData = {
      session: {
        id: this.sessionMetadata.id,
        webUrl: this.sessionMetadata.webUrl,
        status: 'in-progress',
        createdAt: (this.sessionMetadata as { createdAt?: string }).createdAt || formatTimestamp(),
      },
      metrics: {
        total_duration_ms: 0,
        total_cost_usd: 0,
        total_tokens: 0,
        phases: {}, // Phase-level aggregations
        agents: {}, // Agent-level metrics
      },
    };
    // Only add repoPath if it exists
    // 仅 add repoPath 如果 it exists。
    if (this.sessionMetadata.repoPath) {
      sessionData.session.repoPath = this.sessionMetadata.repoPath;
    }
    return sessionData;
  }

  /**
   * Start tracking an agent execution
   * Start tracking an 代理 execution。
   */
  startAgent(agentName: string, attemptNumber: number): void {
    this.activeTimers.set(agentName, {
      startTime: Date.now(),
      attemptNumber,
    });
  }

  /**
   * End agent execution and update metrics
   * End 代理 execution and update metrics。
   */
  async endAgent(agentName: string, result: AgentEndResult): Promise<void> {
    if (!this.data) {
      throw new Error('MetricsTracker not initialized');
    }

    // Initialize agent metrics if not exists
    // Initialize 代理 metrics 如果 not exists。
    const existingAgent = this.data.metrics.agents[agentName];
    const agent = existingAgent ?? {
      status: 'in-progress' as const,
      attempts: [],
      final_duration_ms: 0,
      total_cost_usd: 0,
      total_tokens: 0,
    };
    this.data.metrics.agents[agentName] = agent;

    // Add attempt to array
    // Add attempt to array。
    const attempt: AttemptData = {
      attempt_number: result.attemptNumber,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
      total_tokens: result.total_tokens || 0,
      success: result.success,
      timestamp: formatTimestamp(),
    };

    if (result.model) {
      attempt.model = result.model;
    }

    if (result.error) {
      attempt.error = result.error;
    }

    agent.attempts.push(attempt);

    // Update total cost (includes failed attempts)
    // Update total 成本 (includes failed attempts)。
    agent.total_cost_usd = agent.attempts.reduce((sum, a) => sum + a.cost_usd, 0);
    agent.total_tokens = agent.attempts.reduce((sum, a) => sum + a.total_tokens, 0);

    // If successful, update final metrics and status
    // 如果 successful, update final metrics and status。
    if (result.success) {
      agent.status = 'success';
      agent.final_duration_ms = result.duration_ms;

      if (result.model) {
        agent.model = result.model;
      }

      if (result.checkpoint) {
        agent.checkpoint = result.checkpoint;
      }
    } else {
      // If this was the last attempt, mark as failed
      // 如果 this was the last attempt, mark as failed。
      if (result.isFinalAttempt) {
        agent.status = 'failed';
      }
    }

    // Clear active timer
    // Clear active timer。
    this.activeTimers.delete(agentName);

    // Recalculate aggregations
    // Recalculate aggregations。
    this.recalculateAggregations();

    // Save to disk
    // 保存 to disk。
    await this.save();
  }

  /**
   * Update session status
   * Update session status。
   */
  async updateSessionStatus(status: 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.data) return;

    this.data.session.status = status;

    if (status === 'completed' || status === 'failed') {
      this.data.session.completedAt = formatTimestamp();
    }

    await this.save();
  }

  /**
   * Recalculate aggregations (total duration, total cost, phases)
   * Recalculate aggregations (total 耗时, total 成本, phases)。
   */
  private recalculateAggregations(): void {
    if (!this.data) return;

    const agents = this.data.metrics.agents;

    // Only count successful agents
    // 仅 count successful agents。
    const successfulAgents = Object.entries(agents).filter(
      ([, data]) => data.status === 'success'
    );

    // Calculate total duration and cost
    // Calculate total 耗时 and 成本。
    const totalDuration = successfulAgents.reduce(
      (sum, [, data]) => sum + data.final_duration_ms,
      0
    );

    const totalCost = successfulAgents.reduce((sum, [, data]) => sum + data.total_cost_usd, 0);
    const totalTokens = successfulAgents.reduce((sum, [, data]) => sum + data.total_tokens, 0);

    this.data.metrics.total_duration_ms = totalDuration;
    this.data.metrics.total_cost_usd = totalCost;
    this.data.metrics.total_tokens = totalTokens;

    // Calculate phase-level metrics
    // Calculate 阶段-level metrics。
    this.data.metrics.phases = this.calculatePhaseMetrics(successfulAgents);
  }

  /**
   * Calculate phase-level metrics
   * Calculate 阶段-level metrics。
   */
  private calculatePhaseMetrics(
    successfulAgents: Array<[string, AgentMetrics]>
  ): Record<string, PhaseMetrics> {
    const phases: Record<PhaseName, AgentMetrics[]> = {
      'pre-recon': [],
      'recon': [],
      'vulnerability-analysis': [],
      'exploitation': [],
      'reporting': [],
    };

    // Group agents by phase using imported AGENT_PHASE_MAP
    // Group agents by 阶段 使用 imported AGENT_PHASE_MAP。
    for (const [agentName, agentData] of successfulAgents) {
      const phase = AGENT_PHASE_MAP[agentName as AgentName];
      if (phase) {
        phases[phase].push(agentData);
      }
    }

    // Calculate metrics per phase
    // Calculate metrics per 阶段。
    const phaseMetrics: Record<string, PhaseMetrics> = {};
    const totalDuration = this.data!.metrics.total_duration_ms;

    for (const [phaseName, agentList] of Object.entries(phases)) {
      if (agentList.length === 0) continue;

      const phaseDuration = agentList.reduce((sum, agent) => sum + agent.final_duration_ms, 0);
      const phaseCost = agentList.reduce((sum, agent) => sum + agent.total_cost_usd, 0);
      const phaseTokens = agentList.reduce((sum, agent) => sum + agent.total_tokens, 0);

      phaseMetrics[phaseName] = {
        duration_ms: phaseDuration,
        duration_percentage: calculatePercentage(phaseDuration, totalDuration),
        cost_usd: phaseCost,
        total_tokens: phaseTokens,
        agent_count: agentList.length,
      };
    }

    return phaseMetrics;
  }

  /**
   * Get current metrics
   * Get current metrics。
   */
  getMetrics(): SessionData {
    return JSON.parse(JSON.stringify(this.data)) as SessionData;
  }

  /**
   * Save metrics to session.json (atomic write)
   * 保存 metrics to session.JSON (atomic 写入)。
   */
  private async save(): Promise<void> {
    if (!this.data) return;
    await atomicWrite(this.sessionJsonPath, this.data);
  }

  /**
   * Reload metrics from disk
   * Reload metrics 来自 disk。
   */
  async reload(): Promise<void> {
    this.data = await readJson<SessionData>(this.sessionJsonPath);
  }
}

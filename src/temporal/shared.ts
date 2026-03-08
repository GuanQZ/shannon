/**
 * 文件说明：
 * 定义 Temporal 工作流共享类型、查询定义与跨模块公共契约。
 * 该文件是工作流、活动与客户端之间的数据协议中心。
 */

import { defineQuery } from '@temporalio/workflow';

// === Types ===
// === 类型 ===。

export interface PipelineInput {
  webUrl: string;
  repoPath: string;
  configPath?: string;
  outputPath?: string;
  pipelineTestingMode?: boolean;
  workflowId?: string; // Added by client, used for audit correlation
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface AgentMetrics {
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  numTurns: number | null;
  model?: string | undefined;
}

export interface PipelineSummary {
  totalCostUsd: number;
  totalDurationMs: number; // Wall-clock time (end - start)
  totalTurns: number;
  agentCount: number;
}

export interface PipelineState {
  status: 'running' | 'completed' | 'failed';
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgent: string | null;
  error: string | null;
  startTime: number;
  agentMetrics: Record<string, AgentMetrics>;
  summary: PipelineSummary | null;
}

// Extended state returned by getProgress query (includes computed fields)
// Extended state returned by getProgress query (includes computed fields)。
export interface PipelineProgress extends PipelineState {
  workflowId: string;
  elapsedMs: number;
}

// Result from a single vuln→exploit pipeline
// 结果 来自 a single vuln→exploit 流水线。
export interface VulnExploitPipelineResult {
  vulnType: string;
  vulnMetrics: AgentMetrics | null;
  exploitMetrics: AgentMetrics | null;
  exploitDecision: {
    shouldExploit: boolean;
    vulnerabilityCount: number;
  } | null;
  error: string | null;
}

// === Queries ===
// === Queries ===。

export const getProgress = defineQuery<PipelineProgress>('getProgress');

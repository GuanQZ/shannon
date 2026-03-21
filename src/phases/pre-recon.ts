// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 实现预侦察阶段业务：执行基础外部扫描、代码预分析并沉淀后续阶段所需上下文。
 * 该文件是整个渗透流水线的第一阶段产物来源。
 */

import { $, fs, path } from 'zx';
import chalk from 'chalk';
import { Timer } from '../utils/metrics.js';
import { formatDuration } from '../utils/formatting.js';
import { handleToolError, PentestError } from '../error-handling.js';
import { AGENTS } from '../session-manager.js';
import { runClaudePromptWithRetry } from '../ai/claude-executor.js';
import { loadPrompt } from '../prompts/prompt-manager.js';
import type { ToolAvailability } from '../tool-checker.js';
import type { DistributedConfig } from '../types/config.js';

interface AgentResult {
  success: boolean;
  duration: number;
  cost?: number | undefined;
  error?: string | undefined;
  retryable?: boolean | undefined;
}

type ToolName = 'nmap' | 'subfinder' | 'whatweb' | 'schemathesis';
type ToolStatus = 'success' | 'skipped' | 'error';

interface TerminalScanResult {
  tool: ToolName;
  output: string;
  status: ToolStatus;
  duration: number;
  success?: boolean;
  error?: Error;
}

interface PromptVariables {
  webUrl: string;
  repoPath: string;
}

// Discriminated union for Wave1 tool results - clearer than loose union types
// 使用可区分联合类型，确保调用侧按 kind 分支处理结果，避免宽泛联合导致的字段误用。
type Wave1ToolResult =
  | { kind: 'scan'; result: TerminalScanResult }
  | { kind: 'skipped'; message: string }
  | { kind: 'agent'; result: AgentResult };

interface Wave1Results {
  nmap: Wave1ToolResult;
  subfinder: Wave1ToolResult;
  whatweb: Wave1ToolResult;
  naabu?: Wave1ToolResult;
  codeAnalysis: AgentResult;
}

interface Wave2Results {
  schemathesis: TerminalScanResult;
}

interface PreReconResult {
  duration: number;
  report: string;
}

// Runs external security tools (nmap, whatweb, etc). Schemathesis requires schemas from code analysis.
// 统一执行外部扫描工具并标准化返回结构。
// - tool: 扫描器名称，便于后续拼接报告。
// - output: 原始输出文本，尽量保留证据细节。
// - status: success/skipped/error，用于流程决策与可视化。
// - duration: 单工具耗时（毫秒）。
async function runTerminalScan(tool: ToolName, target: string, sourceDir: string | null = null): Promise<TerminalScanResult> {
  const timer = new Timer(`command-${tool}`);
  try {
    let result;
    switch (tool) {
      case 'nmap': {
        console.log(chalk.blue(`    🔍 正在执行 ${tool} 扫描...`));
        const nmapHostname = new URL(target).hostname;
        result = await $({ silent: true, stdio: ['ignore', 'pipe', 'ignore'] })`nmap -sV -sC ${nmapHostname}`;
        const duration = timer.stop();
        console.log(chalk.green(`    ✅ ${tool} 扫描完成，耗时 ${formatDuration(duration)}`));
        return { tool: 'nmap', output: result.stdout, status: 'success', duration };
      }
      case 'subfinder': {
        console.log(chalk.blue(`    🔍 正在执行 ${tool} 扫描...`));
        const hostname = new URL(target).hostname;
        result = await $({ silent: true, stdio: ['ignore', 'pipe', 'ignore'] })`subfinder -d ${hostname}`;
        const subfinderDuration = timer.stop();
        console.log(chalk.green(`    ✅ ${tool} 扫描完成，耗时 ${formatDuration(subfinderDuration)}`));
        return { tool: 'subfinder', output: result.stdout, status: 'success', duration: subfinderDuration };
      }
      case 'whatweb': {
        console.log(chalk.blue(`    🔍 正在执行 ${tool} 扫描...`));
        const command = `whatweb --open-timeout 30 --read-timeout 60 ${target}`;
        console.log(chalk.gray(`    命令：${command}`));
        result = await $({ silent: true, stdio: ['ignore', 'pipe', 'ignore'] })`whatweb --open-timeout 30 --read-timeout 60 ${target}`;
        const whatwebDuration = timer.stop();
        console.log(chalk.green(`    ✅ ${tool} 扫描完成，耗时 ${formatDuration(whatwebDuration)}`));
        return { tool: 'whatweb', output: result.stdout, status: 'success', duration: whatwebDuration };
      }
      case 'schemathesis': {
        // Schemathesis depends on code analysis output - skip if no schemas found
        // 该工具依赖 OpenAPI/Schema 文件；若前序未产出 schema，则直接跳过而非报错中断。
        const schemasDir = path.join(sourceDir || '.', 'outputs', 'schemas');
        if (await fs.pathExists(schemasDir)) {
          const schemaFiles = await fs.readdir(schemasDir) as string[];
          const apiSchemas = schemaFiles.filter((f: string) => f.endsWith('.json') || f.endsWith('.yml') || f.endsWith('.yaml'));
          if (apiSchemas.length > 0) {
            console.log(chalk.blue(`    🔍 正在执行 ${tool} 扫描...`));
            const allResults: string[] = [];

            // Run schemathesis on each schema file
            // 逐个 schema 扫描，避免单个文件失败影响整体。
            for (const schemaFile of apiSchemas) {
              const schemaPath = path.join(schemasDir, schemaFile);
              try {
                result = await $({ silent: true, stdio: ['ignore', 'pipe', 'ignore'] })`schemathesis run ${schemaPath} -u ${target} --max-failures=5`;
                allResults.push(`Schema: ${schemaFile}\n${result.stdout}`);
              } catch (schemaError) {
                const err = schemaError as { stdout?: string; message?: string };
                allResults.push(`Schema: ${schemaFile}\nError: ${err.stdout || err.message}`);
              }
            }

            const schemaDuration = timer.stop();
            console.log(chalk.green(`    ✅ ${tool} 扫描完成，耗时 ${formatDuration(schemaDuration)}`));
            return { tool: 'schemathesis', output: allResults.join('\n\n'), status: 'success', duration: schemaDuration };
          } else {
            console.log(chalk.gray(`    ⏭️ ${tool} - 未发现 API schema 文件`));
            return { tool: 'schemathesis', output: '未发现 API schema 文件', status: 'skipped', duration: timer.stop() };
          }
        } else {
          console.log(chalk.gray(`    ⏭️ ${tool} - 未找到 schema 目录`));
          return { tool: 'schemathesis', output: '未找到 schema 目录', status: 'skipped', duration: timer.stop() };
        }
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  } catch (error) {
    const duration = timer.stop();
    console.log(chalk.red(`    ❌ ${tool} 扫描失败，耗时 ${formatDuration(duration)}`));
    return handleToolError(tool, error as Error & { code?: string }) as TerminalScanResult;
  }
}

// Wave 1: Initial footprinting + authentication
// 第一波并行执行”外部探测 + 代码预分析”，快速构建目标基础画像。
// skipCodeAnalysis: 当从 executePreReconPhase 调用时跳过 LLM，因为 runAgentActivity 会单独执行
async function runPreReconWave1(
  webUrl: string,
  sourceDir: string,
  variables: PromptVariables,
  config: DistributedConfig | null,
  pipelineTestingMode: boolean = false,
  sessionId: string | null = null,
  outputPath: string | null = null,
  skipCodeAnalysis: boolean = false
): Promise<Wave1Results> {
  console.log(chalk.blue('    → 正在并行启动第一波任务...'));

  const operations: Promise<TerminalScanResult | AgentResult>[] = [];

  const skippedResult = (message: string): Wave1ToolResult => ({ kind: 'skipped', message });

  // Skip external commands in pipeline testing mode
  // 流水线测试模式仅验证编排链路，不依赖外部扫描工具与网络可达性。
  if (pipelineTestingMode) {
    console.log(chalk.gray('    ⏭️ 当前为流水线测试模式，已跳过外部工具'));
    if (!skipCodeAnalysis) {
      operations.push(
        runClaudePromptWithRetry(
          await loadPrompt('pre-recon-code', variables, null, pipelineTestingMode),
          sourceDir,
          '*',
          '',
          AGENTS['pre-recon'].displayName,
          'pre-recon',  // Agent name for snapshot creation
          chalk.cyan,
          { id: sessionId!, webUrl, repoPath: sourceDir, ...(outputPath && { outputPath }) }  // Session metadata for audit logging (STANDARD: use 'id' field)
        )
      );
    }
    const codeAnalysis = skipCodeAnalysis ? null : await Promise.race(operations).catch(() => null);
    return {
      nmap: skippedResult('已跳过（流水线测试模式）'),
      subfinder: skippedResult('已跳过（流水线测试模式）'),
      whatweb: skippedResult('已跳过（流水线测试模式）'),
      codeAnalysis: codeAnalysis as AgentResult
    };
  } else {
    // Always run the scans
    operations.push(
      runTerminalScan('nmap', webUrl),
      runTerminalScan('subfinder', webUrl),
      runTerminalScan('whatweb', webUrl)
    );

    // Only run code analysis if not skipped
    if (!skipCodeAnalysis) {
      operations.push(
        runClaudePromptWithRetry(
          await loadPrompt('pre-recon-code', variables, null, pipelineTestingMode),
          sourceDir,
          '*',
          '',
          AGENTS['pre-recon'].displayName,
          'pre-recon',  // Agent name for snapshot creation
          chalk.cyan,
          { id: sessionId!, webUrl, repoPath: sourceDir, ...(outputPath && { outputPath }) }  // Session metadata for audit logging (STANDARD: use 'id' field)
        )
      );
    }
  }

  // Check if authentication config is provided for login instructions injection
  // 记录配置状态，便于排查”为何未注入登录指令”问题。
  console.log(chalk.gray(`    → 配置检查：配置${config ? '已提供' : '缺失'}，认证配置${config?.authentication ? '已提供' : '缺失'}`));

  // Wait for all operations to complete
  // If code analysis was skipped, operations only has 3 items (nmap, subfinder, whatweb)
  const results = await Promise.all(operations);
  const nmap = results[0];
  const subfinder = results[1];
  const whatweb = results[2];
  const codeAnalysis = results[3] as AgentResult | undefined;

  return {
    nmap: { kind: 'scan', result: nmap as TerminalScanResult },
    subfinder: { kind: 'scan', result: subfinder as TerminalScanResult },
    whatweb: { kind: 'scan', result: whatweb as TerminalScanResult },
    codeAnalysis: codeAnalysis ?? { success: false, duration: 0 }
  };
}

// Wave 2: Additional scanning
// 第二波补充扫描，依赖第一波产物与本机工具可用性。
async function runPreReconWave2(
  webUrl: string,
  sourceDir: string,
  toolAvailability: ToolAvailability,
  pipelineTestingMode: boolean = false
): Promise<Wave2Results> {
  console.log(chalk.blue('    → 正在并行执行第二波补充扫描...'));

  // Skip external commands in pipeline testing mode
  // 与 Wave1 保持一致，测试模式下不触发外部命令。
  if (pipelineTestingMode) {
    console.log(chalk.gray('    ⏭️ 当前为流水线测试模式，已跳过外部工具'));
    return {
      schemathesis: { tool: 'schemathesis', output: '已跳过（流水线测试模式）', status: 'skipped', duration: 0 }
    };
  }

  const operations: Promise<TerminalScanResult>[] = [];

  // Parallel additional scans (only run if tools are available)
  // 仅对可用工具创建任务，避免无效调用。

  if (toolAvailability.schemathesis) {
    operations.push(runTerminalScan('schemathesis', webUrl, sourceDir));
  }

  // If no tools are available, return early
  // 无可执行任务时快速返回，减少无意义等待。
  if (operations.length === 0) {
    console.log(chalk.gray('    ⏭️ 第二波无可用工具'));
    return {
      schemathesis: { tool: 'schemathesis', output: '工具不可用', status: 'skipped', duration: 0 }
    };
  }

  // Run all operations in parallel
  // 并行执行以缩短阶段总时长。
  const results = await Promise.all(operations);

  // Map results back to named properties
  // 将位置数组结果恢复为具名字段，提升可读性与调用安全。
  const response: Wave2Results = {
    schemathesis: { tool: 'schemathesis', output: '工具不可用', status: 'skipped', duration: 0 }
  };
  let resultIndex = 0;

  if (toolAvailability.schemathesis) {
    response.schemathesis = results[resultIndex++]!;
  } else {
    console.log(chalk.gray('    ⏭️ schemathesis - 工具不可用'));
  }

  return response;
}

// Extracts status and output from a Wave1 tool result
// 将不同 kind 的结果归一化为通用展示结构，便于统一拼接 markdown 报告。
function extractResult(r: Wave1ToolResult | undefined): { status: string; output: string } {
  if (!r) return { status: 'Skipped', output: '无输出' };
  switch (r.kind) {
    case 'scan':
      return { status: r.result.status || 'Skipped', output: r.result.output || '无输出' };
    case 'skipped':
      return { status: 'Skipped', output: r.message };
    case 'agent':
      return { status: r.result.success ? 'success' : 'error', output: '详见智能体输出' };
  }
}

// Combines tool outputs into single deliverable. Falls back to reference if file missing.
// 将 Wave1/Wave2 的异构输出汇总为 `pre_recon_deliverable.md`。
// 当代码分析文件缺失时，保留路径提示以降低阶段失败概率。
async function stitchPreReconOutputs(wave1: Wave1Results, additionalScans: TerminalScanResult[], sourceDir: string): Promise<string> {
  // Try to read the code analysis deliverable file
  // 代码分析是后续阶段的重要上下文，优先内联其内容。
  let codeAnalysisContent = '暂无分析结果';
  try {
    const codeAnalysisPath = path.join(sourceDir, 'deliverables', 'code_analysis_deliverable.md');
    codeAnalysisContent = await fs.readFile(codeAnalysisPath, 'utf8');
  } catch (error) {
    const err = error as Error;
    console.log(chalk.yellow(`⚠️ 读取代码分析交付物失败：${err.message}`));
    codeAnalysisContent = '分析结果位于 deliverables/code_analysis_deliverable.md';
  }

  // Build additional scans section
  // 将补充扫描按工具分段写入，便于审阅与定位证据来源。
  let additionalSection = '';
  if (additionalScans.length > 0) {
    additionalSection = '\n## Authenticated Scans\n';
    for (const scan of additionalScans) {
      additionalSection += `
### ${scan.tool.toUpperCase()}
Status: ${scan.status}
${scan.output}
`;
    }
  }

  const nmap = extractResult(wave1.nmap);
  const subfinder = extractResult(wave1.subfinder);
  const whatweb = extractResult(wave1.whatweb);
  const naabu = extractResult(wave1.naabu);

  const report = `
# Pre-Reconnaissance Report

## Port Discovery (naabu)
Status: ${naabu.status}
${naabu.output}

## Network Scanning (nmap)
Status: ${nmap.status}
${nmap.output}

## Subdomain Discovery (subfinder)
Status: ${subfinder.status}
${subfinder.output}

## Technology Detection (whatweb)
Status: ${whatweb.status}
${whatweb.output}
## Code Analysis
${codeAnalysisContent}
${additionalSection}
---
Report generated at: ${new Date().toISOString()}
  `.trim();

  // Ensure deliverables directory exists in the cloned repo
  // 落盘前确保目录存在，避免因目录缺失造成阶段失败。
  try {
    const deliverablePath = path.join(sourceDir, 'deliverables', 'pre_recon_deliverable.md');
    await fs.ensureDir(path.join(sourceDir, 'deliverables'));

    // Write to file in the cloned repository
    // 将汇总报告写回目标仓库，供后续阶段与最终报告消费。
    await fs.writeFile(deliverablePath, report);
  } catch (error) {
    const err = error as Error;
    throw new PentestError(
      `Failed to write pre-recon report: ${err.message}`,
      'filesystem',
      false,
      { sourceDir, originalError: err.message }
    );
  }

  return report;
}

// Main pre-recon phase execution function
// 预侦察阶段总入口，按“Wave1 -> Wave2 -> 汇总输出”顺序编排。
export async function executePreReconPhase(
  webUrl: string,
  sourceDir: string,
  variables: PromptVariables,
  config: DistributedConfig | null,
  toolAvailability: ToolAvailability,
  pipelineTestingMode: boolean,
  sessionId: string | null = null,
  outputPath: string | null = null
): Promise<PreReconResult> {
  console.log(chalk.yellow.bold('\n🔍 阶段 1：预侦察'));
  const timer = new Timer('phase-1-pre-recon');

  console.log(chalk.yellow('第一波：基础指纹探测...'));
  const wave1Results = await runPreReconWave1(webUrl, sourceDir, variables, config, pipelineTestingMode, sessionId, outputPath, true);
  console.log(chalk.green('  ✅ 第一波任务已完成'));

  console.log(chalk.yellow('第二波：补充扫描...'));
  const wave2Results = await runPreReconWave2(webUrl, sourceDir, toolAvailability, pipelineTestingMode);
  console.log(chalk.green('  ✅ 第二波任务已完成'));

  console.log(chalk.blue('📝 正在汇总预侦察输出...'));
  const additionalScans = wave2Results.schemathesis ? [wave2Results.schemathesis] : [];
  const preReconReport = await stitchPreReconOutputs(wave1Results, additionalScans, sourceDir);
  const duration = timer.stop();

  console.log(chalk.green(`✅ 预侦察阶段完成，总耗时 ${formatDuration(duration)}`));
  console.log(chalk.green(`💾 已保存到 ${sourceDir}/deliverables/pre_recon_deliverable.md`));

  return { duration, report: preReconReport };
}

// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责报告阶段编排：整合各阶段发现、指标与证据，产出最终渗透报告。
 * 该文件将技术结果沉淀为可交付文档，支撑业务复盘与整改。
 */

import { fs, path } from 'zx';
import chalk from 'chalk';
import { PentestError } from '../error-handling.js';

interface DeliverableFile {
  name: string;
  path: string;
  required: boolean;
}

// Pure function: Assemble final report from specialist deliverables
// 按固定顺序读取各专项利用证据并拼接为统一报告。
// `sourceDir` 是目标仓库根目录，函数会在其 `deliverables/` 下读写文件。
export async function assembleFinalReport(sourceDir: string): Promise<string> {
  const deliverableFiles: DeliverableFile[] = [
    { name: 'Injection', path: 'injection_exploitation_evidence.md', required: false },
    { name: 'XSS', path: 'xss_exploitation_evidence.md', required: false },
    { name: 'Authentication', path: 'auth_exploitation_evidence.md', required: false },
    { name: 'SSRF', path: 'ssrf_exploitation_evidence.md', required: false },
    { name: 'Authorization', path: 'authz_exploitation_evidence.md', required: false }
  ];

  const sections: string[] = [];

  for (const file of deliverableFiles) {
    const filePath = path.join(sourceDir, 'deliverables', file.path);
    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf8');
        sections.push(content);
        console.log(chalk.green(`✅ Added ${file.name} findings`));
      } else if (file.required) {
        throw new Error(`Required file ${file.path} not found`);
      } else {
        console.log(chalk.gray(`⏭️  No ${file.name} deliverable found`));
      }
    } catch (error) {
      if (file.required) {
        throw error;
      }
      const err = error as Error;
      console.log(chalk.yellow(`⚠️ Could not read ${file.path}: ${err.message}`));
    }
  }

  const finalContent = sections.join('\n\n');
  const deliverablesDir = path.join(sourceDir, 'deliverables');
  const finalReportPath = path.join(deliverablesDir, 'comprehensive_security_assessment_report.md');

  try {
    // Ensure deliverables directory exists
    // 写入最终报告前创建目录，避免首次运行因目录缺失报错。
    await fs.ensureDir(deliverablesDir);
    await fs.writeFile(finalReportPath, finalContent);
    console.log(chalk.green(`✅ Final report assembled at ${finalReportPath}`));
  } catch (error) {
    const err = error as Error;
    throw new PentestError(
      `Failed to write final report: ${err.message}`,
      'filesystem',
      false,
      { finalReportPath, originalError: err.message }
    );
  }

  return finalContent;
}

/**
 * Inject model information into the final security report.
 * Reads session.json to get the model(s) used, then injects a "Model:" line
 * into the Executive Summary section of the report.
 *
 * 该函数会从审计产物 `session.json` 汇总实际使用过的模型，
 * 并将模型行注入最终报告的执行摘要段落，便于审计和成本复盘。
 */
export async function injectModelIntoReport(
  repoPath: string,
  outputPath: string
): Promise<void> {
  // 1. Read session.json to get model information
  // 从 workflow 输出目录读取指标文件，提取各 agent 使用模型。
  const sessionJsonPath = path.join(outputPath, 'session.json');

  if (!(await fs.pathExists(sessionJsonPath))) {
    console.log(chalk.yellow('⚠️ 未找到 session.json，跳过模型信息注入'));
    return;
  }

  interface SessionData {
    metrics: {
      agents: Record<string, { model?: string }>;
    };
  }

  const sessionData: SessionData = await fs.readJson(sessionJsonPath);

  // 2. Extract unique models from all agents
  // 去重后写入报告，避免同一模型重复展示。
  const models = new Set<string>();
  for (const agent of Object.values(sessionData.metrics.agents)) {
    if (agent.model) {
      models.add(agent.model);
    }
  }

  if (models.size === 0) {
    console.log(chalk.yellow('⚠️ session.json 中未发现模型信息'));
    return;
  }

  const modelStr = Array.from(models).join(', ');
  console.log(chalk.blue(`📝 正在向报告注入模型信息：${modelStr}`));

  // 3. Read the final report
  // 目标文件为汇总后的 `comprehensive_security_assessment_report.md`。
  const reportPath = path.join(repoPath, 'deliverables', 'comprehensive_security_assessment_report.md');

  if (!(await fs.pathExists(reportPath))) {
    console.log(chalk.yellow('⚠️ 未找到最终报告文件，跳过模型信息注入'));
    return;
  }

  let reportContent = await fs.readFile(reportPath, 'utf8');

  // 4. Find and inject model line after assessment date in executive summary.
  // 同时兼容中英文标题与日期字段。
  const assessmentDatePattern = /^(- (Assessment Date|评估日期): .+)$/m;
  const match = reportContent.match(assessmentDatePattern);

  if (match) {
    const modelLine = `- 模型：${modelStr}`;
    reportContent = reportContent.replace(
      assessmentDatePattern,
      `$1\n${modelLine}`
    );
    console.log(chalk.green('✅ 已将模型信息注入执行摘要'));
  } else {
    // If no date line found, try to inject after summary heading.
    const execSummaryPattern = /^## (Executive Summary|执行摘要)$/m;
    if (reportContent.match(execSummaryPattern)) {
      reportContent = reportContent.replace(
        execSummaryPattern,
        (heading: string) => `${heading}\n- 模型：${modelStr}`
      );
      console.log(chalk.green('✅ 已在执行摘要标题后写入模型信息'));
    } else {
      console.log(chalk.yellow('⚠️ 未找到执行摘要章节，跳过模型信息注入'));
      return;
    }
  }

  // 5. Write modified report back
  // 覆盖写回同一路径，保证后续交付使用的是带模型信息的最终版本。
  await fs.writeFile(reportPath, reportContent);
}

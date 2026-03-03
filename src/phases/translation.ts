// src/phases/translation.ts
// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责将渗透测试报告翻译为中文。
 * 在 Reporting 阶段完成后自动执行，翻译所有 .md 报告文件。
 */

import { fs, path } from 'zx';
import chalk from 'chalk';
import { Anthropic } from '@anthropic-ai/sdk';
import { PentestError } from '../error-handling.js';

/**
 * Translation configuration
 * 翻译配置
 */
interface TranslationConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Stage mapping configuration
 * 阶段映射配置
 */
const STAGE_MAPPING: Record<string, string> = {
  'pre_recon': 'pre-recon',
  'recon': 'recon',
  'code_analysis': 'recon',
  'injection_analysis': 'vulnerability',
  'xss_analysis': 'vulnerability',
  'auth_analysis': 'vulnerability',
  'ssrf_analysis': 'vulnerability',
  'authz_analysis': 'vulnerability',
  'injection_exploitation': 'exploitation',
  'xss_exploitation': 'exploitation',
  'auth_exploitation': 'exploitation',
  'ssrf_exploitation': 'exploitation',
  'authz_exploitation': 'exploitation',
  'comprehensive_security_assessment': 'reporting',
};

/**
 * Translation result
 * 翻译结果
 */
export interface TranslateResult {
  success: boolean;
  translatedFiles: string[];
  failedFiles: { path: string; error: string }[];
}

/**
 * Create Anthropic client
 * 创建 Anthropic 客户端
 */
function createAnthropicClient(config: TranslationConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
}

/**
 * Determine stage folder from filename
 * 根据文件名确定阶段文件夹
 */
function getStageFolder(filename: string): string {
  // Check each prefix in order
  for (const [prefix, stage] of Object.entries(STAGE_MAPPING)) {
    if (filename.startsWith(prefix)) {
      return stage;
    }
  }
  // Default to 'other' if no match
  return 'other';
}

/**
 * Translate text to Chinese using Claude API
 * 使用 Claude API 将文本翻译为中文
 */
async function translateText(
  client: Anthropic,
  text: string,
  model: string = 'claude-sonnet-4-5-20250929'
): Promise<string> {
  const translationPrompt = `You are a professional technical translator. Translate the following English penetration testing report to Simplified Chinese.

IMPORTANT RULES:
1. Keep all technical terms in English: SQL injection, XSS, SSRF, CVE, payload, endpoint, HTTP, API, JSON, etc.
2. Keep code blocks, file paths, and URLs unchanged.
3. Keep vulnerability IDs (like INJ-VULN-001) unchanged.
4. Translate narrative content to Chinese.
5. Preserve Markdown formatting.

Translate now:

${text}`;

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: translationPrompt,
      },
    ],
  });

  if (message.content[0].type !== 'text') {
    console.log(chalk.yellow('⚠️ Non-text response received from API, returning original text'));
    return text;
  }

  return message.content[0].text;
}

/**
 * Main translation function
 * 主翻译函数
 */
export async function translateReports(
  repoPath: string,
  config: TranslationConfig
): Promise<TranslateResult> {
  if (!config.apiKey) {
    throw new PentestError('API key is required for translation', 'configuration', false);
  }

  const deliverablesDir = path.join(repoPath, 'deliverables');
  const chineseDir = path.join(deliverablesDir, 'chinese');

  const translatedFiles: string[] = [];
  const failedFiles: { path: string; error: string }[] = [];

  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 5000;

  // Check if deliverables directory exists
  if (!(await fs.pathExists(deliverablesDir))) {
    console.log(chalk.yellow('⚠️ Deliverables directory not found'));
    return { success: true, translatedFiles: [], failedFiles: [] };
  }

  // Create Anthropic client
  const client = createAnthropicClient(config);

  // Read all .md files in deliverables directory
  const files = await fs.readdir(deliverablesDir);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  console.log(chalk.blue(`📝 Found ${mdFiles.length} Markdown files to translate`));

  for (const filename of mdFiles) {
    const sourcePath = path.join(deliverablesDir, filename);
    const stage = getStageFolder(filename);
    const targetDir = path.join(chineseDir, stage);
    const targetPath = path.join(targetDir, filename);

    let retries = 0;
    let success = false;
    let lastError = '';

    while (retries < maxRetries && !success) {
      try {
        // Read source file
        const content = await fs.readFile(sourcePath, 'utf8');

        // Translate content
        const translated = await translateText(client, content, config.model);

        // Ensure target directory exists
        await fs.ensureDir(targetDir);

        // Write translated file
        await fs.writeFile(targetPath, translated);

        console.log(chalk.green(`✅ Translated: ${filename} → chinese/${stage}/`));
        translatedFiles.push(`chinese/${stage}/${filename}`);
        success = true;
      } catch (error) {
        retries++;
        lastError = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow(`⚠️ Retry ${retries}/${maxRetries} for ${filename}: ${lastError}`));
        if (retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (!success) {
      console.log(chalk.red(`❌ Failed to translate: ${filename}`));
      failedFiles.push({ path: filename, error: lastError });
    }
  }

  const successCount = translatedFiles.length;
  const failCount = failedFiles.length;
  console.log(chalk.blue(`📊 Translation complete: ${successCount} success, ${failCount} failed`));

  return {
    success: failCount === 0,
    translatedFiles,
    failedFiles,
  };
}

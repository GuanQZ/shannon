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
import markdownpdf from 'markdown-pdf';
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
 * Get API base URL
 * 获取 API 基础 URL
 */
function getBaseUrl(config: TranslationConfig): string {
  return config.baseUrl || 'https://api.minimaxi.com/anthropic';
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
 * Convert markdown to PDF
 * 将 Markdown 转换为 PDF
 */
async function convertMarkdownToPdf(
  markdownPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    markdownpdf()
      .from(markdownPath)
      .to(outputPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}

/**
 * Translate text to Chinese using Claude API
 * 使用 Claude API 将文本翻译为中文
 */
async function translateText(
  config: TranslationConfig,
  text: string,
  model: string = 'minimax-m2.5'
): Promise<string> {
  // Use the model from config, fallback to minimax-m2.5
  const modelToUse = model || 'minimax-m2.5';
  const baseUrl = getBaseUrl(config);

  const translationPrompt = `You are a professional technical translator. Translate the following English penetration testing report to Simplified Chinese.

IMPORTANT RULES:
1. Keep all technical terms in English: SQL injection, XSS, SSRF, CVE, payload, endpoint, HTTP, API, JSON, etc.
2. Keep code blocks, file paths, and URLs unchanged.
3. Keep vulnerability IDs (like INJ-VULN-001) unchanged.
4. Translate narrative content to Chinese.
5. Preserve Markdown formatting.

Translate now:

${text}`;

  // Use shorter max_tokens and simpler prompt like audit logger
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelToUse,
      max_tokens: 32768,
      system: 'You are a translator. Translate the text to Simplified Chinese ONLY. Output ONLY the translation, no original text, no explanations. Keep technical terms (CVEs, payloads, endpoints, HTTP methods, file paths, code) in English. Do not include any prefix like [agent] or labels.',
      messages: [{ role: 'user', content: text }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation API error: ${response.status} ${errorText}`);
  }

  const result = await response.json() as { content: Array<{ type: string; text: string; thinking?: string }> | undefined };

  if (!result.content || result.content.length === 0) {
    console.log(chalk.yellow('⚠️ Empty response from API, returning original text'));
    return text;
  }

  // MiniMax returns 'thinking' type first, then 'text' type
  // Find the text content (skip thinking type)
  const textContent = result.content.find(c => c.type === 'text');
  const thinkingContent = result.content.find(c => c.type === 'thinking');

  if (textContent?.text) {
    return textContent.text;
  }

  // If no text content, try to extract from thinking
  if (thinkingContent?.thinking) {
    console.log(chalk.gray('🔍 Extracted translation from thinking'));
    return thinkingContent.thinking;
  }

  console.log(chalk.yellow('⚠️ No valid translation found, returning original text'));
  return text;
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
    throw new PentestError('API key is required for translation', 'config', false);
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

  // Read all .md files in deliverables directory
  const files = await fs.readdir(deliverablesDir);
  const mdFiles = files.filter((f: string) => f.endsWith('.md'));

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
        const translated = await translateText(config, content, config.model);

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

  // Generate PDF from translated Chinese reports
  // 从翻译的中文报告生成 PDF
  if (translatedFiles.length > 0) {
    console.log(chalk.blue('📄 Generating PDF from Chinese reports...'));

    // Chinese reports are in deliverables/chinese/
    if (await fs.pathExists(chineseDir)) {
      // Recursively find all .md files in chinese directory
      const findMdFiles = async (dir: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const mdFiles: string[] = [];

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const subFiles = await findMdFiles(fullPath);
            mdFiles.push(...subFiles);
          } else if (entry.name.endsWith('.md')) {
            mdFiles.push(fullPath);
          }
        }

        return mdFiles;
      };

      const mdFiles = await findMdFiles(chineseDir);
      let pdfSuccess = 0;
      let pdfFailed = 0;

      for (const mdPath of mdFiles) {
        const pdfPath = mdPath.replace('.md', '.pdf');

        try {
          await convertMarkdownToPdf(mdPath, pdfPath);
          console.log(chalk.green(`✅ PDF generated: ${path.basename(pdfPath)}`));
          pdfSuccess++;
        } catch (error) {
          console.log(chalk.red(`❌ Failed to generate PDF: ${path.basename(mdPath)}: ${error}`));
          pdfFailed++;
        }
      }

      console.log(chalk.green(`✅ PDF generation complete: ${pdfSuccess} success, ${pdfFailed} failed`));
    } else {
      console.log(chalk.yellow('⚠️ No Chinese directory found, skipping PDF generation'));
    }
  }

  return {
    success: failCount === 0,
    translatedFiles,
    failedFiles,
  };
}

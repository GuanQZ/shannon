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
import { mdToPdf } from 'md-to-pdf';
import { PentestError } from '../error-handling.js';
import { InternalAgentClient, isInternalAgentEnabled } from '../ai/providers/internal-agent.js';

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
 * Fix image paths in translated markdown
 * Chinese reports are in deliverables/chinese/{stage}/ so need ../../ to reach repo root
 *
 * @param content - Markdown content
 * @param targetDir - Target directory path relative to deliverables
 * @returns Content with fixed image paths
 */
function fixImagePaths(content: string, targetDir: string): string {
  // Determine depth from deliverables/chinese/{stage}/ to repo root
  // All Chinese reports are under deliverables/chinese/, so we need to go up 3 levels
  // to reach the repo root where screenshots are stored
  // Path: deliverables/chinese/reporting/ -> ../../../ -> project root

  const depthToRoot = '../../../';

  // Match markdown image syntax: ![alt](path.png)
  // Handle both ./xxx.png and ../xxx.png relative paths
  const imageRegex = /!\[([^\]]*)\]\(\.\.?\/([^)]+\.png)\)/g;

  return content.replace(imageRegex, (match, alt, imagePath) => {
    // Convert relative paths to ../../../image.png for Chinese reports
    return `![${alt}](${depthToRoot}${imagePath})`;
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
 * Convert markdown to PDF
 * 将 Markdown 转换为 PDF
 */
async function convertMarkdownToPdf(
  markdownPath: string,
  outputPath: string
): Promise<void> {
  try {
    // Get the directory of the markdown file for resolving relative image paths
    const markdownDir = path.dirname(markdownPath);

    // Custom CSS for better PDF styling - Typora/GitHub style
    const customCss = `
      :root {
        --bg-color: #ffffff;
        --text-color: #24292e;
        --heading-color: #111111;
        --link-color: #0366d6;
        --code-bg: #f6f8fa;
        --border-color: #e1e4e8;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans CJK SC', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif;
        font-size: 16px;
        line-height: 1.5;
        color: var(--text-color);
        max-width: 900px;
        margin: 0 auto;
        padding: 40px;
      }
      h1, h2, h3, h4, h5, h6 {
        font-weight: 600;
        line-height: 1.25;
        margin-top: 24px;
        margin-bottom: 16px;
        color: var(--heading-color);
      }
      h1 {
        font-size: 2em;
        padding-bottom: 0.3em;
        border-bottom: 1px solid var(--border-color);
      }
      h2 {
        font-size: 1.5em;
        padding-bottom: 0.3em;
        border-bottom: 1px solid var(--border-color);
      }
      h3 { font-size: 1.25em; }
      h4 { font-size: 1em; }
      p { margin-top: 0; margin-bottom: 16px; }
      a { color: var(--link-color); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 85%;
        background-color: var(--code-bg);
        padding: 0.2em 0.4em;
        border-radius: 3px;
      }
      pre {
        padding: 16px;
        overflow: auto;
        font-size: 85%;
        line-height: 1.45;
        background-color: var(--code-bg);
        border-radius: 6px;
        margin-bottom: 16px;
      }
      pre code {
        display: block;
        padding: 0;
        background: none;
        font-size: 100%;
      }
      blockquote {
        padding: 0 1em;
        color: #6a737d;
        border-left: 0.25em solid #dfe2e5;
        margin: 0 0 16px 0;
      }
      ul, ol {
        padding-left: 2em;
        margin-top: 0;
        margin-bottom: 16px;
      }
      li + li { margin-top: 0.25em; }
      table {
        display: table;
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 16px;
      }
      table th, table td {
        padding: 6px 13px;
        border: 1px solid #dfe2e5;
      }
      table th {
        font-weight: 600;
        background-color: #f6f8fa;
      }
      table tr:nth-child(2n) { background-color: #f6f8fa; }
      img {
        max-width: 100%;
        box-sizing: content-box;
        border-radius: 3px;
        margin: 10px 0;
      }
      hr {
        height: 0.25em;
        padding: 0;
        margin: 24px 0;
        background-color: #e1e4e8;
        border: 0;
      }
    `;

    await mdToPdf(
      { path: markdownPath },
      {
        dest: outputPath,
        css: customCss,
        // Use system chromium in container
        launch_options: {
          executablePath: process.env.PDF_EXECUTABLE_PATH || '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ] as any
        }
      }
    ).catch((err) => {
      throw err;
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Translate text to Chinese using Claude API or internal agent
 * 使用 Claude API 或内网 Agent 将文本翻译为中文
 */
async function translateText(
  config: TranslationConfig,
  text: string,
  model?: string
): Promise<string> {
  // Check if internal agent is enabled - if so, use it for translation
  if (isInternalAgentEnabled()) {
    console.log(chalk.gray('  Using internal agent for translation...'));
    const internalAgent = InternalAgentClient.create();

    if (!internalAgent) {
      throw new Error('Failed to create internal agent client');
    }

    try {
      await internalAgent.initSession();

      const translationPrompt = `You are a professional technical translator. Translate the following English penetration testing report to Simplified Chinese.

IMPORTANT RULES:
1. Keep all technical terms in English: SQL injection, XSS, SSRF, CVE, payload, endpoint, HTTP, API, JSON, etc.
2. Keep code blocks, file paths, and URLs unchanged.
3. Keep vulnerability IDs (like INJ-VULN-001) unchanged.
4. Translate narrative content to Chinese.
5. Preserve Markdown formatting.

Translate now:

${text}`;

      // Note: internalAgent.chat() throws on error, so we don't need to check success
      const chatResponse = await internalAgent.chat(translationPrompt);
      return chatResponse.result;
    } catch (error) {
      console.error('Internal agent translation error:', error);
      throw error;
    }
  }

  // Fall back to direct API call
  // Use the model from parameter, then config, then environment, then fallback
  const modelToUse = model || config.model || 'minimax-m2.5';
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
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelToUse,
        max_tokens: 8192,
        system: 'You are a translator. Translate the text to Simplified Chinese ONLY. Output ONLY the translation, no original text, no explanations. Keep technical terms (CVEs, payloads, endpoints, HTTP methods, file paths, code) in English. Do not include any prefix like [agent] or labels.',
        messages: [{ role: 'user', content: text }]
      })
    });
  } catch (fetchError) {
    console.error('Fetch error details:', fetchError);
    throw fetchError;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Translation API error:', response.status, errorText);
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

        // Fix image paths: Chinese reports are in deliverables/chinese/{stage}/
        // so need ../../ to reach repo root where screenshots are stored
        const fixedContent = fixImagePaths(translated, targetDir);

        // Ensure target directory exists
        await fs.ensureDir(targetDir);

        // Write translated file
        await fs.writeFile(targetPath, fixedContent);

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

      // Copy images to markdown directory before PDF generation
      // Puppeteer can't resolve ../../../ paths correctly, so we copy images to same directory
      const copyImagesForPdf = async (mdPath: string): Promise<void> => {
        const mdDir = path.dirname(mdPath);
        let content = await fs.readFile(mdPath, 'utf8');

        // Find all image references with relative paths (../ or ../../ etc.)
        const imageRegex = /!\[([^\]]*)\]\(([^)]+\.png)\)/g;
        let match;
        const imagesCopied = new Set<string>();

        while ((match = imageRegex.exec(content)) !== null) {
          const imagePath = match[2];
          // Match any path containing ../ (single or multi-level relative paths)
          if (imagePath && imagePath.includes('../') && !imagesCopied.has(imagePath)) {
            imagesCopied.add(imagePath);
            const absImagePath = path.resolve(mdDir, imagePath);
            const imageFileName = path.basename(absImagePath);
            const targetPath = path.join(mdDir, imageFileName);

            // Copy image to markdown directory
            if (await fs.pathExists(absImagePath) && !(await fs.pathExists(targetPath))) {
              await fs.copyFile(absImagePath, targetPath);
              console.log(chalk.gray(`  📷 Copied image for PDF: ${imageFileName}`));
            }

            // Replace relative path with just filename in markdown content
            // This ensures Puppeteer can find the image in the same directory
            content = content.replace(imagePath, imageFileName);
          }
        }

        // Write updated markdown with local image paths
        await fs.writeFile(mdPath, content, 'utf8');
      };

      for (const mdPath of mdFiles) {
        const pdfPath = mdPath.replace('.md', '.pdf');

        try {
          // Copy images before converting to PDF
          await copyImagesForPdf(mdPath);
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

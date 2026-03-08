# Report Translation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After the Reporting phase completes, automatically translate all English reports to Chinese and store them in stage-specific subdirectories under a `chinese/` folder.

**Architecture:** Add a new Translation Activity that runs after Reporting. The activity scans `deliverables/` for `.md` files, translates them using Claude API, and writes to `chinese/{stage}/{filename}`. Translation failures are retried 3 times but don't block the workflow.

**Tech Stack:** TypeScript, Temporal Activities, Claude API (existing ANTHROPIC_API_KEY), Node.js fs/zx

---

## Task 1: Create Translation Activity Implementation

**Files:**
- Create: `src/phases/translation.ts`

**Step 1: Create the translation module**

```typescript
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

  return message.content[0].type === 'text'
    ? message.content[0].text
    : text;
}

/**
 * Main translation function
 * 主翻译函数
 */
export async function translateReports(
  repoPath: string,
  config: TranslationConfig
): Promise<TranslateResult> {
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
```

**Step 2: Verify the file compiles**

Run: `npx tsc src/phases/translation.ts --noEmit --esModuleInterop --moduleResolution node --target ES2022 --module CommonJS`

Expected: No errors

**Step 3: Commit**

```bash
git add src/phases/translation.ts
git commit -m "feat: add translation module for reports"
```

---

## Task 2: Register Translation Activity in activities.ts

**Files:**
- Modify: `src/temporal/activities.ts`

**Step 1: Add import for translation function**

Add after line 94:
```typescript
import { translateReports } from '../phases/translation.js';
```

**Step 2: Add TranslationActivityInput interface**

Add after line 124:
```typescript
export interface TranslationActivityInput {
  repoPath: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}
```

**Step 3: Add translateReportsActivity function**

Add after line 482 (after `injectReportMetadataActivity`):

```typescript
/**
 * Translate all reports to Chinese after Reporting phase.
 * 报告阶段完成后翻译所有报告为中文。
 *
 * This is a non-critical enhancement - failures don't block workflow completion.
 * 这是增强功能，失败不会阻塞工作流完成。
 */
export async function translateReportsActivity(
  input: TranslationActivityInput
): Promise<void> {
  const { repoPath, apiKey, baseUrl, model } = input;

  console.log(chalk.blue('🔄 Starting report translation to Chinese...'));

  try {
    const result = await translateReports(repoPath, {
      apiKey,
      baseUrl,
      model,
    });

    if (result.success) {
      console.log(chalk.green(`✅ All ${result.translatedFiles.length} reports translated successfully`));
    } else {
      console.log(chalk.yellow(`⚠️ Translation completed with ${result.failedFiles.length} failures`));
      for (const failure of result.failedFiles) {
        console.log(chalk.yellow(`  - ${failure.path}: ${failure.error}`));
      }
    }
  } catch (error) {
    const err = error as Error;
    console.log(chalk.yellow(`⚠️ Translation activity error: ${err.message}`));
    // Don't throw - this is a non-critical enhancement
  }
}
```

**Step 4: Verify the code compiles**

Run: `npx tsc --noEmit`

Expected: No errors

**Step 5: Commit**

```bash
git add src/temporal/activities.ts
git commit -m "feat: register translateReportsActivity in Temporal activities"
```

---

## Task 3: Integrate Translation Activity into Workflow

**Files:**
- Modify: `src/temporal/workflows.ts`

**Step 1: Add import for translateReportsActivity**

Find line 94 (import from activities) and add:

```typescript
import {
  // ... existing imports
  translateReportsActivity,
} from './activities.js';
```

**Step 2: Add translation step after Reporting phase**

Find the section after line 348 (`await a.injectReportMetadataActivity(activityInput);`) and before line 350 (`await a.logPhaseTransition(activityInput, 'reporting', 'complete');`):

Add:
```typescript
    // Translate all reports to Chinese
    // 翻译所有报告为中文
    try {
      await a.translateReportsActivity({
        repoPath: activityInput.repoPath,
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      });
    } catch (error) {
      // Non-critical - don't fail the workflow
      const err = error as Error;
      console.log(chalk.yellow(`⚠️ Translation failed: ${err.message}`));
    }
```

**Step 3: Verify the code compiles**

Run: `npx tsc --noEmit`

Expected: No errors

**Step 4: Commit**

```bash
git add src/temporal/workflows.ts
git commit -m "feat: integrate translation activity after reporting phase"
```

---

## Task 4: Test Translation Functionality

**Files:**
- Test: Run with existing benchmark data

**Step 1: Test with sample reports**

```bash
# This requires a completed penetration test session
# You can test with any existing session in xben-benchmark-results/

# Check if deliverables directory exists in a test repo
ls repos/smoke-repo/deliverables/
```

**Step 2: Run a quick test (manual verification)**

The translation will run automatically at the end of a penetration test. To verify:

1. Run a complete penetration test: `./shannon start URL=http://localhost:8000 REPO=smoke-repo`
2. After completion, check: `repos/smoke-repo/deliverables/chinese/`
3. Verify files exist in correct stage subdirectories

**Step 3: Commit test results**

```bash
git add docs/
git commit -m "docs: document translation feature"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | Create `src/phases/translation.ts` | Translation module with Claude API integration |
| 2 | Modify `src/temporal/activities.ts` | Register translateReportsActivity |
| 3 | Modify `src/temporal/workflows.ts` | Call translation after Reporting |
| 4 | Test | Manual verification with real data |

**Total: 4 tasks**

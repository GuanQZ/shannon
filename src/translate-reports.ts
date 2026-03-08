#!/usr/bin/env node
/**
 * Standalone script to translate reports without running the full workflow
 * 独立脚本：仅翻译报告，不运行完整工作流
 */

import { translateReports } from './phases/translation.js';
import * as dotenv from 'dotenv';

// Translation config type (matches translation.ts)
interface TranslationConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const repoPath = process.argv[2] || path.join(__dirname, 'repos/bwapp');

console.log(`📂 Translating reports for: ${repoPath}`);

const config: TranslationConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic',
  model: process.env.ANTHROPIC_MODEL || 'minimax-m2.5',
  maxRetries: 3,
  retryDelayMs: 5000,
};

if (!config.apiKey) {
  console.error('❌ ANTHROPIC_API_KEY is required');
  process.exit(1);
}

try {
  const result = await translateReports(repoPath, config);

  if (result.success) {
    console.log(`✅ Successfully translated ${result.translatedFiles.length} files`);
    for (const file of result.translatedFiles) {
      console.log(`   - ${file}`);
    }
  } else {
    console.log(`⚠️ Translation completed with ${result.failedFiles.length} failures`);
    for (const failure of result.failedFiles) {
      console.log(`   - ${failure.path}: ${failure.error}`);
    }
  }
} catch (error) {
  console.error('❌ Translation failed:', error);
  process.exit(1);
}

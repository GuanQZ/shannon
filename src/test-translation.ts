#!/usr/bin/env node
/**
 * Test translateReports function directly (without Temporal)
 */

import { translateReports } from './phases/translation.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const repoPath = process.argv[2] || path.join(__dirname, 'repos/bwapp');

console.log(`🧪 Testing translateReports for: ${repoPath}`);

try {
  const result = await translateReports(repoPath, {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: 'minimax-m2.5',
  });

  console.log('✅ Translation test complete');
  console.log(`   Success: ${result.translatedFiles.length} files`);
  console.log(`   Failed: ${result.failedFiles.length} files`);
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Test translateReportsActivity directly
 */

import { translateReportsActivity } from './temporal/activities.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const repoPath = process.argv[2] || path.join(__dirname, 'repos/bwapp');

console.log(`🧪 Testing translateReportsActivity for: ${repoPath}`);

// Call the activity directly
await translateReportsActivity({
  repoPath,
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'minimax-m2.5',
});

console.log('✅ Activity test complete');

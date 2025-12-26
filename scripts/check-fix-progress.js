#!/usr/bin/env node
/**
 * Check progress of the BaT listing fix script
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = path.join(__dirname, '../data/fix-progress.log');
const errorsPath = path.join(__dirname, '../data/fix-errors.json');

console.log('📊 BaT Listing Fix Progress\n');

if (fs.existsSync(logPath)) {
  const log = fs.readFileSync(logPath, 'utf-8');
  const lines = log.split('\n');
  
  // Count fixes
  const fixed = (log.match(/✅ Fixed/g) || []).length;
  const failed = (log.match(/❌ Failed/g) || []).length;
  const batches = (log.match(/📦 Processing batch/g) || []).length;
  
  console.log(`Batches processed: ${batches}`);
  console.log(`✅ Fixed: ${fixed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`\nLast 20 lines:\n`);
  console.log(lines.slice(-20).join('\n'));
} else {
  console.log('No progress log found. Script may not be running.');
}

if (fs.existsSync(errorsPath)) {
  const errors = JSON.parse(fs.readFileSync(errorsPath, 'utf-8'));
  console.log(`\n❌ Total errors so far: ${errors.length}`);
}


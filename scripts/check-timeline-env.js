#!/usr/bin/env node
/**
 * Check Timeline Environment Configuration
 * 
 * This script verifies that all necessary environment variables are properly
 * configured for the Vehicle Timeline testing process.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

console.log(`${YELLOW}Timeline Environment Configuration Check${RESET}`);
console.log('=====================================');

// Load environment variables from all possible sources
// (following Nuke's fallback pattern)
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env.test') });

// Check required env vars
const requiredVars = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_SERVICE_KEY'
];

const missingVars = [];
let allVarsAvailable = true;

console.log('\nEnvironment Variables Status:');
requiredVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`${GREEN}✓ ${varName}${RESET}: Available`);
  } else {
    console.log(`${RED}✗ ${varName}${RESET}: Missing`);
    missingVars.push(varName);
    allVarsAvailable = false;
  }
});

// Check if env.test exists
const envTestPath = path.join(rootDir, '.env.test');
const envTestExists = fs.existsSync(envTestPath);

console.log('\nConfiguration Files:');
if (envTestExists) {
  console.log(`${GREEN}✓ .env.test${RESET}: Exists`);
} else {
  console.log(`${RED}✗ .env.test${RESET}: Missing`);
}

// Check migration file
const migrationPath = path.join(rootDir, 'migrations', 'vehicle_timeline.sql');
const migrationExists = fs.existsSync(migrationPath);

if (migrationExists) {
  console.log(`${GREEN}✓ migrations/vehicle_timeline.sql${RESET}: Exists`);
} else {
  console.log(`${RED}✗ migrations/vehicle_timeline.sql${RESET}: Missing`);
}

console.log('\nSummary:');
if (allVarsAvailable && envTestExists && migrationExists) {
  console.log(`${GREEN}All environment variables and files are properly configured for timeline testing.${RESET}`);
  console.log(`${GREEN}You can now run: npm run test:timeline${RESET}`);
} else {
  console.log(`${RED}Some configuration is missing for timeline testing.${RESET}`);
  
  if (!envTestExists) {
    console.log(`${YELLOW}Please create .env.test from .env.test.template${RESET}`);
  }
  
  if (missingVars.length > 0) {
    console.log(`${YELLOW}Please add the following environment variables to .env.test:${RESET}`);
    missingVars.forEach(varName => {
      console.log(`  - ${varName}`);
    });
  }
  
  if (!migrationExists) {
    console.log(`${YELLOW}Please create the migrations/vehicle_timeline.sql file${RESET}`);
  }
}

console.log('\nNext steps:');
if (!allVarsAvailable) {
  console.log(`1. Edit .env.test to add required Supabase credentials`);
}
console.log(`${missingVars.length > 0 ? '2' : '1'}. Run: node scripts/run-timeline-migration.js`);
console.log(`${missingVars.length > 0 ? '3' : '2'}. Run: npm run test:timeline`);

#!/usr/bin/env node
/**
 * Documentation Verification Script
 * 
 * This script verifies that all required documentation files exist
 * and are organized according to our prioritized hierarchy.
 */

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

console.log(`${YELLOW}Nuke Documentation Verification${RESET}`);
console.log('===============================');

// Documentation files in order of importance
const requiredDocs = [
  { path: 'ARCHITECTURE.md', importance: 1 },
  { path: 'docs/EXECUTIVE_SUMMARY.md', importance: 2 },
  { path: 'docs/TECHNICAL.md', importance: 3 },
  { path: 'docs/FOUNDER_QA.md', importance: 4 },
  { path: 'docs/AGENTS.md', importance: 5 },
  { path: 'docs/FEATURES.md', importance: 6 },
  { path: 'docs/DEVELOPER_GUIDE.md', importance: 7 },
  { path: 'docs/REAL_DATA_MIGRATION.md', importance: 8 },
  { path: 'docs/STUDIO.md', importance: 9 },
  { path: 'docs/MARKET_POSITIONING.md', importance: 10 },
  { path: 'docs/PREDICTIVE_STAKING.md', importance: 11 },
  { path: 'docs/BRAND_NARRATIVE.md', importance: 12 },
  { path: 'docs/BUSINESS_OPS.md', importance: 13 },
  { path: 'docs/BEST_PRACTICES.md', importance: 14 },
  { path: 'docs/MEDIA_PRODUCTION.md', importance: 15 },
  { path: 'docs/DOCKER.md', importance: 16 },
  { path: 'docs/AGENT_USAGE.md', importance: 17 },
  { path: 'docs/ownership-components.md', importance: 18 },
  { path: 'docs/CONTRIBUTING.md', importance: 19 },
  { path: 'docs/GETTING_STARTED.md', importance: 20 },
  { path: 'TIMELINE_TESTING.md', importance: 21 },
  { path: 'docs/INDEX.md', importance: 0 }
];

// Verify documentation files exist
console.log(`${YELLOW}Checking for required documentation files...${RESET}`);

const missingDocs = [];
const existingDocs = [];

for (const doc of requiredDocs) {
  const docPath = path.join(rootDir, doc.path);
  
  if (fs.existsSync(docPath)) {
    existingDocs.push(doc);
    console.log(`${GREEN}✓ Found:${RESET} ${doc.path} (Importance: ${doc.importance})`);
  } else {
    missingDocs.push(doc);
    console.log(`${RED}✗ Missing:${RESET} ${doc.path} (Importance: ${doc.importance})`);
  }
}

// Summary
console.log('\nDocumentation Summary:');
console.log(`${GREEN}${existingDocs.length}${RESET} of ${requiredDocs.length} documentation files found`);

if (missingDocs.length > 0) {
  console.log(`${RED}${missingDocs.length}${RESET} documentation files missing`);
  console.log('\nMissing documentation:');
  missingDocs.forEach(doc => {
    console.log(`${RED}- ${doc.path}${RESET} (Importance: ${doc.importance})`);
  });
}

// Check if INDEX.md exists
const indexPath = path.join(rootDir, 'docs/INDEX.md');
if (fs.existsSync(indexPath)) {
  console.log(`\n${GREEN}✓ Documentation index exists!${RESET}`);
} else {
  console.log(`\n${RED}✗ Documentation index missing!${RESET}`);
  console.log(`${YELLOW}Please create docs/INDEX.md to organize documentation by importance.${RESET}`);
}

// Result
if (missingDocs.length === 0) {
  console.log(`\n${GREEN}All documentation is complete!${RESET}`);
  process.exit(0);
} else {
  console.log(`\n${YELLOW}Some documentation files are missing. Please add these files to complete the documentation.${RESET}`);
  process.exit(1);
}

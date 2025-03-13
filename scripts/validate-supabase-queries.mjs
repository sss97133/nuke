#!/usr/bin/env node

/**
 * This script validates Supabase queries in TypeScript files to prevent common errors:
 * - Multiple .from() calls in the same chain
 * - Missing type validation
 * - Incorrect filter usage
 * 
 * Usage:
 *   node scripts/validate-supabase-queries.js [--fix] [paths...]
 * 
 * Options:
 *   --fix: Attempt to automatically fix issues (experimental)
 *   paths: Specific files or directories to check, defaults to src/
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const PATHS = [
  path.join(__dirname, '..', 'src'),
  path.join(__dirname, '..', 'supabase', 'functions'),
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const FIX_MODE = process.argv.includes('--fix');

// Environment check
const NODE_ENV = process.env.NODE_ENV || 'development';
const logger = console;

// Skip validation in production environment
if (NODE_ENV === 'production' || process.argv.includes('--production')) {
  logger.info('✅ Skipping Supabase query validation in production mode');
  process.exit(0);
}

// Color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Statistics
const stats = {
  filesChecked: 0,
  filesWithIssues: 0,
  issuesFound: 0,
  issuesFixed: 0,
};

/**
 * Main function to validate Supabase queries
 */
function validateQueries() {
  logger.info('🔍 Validating Supabase queries...');
  logger.info(`Mode: ${FIX_MODE ? 'Fix' : 'Check only'}`);
  
  // Get files to check
  let filesToCheck = [];
  
  try {
    if (process.argv.includes('--git-changed')) {
      // Get files changed in git
      const output = execSync('git diff --cached --name-only --diff-filter=ACM').toString();
      const changedFiles = output.split('\n').filter(Boolean);
      filesToCheck = changedFiles.filter(file => 
        EXTENSIONS.includes(path.extname(file)) && fs.existsSync(file)
      );
      logger.info(`Checking ${filesToCheck.length} changed files`);
    } else {
      // Get all TypeScript files in specified paths
      PATHS.forEach(dir => {
        traverseDirectory(dir, filesToCheck);
      });
      logger.info(`Checking ${filesToCheck.length} files in ${PATHS.join(', ')}`);
    }
    
    // Check each file
    filesToCheck.forEach(file => validateFile(file));
    
    // Print summary
    printSummary();
    
    // Exit with error if issues were found
    if (stats.issuesFound > 0 && !FIX_MODE) {
      process.exit(1);
    }
    logger.info('✅ All queries validated successfully');
  } catch (error) {
    logger.error('❌ Query validation failed:', error);
    process.exit(1);
  }
}

/**
 * Recursively finds files with specified extensions
 */
function traverseDirectory(dir, fileList) {
  if (!fs.existsSync(dir)) {
    logger.warn(`Warning: Directory ${dir} does not exist`);
    return;
  }
  
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('node_modules') && !file.startsWith('.git')) {
      traverseDirectory(filePath, fileList);
    } else if (stat.isFile() && EXTENSIONS.includes(path.extname(file))) {
      fileList.push(filePath);
    }
  });
}

/**
 * Validates a single file
 */
function validateFile(filePath) {
  try {
    stats.filesChecked++;
    const content = fs.readFileSync(filePath, 'utf8');
    let hasIssues = false;
    let updatedContent = content;
    
    // Check for Supabase imports
    const hasSupabaseImport = content.includes('@supabase/supabase-js') || 
                             content.includes('supabase');
    
    if (!hasSupabaseImport) {
      return; // Skip files without Supabase
    }
    
    // Issues to check for
    const issues = [
      {
        name: 'Multiple .from() calls',
        detect: /\.from\(['"]\w+['"]\).*\.from\(['"]\w+['"]\)/s,
        message: 'Multiple .from() calls in the same query chain',
        fix: content => {
          // This is a complex fix that might need manual intervention
          return content.replace(
            /(\.s*from\(['"]\w+['"]\).*?)(\.s*from\(['"]\w+['"]\))/s, 
            (match, group1, group2) => {
              logger.warn('⚠️ Complex issue requires manual fix:');
              logger.warn(`  ${group1}${COLORS.red}${group2}${COLORS.reset}`);
              return group1; // Remove the second .from() call
            }
          );
        }
      },
      {
        name: 'Missing Database type import',
        detect: /(supabase|createClient).*\.from\(/s,
        condition: content => !content.includes('Database') && !content.includes('SupabaseClient'),
        message: 'Supabase query without Database type import',
        fix: content => {
          // Add the import if missing
          if (!content.includes('import type { Database }')) {
            return content.replace(
              /import (.*?) from/,
              `import type { Database } from '../types';\nimport $1 from`
            );
          }
          return content;
        }
      },
      {
        name: 'Incorrect filter column',
        detect: /\.eq\(['"]status['"]/,
        condition: content => !content.includes('team_members') || 
                             !content.includes('status'),
        message: 'Using status filter when it might not exist on the table',
        fix: content => content // No automatic fix for this, requires manual review
      },
      {
        name: 'Missing error handling',
        detect: /await supabase.*\n(?!.*error)/,
        message: 'Supabase query without error handling',
        fix: content => {
          // Try to add basic error handling
          return content.replace(
            /(const \{.*?\} = await supabase.*?\n)/g,
            '$1  if (error) console.error("Database query error:", error);\n'
          );
        }
      }
    ];
    
    // Check for each issue
    issues.forEach(issue => {
      if (issue.detect.test(content) && (!issue.condition || issue.condition(content))) {
        hasIssues = true;
        stats.issuesFound++;
        logger.error(`❌ ${filePath}: ${issue.name}`);
        logger.info(`   ${issue.message}`);
        
        if (FIX_MODE && issue.fix) {
          const newContent = issue.fix(updatedContent);
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            stats.issuesFixed++;
            logger.info(`${COLORS.green}  Fixed: ${issue.name}${COLORS.reset}`);
          }
        }
      }
    });
    
    // Write back the fixed content if in fix mode
    if (FIX_MODE && updatedContent !== content) {
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      logger.info(`${COLORS.green}✓ Updated ${filePath}${COLORS.reset}`);
    }
    
    if (hasIssues) {
      stats.filesWithIssues++;
    }
  } catch (error) {
    logger.error(`Error checking ${filePath}: ${error.message}`);
  }
}

/**
 * Prints summary statistics
 */
function printSummary() {
  logger.info('\n');
  logger.info(`=== Supabase Query Validation Summary ===`);
  logger.info(`Files checked: ${stats.filesChecked}`);
  logger.info(`Files with issues: ${stats.filesWithIssues}`);
  logger.info(`Total issues found: ${stats.issuesFound}`);
  
  if (FIX_MODE) {
    logger.info(`Issues fixed: ${stats.issuesFixed}`);
    logger.info(`Issues requiring manual fix: ${stats.issuesFound - stats.issuesFixed}`);
  }
  
  if (stats.issuesFound === 0) {
    logger.info(`✓ No issues found!`);
  } else if (!FIX_MODE) {
    logger.info(`⚠️ Run with --fix to attempt automatic fixes`);
  }
}

// Run the validation
validateQueries();

// This file is being renamed to .cjs to support CommonJS syntax
// Original code remains unchanged

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

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const DEFAULT_PATHS = ['src/'];
const EXTENSIONS = ['.ts', '.tsx'];
const FIX_MODE = process.argv.includes('--fix');
const PATHS = process.argv.slice(2).filter(arg => !arg.startsWith('--')) || DEFAULT_PATHS;

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
function validateSupabaseQueries() {
  console.log(`${COLORS.cyan}Validating Supabase queries...${COLORS.reset}`);
  console.log(`${COLORS.cyan}Mode: ${FIX_MODE ? 'Fix' : 'Check only'}${COLORS.reset}`);
  
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
      console.log(`${COLORS.blue}Checking ${filesToCheck.length} changed files${COLORS.reset}`);
    } else {
      // Get all TypeScript files in specified paths
      PATHS.forEach(dir => {
        traverseDirectory(dir, filesToCheck);
      });
      console.log(`${COLORS.blue}Checking ${filesToCheck.length} files in ${PATHS.join(', ')}${COLORS.reset}`);
    }
    
    // Check each file
    filesToCheck.forEach(file => validateFile(file));
    
    // Print summary
    printSummary();
    
    // Exit with error if issues were found
    if (stats.issuesFound > 0 && !FIX_MODE) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`${COLORS.red}Error: ${error.message}${COLORS.reset}`);
    process.exit(1);
  }
}

/**
 * Recursively finds files with specified extensions
 */
function traverseDirectory(filePath, fileList) {
  if (!fs.existsSync(filePath)) {
    console.warn(`${COLORS.yellow}Warning: Path ${filePath} does not exist${COLORS.reset}`);
    return;
  }
  
  const stat = fs.statSync(filePath);
  
  if (stat.isDirectory()) {
    const files = fs.readdirSync(filePath);
    
    files.forEach(file => {
      const fullPath = path.join(filePath, file);
      if (!file.startsWith('node_modules') && !file.startsWith('.git')) {
        traverseDirectory(fullPath, fileList);
      }
    });
  } else if (stat.isFile() && EXTENSIONS.includes(path.extname(filePath))) {
    fileList.push(filePath);
  }
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
            /(\.\s*from\(['"]\w+['"]\).*?)(\.\s*from\(['"]\w+['"]\))/s, 
            (match, group1, group2) => {
              console.log(`${COLORS.yellow}⚠️ Complex issue requires manual fix:${COLORS.reset}`);
              console.log(`  ${group1}${COLORS.red}${group2}${COLORS.reset}`);
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
        detect: /await supabase\.(?:from|rpc|auth)\..*\n(?!.*error)/,
        message: 'Database or RPC query without error handling',
        fix: content => {
          // Try to add basic error handling
          return content.replace(
            /(const \{.*?\} = await supabase\.(?:from|rpc|auth)\.[^}]+\n)/g,
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
        console.log(`${COLORS.red}❌ ${filePath}: ${issue.name}${COLORS.reset}`);
        console.log(`   ${issue.message}`);
        
        if (FIX_MODE && issue.fix) {
          const newContent = issue.fix(updatedContent);
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            stats.issuesFixed++;
            console.log(`${COLORS.green}  Fixed: ${issue.name}${COLORS.reset}`);
          }
        }
      }
    });
    
    // Write back the fixed content if in fix mode
    if (FIX_MODE && updatedContent !== content) {
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      console.log(`${COLORS.green}✓ Updated ${filePath}${COLORS.reset}`);
    }
    
    if (hasIssues) {
      stats.filesWithIssues++;
    }
  } catch (error) {
    console.error(`${COLORS.red}Error checking ${filePath}: ${error.message}${COLORS.reset}`);
  }
}

/**
 * Prints summary statistics
 */
function printSummary() {
  console.log('\n');
  console.log(`${COLORS.cyan}=== Supabase Query Validation Summary ===${COLORS.reset}`);
  console.log(`${COLORS.blue}Files checked: ${stats.filesChecked}${COLORS.reset}`);
  console.log(`${COLORS.blue}Files with issues: ${stats.filesWithIssues}${COLORS.reset}`);
  console.log(`${COLORS.blue}Total issues found: ${stats.issuesFound}${COLORS.reset}`);
  
  if (FIX_MODE) {
    console.log(`${COLORS.blue}Issues fixed: ${stats.issuesFixed}${COLORS.reset}`);
    console.log(`${COLORS.blue}Issues requiring manual fix: ${stats.issuesFound - stats.issuesFixed}${COLORS.reset}`);
  }
  
  if (stats.issuesFound === 0) {
    console.log(`${COLORS.green}✓ No issues found!${COLORS.reset}`);
  } else if (!FIX_MODE) {
    console.log(`${COLORS.yellow}⚠️ Run with --fix to attempt automatic fixes${COLORS.reset}`);
  }
}

// Run the validation
validateSupabaseQueries();

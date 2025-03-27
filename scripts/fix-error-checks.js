#!/usr/bin/env node

/**
 * This script automatically fixes misplaced error checks in Supabase query chains
 * throughout the codebase. It scans for the pattern:
 * 
 * const { ... } = await supabase
 * if (error) console.error("Database query error:", error);
 * .from(...)
 * 
 * And fixes it by removing the misplaced error check.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Get the list of files with potential issues
const findCommand = 'find /Users/skylar/nuke/src -type f -name "*.tsx" -o -name "*.ts" | xargs grep -l "if (error) console.error" 2>/dev/null';
const filePaths = execSync(findCommand).toString().trim().split('\n');

console.log(`Found ${filePaths.length} files with potential issues.`);

// Counter for tracking changes
let filesFixed = 0;
let totalIssuesFixed = 0;

// Patterns to look for
const patterns = [
  {
    // Pattern 1: Misplaced error check after await supabase before method chain
    regex: /(const\s+\{[^}]*error[^}]*\}\s*=\s*await\s+supabase)\s*\n\s*(if\s*\(\s*error\s*\)\s*console\.error\([^)]*\);\s*)\n\s*(\.\s*from)/g,
    replacement: '$1\n        $3'
  },
  {
    // Pattern 2: Misplaced error check in the middle of a function call's parameters
    regex: /(=\s*await\s+supabase(?:\.(?:[a-zA-Z0-9_]+))*\.[a-zA-Z0-9_]+\(\{)\s*\n\s*(if\s*\(\s*error\s*\)\s*console\.error\([^)]*\);\s*)\n\s*/g,
    replacement: '$1\n        '
  }
];

// Process each file
filePaths.forEach(filePath => {
  try {
    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;
    let fileIssuesFixed = 0;
    
    // Apply all patterns
    patterns.forEach(pattern => {
      const matches = newContent.match(pattern.regex) || [];
      fileIssuesFixed += matches.length;
      newContent = newContent.replace(pattern.regex, pattern.replacement);
    });
    
    // Write back if changes were made
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      filesFixed++;
      totalIssuesFixed += fileIssuesFixed;
      console.log(`Fixed ${fileIssuesFixed} issues in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
});

console.log(`\nSummary: Fixed ${totalIssuesFixed} issues across ${filesFixed} files.`);

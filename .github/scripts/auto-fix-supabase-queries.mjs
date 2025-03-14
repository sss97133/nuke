#!/usr/bin/env node

/**
 * Auto-Fix Supabase Query Patterns Script for Vehicle-Centric Architecture
 * 
 * This script systematically fixes common Supabase query issues including:
 * 1. Multiple .from() calls in the same query chain
 * 2. Missing error handling in Supabase queries
 * 3. Incorrect filter columns in vehicle data queries
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Support ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File patterns to focus on
const VEHICLE_DATA_PATTERNS = [
  'src/components/VehicleTimeline/**/*.{ts,tsx,js,jsx}',
  'src/components/vehicles/**/*.{ts,tsx,js,jsx}',
  'src/components/marketplace/**/*.{ts,tsx,js,jsx}',
  'src/components/auctions/**/*.{ts,tsx,js,jsx}',
  'src/lib/timeline/**/*.{ts,tsx,js,jsx}',
  'src/services/**/*.{ts,tsx,js,jsx}',
  'src/utils/**/*.{ts,tsx,js,jsx}',
  'supabase/functions/**/*.{ts,js}'
];

// Common error patterns to fix
const SUPABASE_ERROR_PATTERNS = [
  {
    name: 'Multiple from() calls',
    regex: /\.from\(['"]\w+['"]\)[.\s\n\r]+((?!\.from\(['"])\w+[.\s\n\r]+)*\.from\(['"]\w+['"]\)/g,
    fix: (file, content, match) => {
      // Replace multiple .from() calls with proper joins
      return content.replace(match[0], (matched) => {
        // Extract the table names
        const tableRegex = /\.from\(['"](\w+)['"]\)/g;
        const tables = [...matched.matchAll(tableRegex)].map(m => m[1]);
        
        if (tables.length >= 2) {
          // Create a join instead of multiple .from() calls
          const primaryTable = tables[0];
          const secondaryTable = tables[1];
          
          // Extract the operations between from() calls
          const betweenFroms = matched.split(`.from('${secondaryTable}')`)[0]
            .split(`.from('${primaryTable}')`)[1];
          
          return `.from('${primaryTable}')
            .select('*, ${secondaryTable}(*)')
            .inner_join('${secondaryTable}', 'id', '${primaryTable}_id')${betweenFroms}`;
        }
        
        return matched;
      });
    }
  },
  {
    name: 'Missing error handling',
    regex: /(const|let|var)?\s*\w+\s*=\s*await\s+\w+\.from\(['"]\w+['"]\)[\s\S]*?(?!\.catch\(|try\s*{)/g,
    fix: (file, content, match) => {
      // Add error handling to Supabase query
      return content.replace(match[0], (matched) => {
        // Check if already in a try block
        const prevContext = content.substring(
          Math.max(0, content.indexOf(matched) - 50),
          content.indexOf(matched)
        );
        
        if (prevContext.includes('try {')) {
          // Already in a try block, modify to ensure catch block exists
          const nextContext = content.substring(
            content.indexOf(matched) + matched.length,
            Math.min(content.length, content.indexOf(matched) + matched.length + 100)
          );
          
          if (!nextContext.includes('catch')) {
            // Add catch block after the try block ends
            const tryBlockEndIndex = content.indexOf('}', content.indexOf(matched) + matched.length);
            if (tryBlockEndIndex !== -1) {
              // Add vehicle-centric error handling with confidence scoring for data reliability
              return matched + content.substring(content.indexOf(matched) + matched.length, tryBlockEndIndex + 1) +
                ` catch (error) {
                  console.error('Vehicle data operation failed:', error);
                  // Add vehicle data error tracking for reliability metrics
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                      detail: { source: '${path.basename(file)}', timestamp: new Date().toISOString(), error } 
                    }));
                  }
                  return { error, data: null, confidence: 0 };
                }`;
            }
          }
          return matched;
        }
        
        // Wrap in try-catch if not already in one - with vehicle-specific error handling
        if (matched.includes('await')) {
          // Extract the variable declaration if it exists
          const declarationMatch = matched.match(/(const|let|var)?\s*(\w+)\s*=\s*(await.*)/); 
          if (declarationMatch) {
            const [_, declarationType, varName, query] = declarationMatch;
            
            // Add vehicle-centric error handling that maintains the multi-source connector framework principles
            return `try {
                ${declarationType || 'const'} ${varName} = ${query}
              } catch (error) {
                console.error('Vehicle data operation failed:', error);
                // Add vehicle data error tracking for reliability metrics
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                    detail: { source: '${path.basename(file)}', timestamp: new Date().toISOString(), error } 
                  }));
                }
                const ${varName} = { error, data: null, confidence: 0 };
              }`;
          }
        }
        
        // Default case with vehicle-centric error handling
        return `try {
            ${matched}
          } catch (error) {
            console.error('Vehicle data operation failed:', error);
            // Add vehicle data error tracking for reliability metrics
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                detail: { source: '${path.basename(file)}', timestamp: new Date().toISOString(), error } 
              }));
            }
            return { error, data: null, confidence: 0 };
          }`;
      });
    }
  },
  {
    name: 'Incorrect filter column',
    regex: /\.filter\(['"](status|state)['"]\s*,\s*['"](\w+)['"]\)/g,
    fix: (file, content, match) => {
      // Check if the file is related to vehicles
      if (file.includes('vehicle') || file.includes('auctions') || file.includes('marketplace')) {
        // Replace status filter with vehicle_status for vehicle-related components
        return content.replace(match[0], (matched) => {
          if (matched.includes('"status"') || matched.includes("'status'")) {
            return matched.replace(/['"]status['"]/, "'vehicle_status'");
          }
          return matched;
        });
      }
      return content;
    }
  },
  {
    name: 'Inefficient error handling',
    regex: /\n\s*try\s*{\s*\n\s*.*\n\s*}\s*catch\s*\(\w+\)\s*{\s*\n\s*console\.error\([^)]*\);\s*\n\s*}/g,
    fix: (file, content, match) => {
      // Improve error handling to include error context related to vehicle data
      return content.replace(match[0], (matched) => {
        // Check if this is a vehicle-related file for more specific error handling
        if (file.includes('vehicle') || file.includes('timeline')) {
          return matched.replace(
            /console\.error\(([^)]*)\);/,
            `console.error('Vehicle data operation failed:', $1);
              // Add telemetry for vehicle data errors
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                  detail: { source: '${path.basename(file)}', error: $1 } 
                }));
              }`
          );
        }
        return matched;
      });
    }
  }
];

/**
 * Process a single file
 */
function processFile(filePath) {
  console.log(`Processing ${filePath}...`);
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Skip if file doesn't contain supabase references
  if (!content.includes('supabase') && !content.includes('.from(') && !content.includes('createClient')) {
    console.log(`  Skipping ${filePath} - no Supabase queries found`);
    return false;
  }

  SUPABASE_ERROR_PATTERNS.forEach(pattern => {
    const matches = [...content.matchAll(pattern.regex)];
    if (matches.length > 0) {
      console.log(`  Found ${matches.length} matches for pattern: ${pattern.name}`);
      const newContent = pattern.fix(filePath, content, matches[0]);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }
  });

  if (modified) {
    console.log(`  ✅ Fixed Supabase query issues in ${filePath}`);
    fs.writeFileSync(filePath, content);
    return true;
  }
  
  return false;
}

/**
 * Get files to process based on validation output
 */
function getFilesFromValidationOutput() {
  try {
    const command = 'cd "$(git rev-parse --show-toplevel)" && node scripts/validate-supabase-queries.mjs --check';
    const output = execSync(command, { encoding: 'utf8' });
    
    // Extract file paths from validation output
    const fileRegex = /❌\s+([^:]+):/g;
    const matches = [...output.matchAll(fileRegex)];
    return [...new Set(matches.map(m => m[1].trim()))];
  } catch (error) {
    // The validation might exit with error, but we can still extract files from stdout
    if (error.stdout) {
      const fileRegex = /❌\s+([^:]+):/g;
      const matches = [...error.stdout.matchAll(fileRegex)];
      return [...new Set(matches.map(m => m[1].trim()))];
    }
    console.error('Error running validation:', error.message);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Starting Supabase query auto-fix script for vehicle-centric architecture...');
  
  // Get list of files with Supabase query issues
  let files = getFilesFromValidationOutput();
  
  if (files.length === 0) {
    console.log('No specific files with Supabase query issues found from validator, scanning relevant directories...');
    
    // Scan for all potential files containing Supabase queries using a more robust method
    for (const dirPath of [
      'src/components/VehicleTimeline',
      'src/components/vehicles',
      'src/components/marketplace',
      'src/components/auctions',
      'src/lib/timeline',
      'src/services',
      'src/utils',
      'supabase/functions'
    ]) {
      try {
        // Use a different approach with find that works better on macOS
        const command = `find ${dirPath} -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | grep -v node_modules`;
        console.log(`Scanning ${dirPath}...`);
        const globFiles = execSync(command, { encoding: 'utf8', cwd: process.cwd() })
          .split('\n')
          .filter(Boolean);
        
        console.log(`Found ${globFiles.length} files in ${dirPath}`);
        files.push(...globFiles);
      } catch (err) {
        // It's okay if a directory doesn't exist
        if (!err.message.includes('No such file or directory')) {
          console.error(`Error scanning directory ${dirPath}:`, err.message);
        }
      }
    }
  }
  
  // Filter out non-existent files
  files = files.filter(file => {
    try {
      return fs.existsSync(file);
    } catch (err) {
      return false;
    }
  });
  
  // Remove duplicates
  files = [...new Set(files)];
  
  console.log(`Found ${files.length} files to process`);
  
  let fixedFiles = 0;
  for (const file of files) {
    try {
      const fixed = processFile(file);
      if (fixed) fixedFiles++;
    } catch (error) {
      console.error(`  ❌ Error processing ${file}:`, error.message);
    }
  }
  
  console.log(`\n✅ Finished processing. Fixed issues in ${fixedFiles} files.`);
  
  if (fixedFiles > 0) {
    // Run validation again to check if we fixed the issues
    try {
      execSync('cd "$(git rev-parse --show-toplevel)" && node scripts/validate-supabase-queries.mjs --check', 
              { encoding: 'utf8', stdio: 'inherit' });
      console.log('🎉 Supabase query validation successful!');
    } catch (e) {
      console.log('⚠️ Some Supabase query issues remain. Manual fixes may be required.');
    }
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

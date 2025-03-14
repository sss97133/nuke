#!/usr/bin/env node

/**
 * Auto-Fix TypeScript Errors Script for Vehicle-Centric Architecture
 * 
 * This script is designed to automatically fix common TypeScript errors
 * in the vehicle-centric architecture, with special focus on the VehicleTimeline
 * component and the multi-source connector framework.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Support ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File patterns to focus on
const VEHICLE_TIMELINE_PATTERNS = [
  'src/components/VehicleTimeline/**/*.{ts,tsx}',
  'src/services/timeline/**/*.{ts,tsx}'
];

// Error patterns to look for and their fixes
const ERROR_PATTERNS = [
  {
    regex: /Property '(\w+)' does not exist on type 'never'/g,
    fix: (file, content, match) => {
      const propertyName = match[1];
      
      // Fix for accessing properties on possibly null/undefined objects
      const nullCheckPattern = new RegExp(`(\\w+)\\?\\.${propertyName}`, 'g');
      if (nullCheckPattern.test(content)) {
        return content.replace(
          nullCheckPattern,
          (match, objName) => {
            return `${objName} && ${objName}.${propertyName}`;
          }
        );
      }
      
      // Fix for accessing properties without null checks
      const directAccessPattern = new RegExp(`(\\w+)\\.${propertyName}`, 'g');
      return content.replace(
        directAccessPattern, 
        (match, objName) => {
          return `${objName} && ${objName}.${propertyName}`;
        }
      );
    }
  },
  {
    regex: /Expected (\d+) arguments, but got (\d+)/g,
    fix: (file, content, match) => {
      const expected = parseInt(match[1]);
      const received = parseInt(match[2]);
      
      // This is a more complex fix that requires context
      // We'll handle a common case with indentation issues in callbacks
      if (file.includes('VehicleTimeline/index.tsx')) {
        // Check for common indentation issue in callbacks
        const badIndentPattern = /onChange={\(e\) => {\s*\n\s*if/g;
        if (badIndentPattern.test(content)) {
          return content.replace(
            badIndentPattern,
            (matched) => {
              return matched.replace(/{\(e\) => {\s*\n\s*/, '{\(e\) => {\n                  ');
            }
          );
        }
        
        // Handle exportTimeline call with extra parameters
        const exportTimelinePattern = /exportTimeline\((.*?)\)/g;
        if (exportTimelinePattern.test(content)) {
          return content.replace(
            exportTimelinePattern,
            (fullMatch, args) => {
              const argList = args.split(',');
              if (argList.length > 1) {
                // Keep only the first argument
                return `exportTimeline(${argList[0].trim()})`;
              }
              return fullMatch;
            }
          );
        }
      }
      
      return content;
    }
  },
  {
    regex: /Type '(Partial<\w+>)' is not assignable to parameter of type '(\w+)'/g,
    fix: (file, content, match) => {
      const partialType = match[1];
      const requiredType = match[2];
      
      // Looking for setCurrentEvent with Partial<TimelineEvent>
      if (requiredType === 'TimelineEvent' && partialType.includes('Partial<TimelineEvent>')) {
        // Add type assertion for handling timeline events properly
        return content.replace(
          /const (\w+)\s*=\s*(\{[^}]*\}) as Partial<TimelineEvent>/g,
          'const $1 = $2 as TimelineEvent'
        );
      }
      
      return content;
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

  ERROR_PATTERNS.forEach(pattern => {
    const matches = [...content.matchAll(pattern.regex)];
    if (matches.length > 0) {
      console.log(`  Found ${matches.length} matches for pattern: ${pattern.regex}`);
      const newContent = pattern.fix(filePath, content, matches[0]);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }
  });

  if (modified) {
    console.log(`  ✅ Fixed issues in ${filePath}`);
    fs.writeFileSync(filePath, content);
    return true;
  }
  
  return false;
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Starting TypeScript auto-fix script for vehicle-centric architecture...');
  
  // Get list of files with TypeScript errors
  let files = [];
  try {
    // Run TypeScript to get error locations
    const tscOutput = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    
    // Extract file paths from TypeScript output
    const fileRegex = /([^(]+)\(\d+,\d+\):/g;
    const matches = [...tscOutput.matchAll(fileRegex)];
    files = [...new Set(matches.map(m => m[1].trim()))];
  } catch (e) {
    // TypeScript will exit with non-zero status if there are errors
    const tscOutput = e.stdout || '';
    
    // Extract file paths from TypeScript output
    const fileRegex = /([^(]+)\(\d+,\d+\):/g;
    const matches = [...tscOutput.matchAll(fileRegex)];
    files = [...new Set(matches.map(m => m[1].trim()))];
  }
  
  // If no specific files found, use the patterns
  if (files.length === 0) {
    console.log('No specific error files found, scanning vehicle timeline components...');
    for (const pattern of VEHICLE_TIMELINE_PATTERNS) {
      try {
        const command = `find src -path "${pattern.replace(/\{ts,tsx\}/g, '{ts,tsx}')}" -type f`;
        const globFiles = execSync(command, { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean);
        files.push(...globFiles);
      } catch (err) {
        console.error(`Error finding files with pattern ${pattern}:`, err.message);
      }
    }
  }
  
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
    // Run TypeScript again to verify fixes
    try {
      execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'inherit' });
      console.log('🎉 All TypeScript errors fixed successfully!');
    } catch (e) {
      console.log('⚠️ Some TypeScript errors remain. Manual fixes may be required.');
    }
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

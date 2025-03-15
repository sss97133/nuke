#!/usr/bin/env node

/**
 * Auto-Fix TypeScript Errors Script
 * 
 * This script is designed to automatically fix common TypeScript errors
 * in the vehicle-centric architecture, with special focus on the VehicleTimeline
 * component and the multi-source connector framework.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
      // We'll look for function calls with the wrong number of arguments
      const functionCallPattern = /(\w+)\((.*?)\)/g;
      return content.replace(functionCallPattern, (fullMatch, funcName, args) => {
        // Get the number of arguments
        const argCount = args.trim() ? args.split(',').length : 0;
        
        // If we find a potential match for our error
        if (argCount === received && expected < received) {
          // Special case for exportTimeline which should take only format
          if (funcName === 'exportTimeline' && argCount === 2) {
            const firstArg = args.split(',')[0].trim();
            return `${funcName}(${firstArg})`;
          }
        }
        return fullMatch;
      });
    }
  },
  {
    regex: /Type '(Partial<\w+>)' is not assignable to parameter of type '(\w+)'/g,
    fix: (file, content, match) => {
      const partialType = match[1];
      const requiredType = match[2];
      
      // Looking for setCurrentEvent with Partial<TimelineEvent>
      if (requiredType === 'TimelineEvent' && partialType.includes('Partial<TimelineEvent>')) {
        const partialObjectPattern = /(const\s+\w+:\s*Partial<TimelineEvent>\s*=\s*\{[\s\S]*?\})/g;
        return content.replace(partialObjectPattern, (match) => {
          // Add id if missing
          if (!match.includes('id:')) {
            return match.replace(
              /{/, 
              `{\n      id: 'temp-' + Date.now(), // Temporary ID to satisfy the type system`
            );
          }
          // Convert empty string ID to temp ID
          return match.replace(
            /id:\s*['"]{2}/,
            `id: 'temp-' + Date.now() // Temporary ID to satisfy the type system`
          );
        });
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
  console.log('🔍 Starting TypeScript auto-fix script...');
  
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
    VEHICLE_TIMELINE_PATTERNS.forEach(pattern => {
      const globFiles = execSync(`find src -path "${pattern.replace(/\{ts,tsx\}/g, '{ts,tsx}')}" -type f`, { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
      files.push(...globFiles);
    });
  }
  
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

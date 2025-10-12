#!/usr/bin/env node

/**
 * Comprehensive Import Fix
 * Fixes all mixed type import patterns causing compilation errors
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Comprehensive fix for mixed type import errors...');

// Get all TypeScript files
function getAllTSFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      files.push(...getAllTSFiles(path.join(dir, item.name)));
    } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx'))) {
      files.push(path.join(dir, item.name));
    }
  }

  return files;
}

// Fix mixed type imports in a file
function fixMixedImports(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;

    // Pattern 1: import type { Service, type TypeName, type Another } from 'module'
    // Should be: import { Service, type TypeName, type Another } from 'module'
    const pattern1 = /import type \{\s*([^}]+)\s*\}/g;
    content = content.replace(pattern1, (match, imports) => {
      // Split by comma and process each import
      const importItems = imports.split(',').map(item => item.trim());
      const processedItems = [];
      let hasRuntimeImports = false;

      for (const item of importItems) {
        if (item.startsWith('type ')) {
          processedItems.push(item);
        } else if (item.trim()) {
          processedItems.push(item);
          hasRuntimeImports = true;
        }
      }

      // If we have both runtime and type imports, convert to mixed import
      if (hasRuntimeImports && processedItems.some(item => item.startsWith('type '))) {
        hasChanges = true;
        return `import { ${processedItems.join(', ')} }`;
      }

      return match;
    });

    // Save changes if any
    if (hasChanges) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Fixed: ${filePath}`);
      return true;
    }

    return false;
  } catch (error) {
    console.log(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

try {
  const srcDir = path.join(process.cwd(), 'src');
  const tsFiles = getAllTSFiles(srcDir);

  let totalFixed = 0;

  for (const file of tsFiles) {
    if (fixMixedImports(file)) {
      totalFixed++;
    }
  }

  console.log(`✅ Fixed ${totalFixed} files with mixed import syntax errors`);

  // Run type check
  try {
    execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
    console.log('✅ TypeScript compilation successful');
  } catch (error) {
    console.log('⚠️ TypeScript errors may still exist - checking specific patterns...');

    // Get the error output and show a sample
    const errorOutput = error.stdout ? error.stdout.toString() : error.stderr.toString();
    const lines = errorOutput.split('\n').slice(0, 10);
    console.log('Sample errors:', lines.join('\n'));
  }

} catch (error) {
  console.error('❌ Error fixing imports:', error.message);
  process.exit(1);
}
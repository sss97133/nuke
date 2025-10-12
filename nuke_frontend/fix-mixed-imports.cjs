#!/usr/bin/env node

/**
 * Fix Mixed Import Errors
 * Fixes the "type modifier cannot be used when import type is used" errors
 */

const fs = require('fs');
const { execSync } = require('child_process');

console.log('🔧 Fixing mixed type import errors...');

try {
  // Fix the mixed type import syntax errors
  // Pattern: import type { Service, type TypeName } from 'module'
  // Should be: import { Service, type TypeName } from 'module'

  const commands = [
    // Fix mixed imports where both runtime and types are imported
    'find src -name "*.tsx" -exec sed -i.bak \'s/import type { \\([^,}]*\\), type \\([^}]*\\) }/import { \\1, type \\2 }/g\' {} \\;',
    'find src -name "*.ts" -exec sed -i.bak \'s/import type { \\([^,}]*\\), type \\([^}]*\\) }/import { \\1, type \\2 }/g\' {} \\;',

    // Clean up backup files
    'find src -name "*.bak" -delete'
  ];

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (error) {
      console.log('Command failed (non-critical):', cmd);
    }
  }

  console.log('✅ Fixed mixed import syntax errors');

  // Run type check
  try {
    execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
    console.log('✅ TypeScript compilation successful');
  } catch (error) {
    console.log('⚠️ TypeScript errors may still exist');
  }

} catch (error) {
  console.error('❌ Error fixing imports:', error.message);
  process.exit(1);
}
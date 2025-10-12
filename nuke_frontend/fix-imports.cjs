#!/usr/bin/env node

/**
 * Automated Import/Export Fixer for React TypeScript Projects
 * Detects and fixes common module resolution issues after refactoring
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ImportExportFixer {
  constructor() {
    this.fixes = 0;
    this.errors = [];
  }

  async run() {
    console.log('🔍 Scanning for import/export issues...');

    try {
      // Step 1: Clear Vite cache
      await this.clearViteCache();

      // Step 2: Fix type imports proactively
      await this.fixTypeImports();

      // Step 3: Check TypeScript compilation
      const tscErrors = await this.checkTypeScript();

      // Step 3: Fix common issues
      if (tscErrors.length > 0) {
        await this.fixImportExportIssues(tscErrors);
      }

      // Step 4: Restart dev server
      await this.restartDevServer();

      console.log(`✅ Import/Export fix complete. Applied ${this.fixes} fixes.`);

    } catch (error) {
      console.error('❌ Error during fix process:', error.message);
      process.exit(1);
    }
  }

  async clearViteCache() {
    console.log('🧹 Clearing Vite cache...');
    try {
      execSync('rm -rf node_modules/.vite && rm -rf dist', { stdio: 'pipe' });
      console.log('✓ Vite cache cleared');
    } catch (error) {
      console.log('⚠️ Vite cache not found or already cleared');
    }
  }

  async fixTypeImports() {
    console.log('🔧 Converting to explicit type imports...');
    try {
      // Fix vehicle-profile type imports
      execSync('find src/pages/vehicle-profile -name "*.tsx" -exec sed -i.bak \'s/import { \\([^}]*\\) } from \\\'\\.\\/types\\\'/import type { \\1 } from \\\'\\.\\/types\\\'/g\' {} \\;', { stdio: 'pipe' });
      // Clean up backup files
      execSync('find src/pages/vehicle-profile -name "*.bak" -delete', { stdio: 'pipe' });
      console.log('✓ Type imports fixed');
      this.fixes++;
    } catch (error) {
      console.log('⚠️ Type import fix failed:', error.message);
    }
  }

  async checkTypeScript() {
    console.log('🔎 Checking TypeScript compilation...');
    try {
      execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
      console.log('✓ TypeScript compilation successful');
      return [];
    } catch (error) {
      const output = error.stdout?.toString() || error.stderr?.toString() || '';
      const errors = this.parseTypeScriptErrors(output);
      console.log(`⚠️ Found ${errors.length} TypeScript errors to fix`);
      return errors;
    }
  }

  parseTypeScriptErrors(output) {
    const errors = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Parse "Module does not provide export" errors
      if (line.includes('does not provide an export named')) {
        const match = line.match(/(.+\.tsx?)\(\d+,\d+\): .+ '(.+)' does not provide an export named '(.+)'/);
        if (match) {
          errors.push({
            type: 'missing_export',
            file: match[1],
            module: match[2],
            export: match[3]
          });
        }
      }

      // Parse "Cannot find module" errors
      if (line.includes('Cannot find module')) {
        const match = line.match(/(.+\.tsx?)\(\d+,\d+\): .+ Cannot find module '(.+)'/);
        if (match) {
          errors.push({
            type: 'missing_module',
            file: match[1],
            module: match[2]
          });
        }
      }
    }

    return errors;
  }

  async fixImportExportIssues(errors) {
    console.log('🔧 Fixing import/export issues...');

    for (const error of errors) {
      try {
        if (error.type === 'missing_export') {
          await this.fixMissingExport(error);
        } else if (error.type === 'missing_module') {
          await this.fixMissingModule(error);
        }
      } catch (fixError) {
        console.error(`❌ Failed to fix error in ${error.file}:`, fixError.message);
        this.errors.push(fixError);
      }
    }
  }

  async fixMissingExport(error) {
    const { module, export: exportName, file } = error;

    // Resolve the actual module file path
    const moduleFile = this.resolveModulePath(module, file);
    if (!moduleFile || !fs.existsSync(moduleFile)) {
      console.log(`⚠️ Cannot find module file: ${module}`);
      return;
    }

    console.log(`📝 Adding missing export '${exportName}' to ${moduleFile}`);

    const content = fs.readFileSync(moduleFile, 'utf-8');

    // Check if the export already exists
    if (content.includes(`export.*${exportName}`)) {
      console.log(`ℹ️ Export '${exportName}' already exists in ${moduleFile}`);
      return;
    }

    // Try to find the function/class/interface to export
    const patterns = [
      new RegExp(`^(export\\s+)?(function|class|interface|type)\\s+${exportName}`, 'm'),
      new RegExp(`^(const|let|var)\\s+${exportName}\\s*=`, 'm'),
    ];

    let fixed = false;
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        const newContent = content.replace(pattern, (match, exportKeyword, declarationType) => {
          if (exportKeyword) return match; // Already exported
          return `export ${match}`;
        });

        if (newContent !== content) {
          fs.writeFileSync(moduleFile, newContent);
          console.log(`✓ Added export to ${exportName} in ${moduleFile}`);
          this.fixes++;
          fixed = true;
          break;
        }
      }
    }

    // If not found, try adding a default export at the end
    if (!fixed && !content.includes('export default')) {
      const newContent = content + `\n\nexport default ${exportName};`;
      fs.writeFileSync(moduleFile, newContent);
      console.log(`✓ Added default export for ${exportName} in ${moduleFile}`);
      this.fixes++;
    }
  }

  async fixMissingModule(error) {
    // This is more complex - would need to analyze the import path
    console.log(`⚠️ Module resolution issue: ${error.module} in ${error.file}`);
    console.log('📋 Manual fix may be required for module path resolution');
  }

  resolveModulePath(module, fromFile) {
    const dir = path.dirname(fromFile);

    // Handle relative imports
    if (module.startsWith('./') || module.startsWith('../')) {
      let resolved = path.resolve(dir, module);

      // Try different extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }
    }

    return null;
  }

  async restartDevServer() {
    console.log('🔄 Development server should automatically reload...');
    // In a real implementation, you might kill and restart the dev server
    // For now, just wait a bit for HMR to pick up changes
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Run the fixer if called directly
if (require.main === module) {
  const fixer = new ImportExportFixer();
  fixer.run().catch(console.error);
}

module.exports = ImportExportFixer;
#!/usr/bin/env node

/**
 * Comprehensive Import/Export Scanner and Fixer
 * Scans entire codebase for import/export mismatches and fixes them systematically
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ComprehensiveImportFixer {
  constructor() {
    this.fixes = 0;
    this.errors = [];
    this.scannedFiles = 0;
    this.importIssues = [];
  }

  async run() {
    console.log('🔍 COMPREHENSIVE IMPORT/EXPORT SCAN STARTING...');

    try {
      // Step 1: Nuclear cache clear
      await this.nuclearCacheClear();

      // Step 2: Scan all TypeScript/React files for import issues
      await this.scanAllFiles();

      // Step 3: Fix common patterns
      await this.fixCommonPatterns();

      // Step 4: Verify with TypeScript
      await this.verifyTypeScript();

      console.log(`✅ Scan complete. Scanned ${this.scannedFiles} files, applied ${this.fixes} fixes.`);

      if (this.importIssues.length > 0) {
        console.log('📋 Found import issues:');
        this.importIssues.forEach((issue, i) => {
          console.log(`${i + 1}. ${issue.file}: ${issue.import} not found in ${issue.module}`);
        });
      }

    } catch (error) {
      console.error('❌ Error during comprehensive scan:', error.message);
      process.exit(1);
    }
  }

  async nuclearCacheClear() {
    console.log('💣 Nuclear cache clear...');
    try {
      const commands = [
        'rm -rf node_modules/.vite',
        'rm -rf dist',
        'rm -rf .next',
        'rm -rf build'
      ];

      for (const cmd of commands) {
        try {
          execSync(cmd, { stdio: 'pipe' });
        } catch (e) {
          // Ignore errors for missing directories
        }
      }

      console.log('✓ All caches cleared');
    } catch (error) {
      console.log('⚠️ Cache clear failed:', error.message);
    }
  }

  async scanAllFiles() {
    console.log('📁 Scanning all TypeScript/React files...');

    const srcDir = './src';
    const files = this.getAllTSFiles(srcDir);

    for (const file of files) {
      try {
        await this.scanFile(file);
        this.scannedFiles++;
      } catch (error) {
        console.log(`⚠️ Error scanning ${file}:`, error.message);
      }
    }
  }

  getAllTSFiles(dir) {
    let files = [];

    try {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          files = files.concat(this.getAllTSFiles(fullPath));
        } else if (item.match(/\.(ts|tsx)$/)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }

    return files;
  }

  async scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Find import statements
      const importMatch = line.match(/import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const [, namedImports, namespaceImport, defaultImport, modulePath] = importMatch;

        // Only check relative imports
        if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
          const resolvedPath = this.resolveModulePath(modulePath, filePath);
          if (resolvedPath && fs.existsSync(resolvedPath)) {
            // Check if imports exist in target file
            if (namedImports) {
              const imports = namedImports.split(',').map(imp => imp.trim().split(' as ')[0]);
              for (const imp of imports) {
                if (!this.checkExportExists(resolvedPath, imp.trim())) {
                  this.importIssues.push({
                    file: filePath,
                    line: i + 1,
                    import: imp.trim(),
                    module: resolvedPath,
                    type: 'named'
                  });
                }
              }
            }

            if (defaultImport && !this.checkDefaultExportExists(resolvedPath)) {
              this.importIssues.push({
                file: filePath,
                line: i + 1,
                import: defaultImport,
                module: resolvedPath,
                type: 'default'
              });
            }
          }
        }
      }
    }
  }

  resolveModulePath(modulePath, fromFile) {
    const dir = path.dirname(fromFile);
    let resolved = path.resolve(dir, modulePath);

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    return null;
  }

  checkExportExists(filePath, exportName) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for various export patterns
      const patterns = [
        new RegExp(`export\\s+(?:interface|type|class|function|const|let|var)\\s+${exportName}\\b`),
        new RegExp(`export\\s*{[^}]*\\b${exportName}\\b[^}]*}`),
        new RegExp(`export\\s*\\*.*from`), // Re-exports
      ];

      return patterns.some(pattern => pattern.test(content));
    } catch (error) {
      return false;
    }
  }

  checkDefaultExportExists(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return /export\s+default\s/.test(content);
    } catch (error) {
      return false;
    }
  }

  async fixCommonPatterns() {
    console.log('🔧 Applying common fix patterns...');

    // Fix 1: Convert all type imports to explicit type imports
    try {
      execSync(`find src -name "*.tsx" -exec sed -i.bak 's/import { \\([^}]*\\) } from \\([^;]*\\)/import type { \\1 } from \\2/g' {} \\;`, { stdio: 'pipe' });
      execSync('find src -name "*.bak" -delete', { stdio: 'pipe' });
      console.log('✓ Fixed type import patterns');
      this.fixes++;
    } catch (error) {
      console.log('⚠️ Type import fix failed');
    }

    // Fix 2: Add missing default exports where needed
    for (const issue of this.importIssues) {
      if (issue.type === 'default') {
        try {
          const content = fs.readFileSync(issue.module, 'utf-8');

          // Look for function/class/const that matches the expected default export
          const basename = path.basename(issue.module, path.extname(issue.module));
          const patterns = [
            new RegExp(`^(export\\s+)?(function|class|const)\\s+${basename}`, 'm'),
            new RegExp(`^(export\\s+)?(function|class|const)\\s+${issue.import}`, 'm'),
          ];

          for (const pattern of patterns) {
            if (pattern.test(content) && !content.includes('export default')) {
              const newContent = content + `\n\nexport default ${issue.import};\n`;
              fs.writeFileSync(issue.module, newContent);
              console.log(`✓ Added default export to ${issue.module}`);
              this.fixes++;
              break;
            }
          }
        } catch (error) {
          console.log(`⚠️ Failed to fix default export in ${issue.module}`);
        }
      }
    }
  }

  async verifyTypeScript() {
    console.log('🔎 Final TypeScript verification...');
    try {
      execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
      console.log('✅ TypeScript compilation successful');
    } catch (error) {
      console.log('❌ TypeScript errors still exist:');
      console.log(error.stdout?.toString() || error.stderr?.toString());
    }
  }
}

// Run the comprehensive fixer
if (require.main === module) {
  const fixer = new ComprehensiveImportFixer();
  fixer.run().catch(console.error);
}

module.exports = ComprehensiveImportFixer;
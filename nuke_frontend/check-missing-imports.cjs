#!/usr/bin/env node

/**
 * Missing Component Import Checker
 * Finds components used in JSX but not properly imported
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking for missing component imports...');

function getAllTSXFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      files.push(...getAllTSXFiles(fullPath));
    } else if (item.isFile() && (item.name.endsWith('.tsx') || item.name.endsWith('.jsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Extract imports
    const imports = new Set();
    const typeImports = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Regular imports
      const importMatch = line.match(/import\s+(?:{([^}]+)}|(\w+))\s+from/);
      if (importMatch) {
        if (importMatch[1]) {
          // Named imports
          importMatch[1].split(',').forEach(imp => {
            const clean = imp.trim().replace(/^type\s+/, '');
            imports.add(clean);
          });
        } else if (importMatch[2]) {
          // Default import
          imports.add(importMatch[2]);
        }
      }

      // Type imports
      const typeImportMatch = line.match(/import\s+type\s+{([^}]+)}/);
      if (typeImportMatch) {
        typeImportMatch[1].split(',').forEach(imp => {
          const clean = imp.trim().replace(/^type\s+/, '');
          typeImports.add(clean);
        });
      }
    }

    // Find JSX components used
    const jsxComponents = new Set();
    const jsxRegex = /<(\w+)[\s>]/g;
    let match;

    while ((match = jsxRegex.exec(content)) !== null) {
      const component = match[1];
      // Filter out HTML elements (lowercase) and common React elements
      if (component[0] === component[0].toUpperCase() &&
          !['Fragment', 'Suspense'].includes(component)) {
        jsxComponents.add(component);
      }
    }

    // Check for missing imports
    const missing = [];
    for (const component of jsxComponents) {
      if (!imports.has(component)) {
        // Check if it's incorrectly imported as type
        if (typeImports.has(component)) {
          missing.push({
            component,
            issue: 'Component imported as type but used in JSX',
            line: findComponentUsage(lines, component)
          });
        } else {
          missing.push({
            component,
            issue: 'Component used but not imported',
            line: findComponentUsage(lines, component)
          });
        }
      }
    }

    return missing;
  } catch (error) {
    return [{ component: 'ERROR', issue: error.message, line: 0 }];
  }
}

function findComponentUsage(lines, component) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`<${component}`)) {
      return i + 1;
    }
  }
  return 0;
}

try {
  const srcDir = path.join(process.cwd(), 'src');
  const tsxFiles = getAllTSXFiles(srcDir);

  console.log(`📁 Scanning ${tsxFiles.length} TSX files...`);

  let totalIssues = 0;
  const problemFiles = [];

  for (const file of tsxFiles) {
    const issues = checkFile(file);
    if (issues.length > 0) {
      totalIssues += issues.length;
      problemFiles.push({
        file: path.relative(process.cwd(), file),
        issues
      });
    }
  }

  if (totalIssues === 0) {
    console.log('✅ All component imports are correct!');
  } else {
    console.log(`❌ Found ${totalIssues} missing import issues in ${problemFiles.length} files:`);

    for (const { file, issues } of problemFiles) {
      console.log(`\n📄 ${file}:`);
      for (const issue of issues) {
        console.log(`  Line ${issue.line}: ${issue.component} - ${issue.issue}`);
      }
    }
  }

} catch (error) {
  console.error('❌ Check failed:', error.message);
  process.exit(1);
}
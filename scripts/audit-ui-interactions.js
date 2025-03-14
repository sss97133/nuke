#!/usr/bin/env node
/**
 * UI Interaction Audit Tool
 * Finds and catalogs all buttons and interactive elements in the codebase
 * Helps identify potential non-functioning UI elements
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Color formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const REPO_ROOT = path.resolve(process.cwd());
const SOURCE_DIR = path.join(REPO_ROOT, 'src');
const COMPONENTS_DIR = path.join(SOURCE_DIR, 'components');
const PAGES_DIR = path.join(SOURCE_DIR, 'pages');
const OUTPUT_FILE = path.join(REPO_ROOT, 'ui-interaction-audit.md');

// Interactive element patterns
const BUTTON_PATTERNS = [
  '<Button',
  'onClick=',
  'onPress=',
  'handleClick',
  '<IconButton',
  'type="submit"',
  'role="button"',
  'as="button"',
  'button className=',
  '<button ',
  'button\n',
  'button>',
  'handleSubmit',
  'onSubmit=',
  'clickable',
  '<a ',
  'navigate(',
  'history.push',
  'useNavigate',
  'router.push',
  'Link to='
];

console.log(`${colors.bright}${colors.cyan}UI Interaction Audit Tool${colors.reset}`);
console.log(`Scanning your codebase for interactive elements...`);

// Statistics
const stats = {
  totalFiles: 0,
  totalInteractions: 0,
  totalWithHandlers: 0,
  totalWithoutHandlers: 0,
  componentBreakdown: {}
};

// Function to get all TypeScript/JavaScript/TSX/JSX files recursively
function getSourceFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and build directories
      if (file !== 'node_modules' && file !== 'dist' && file !== 'build' && !file.startsWith('.')) {
        getSourceFiles(filePath, fileList);
      }
    } else if (/\.(tsx|jsx|ts|js)$/.test(file)) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Function to analyze a file for interactive elements
function analyzeFile(filePath) {
  stats.totalFiles++;
  
  const relativePath = path.relative(REPO_ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const interactions = [];
  
  lines.forEach((line, index) => {
    BUTTON_PATTERNS.forEach(pattern => {
      if (line.includes(pattern)) {
        // Extract component name from file path
        const componentMatch = relativePath.match(/\/([^\/]+)\.(tsx|jsx|ts|js)$/);
        const componentName = componentMatch ? componentMatch[1] : path.basename(path.dirname(relativePath));
        
        // Check if there's a handler
        const hasHandler = line.includes('onClick=') || 
                          line.includes('onPress=') || 
                          line.includes('onSubmit=') ||
                          line.includes('handleClick') ||
                          line.includes('handleSubmit');
        
        // Only count the interaction once per line
        if (!interactions.some(i => i.lineNumber === index + 1)) {
          interactions.push({
            pattern,
            line: line.trim(),
            lineNumber: index + 1,
            hasHandler,
            component: componentName
          });
          
          // Update stats
          stats.totalInteractions++;
          if (hasHandler) {
            stats.totalWithHandlers++;
          } else {
            stats.totalWithoutHandlers++;
          }
          
          // Update component breakdown
          if (!stats.componentBreakdown[componentName]) {
            stats.componentBreakdown[componentName] = {
              total: 0,
              withHandlers: 0,
              withoutHandlers: 0,
              filePath: relativePath
            };
          }
          
          stats.componentBreakdown[componentName].total++;
          if (hasHandler) {
            stats.componentBreakdown[componentName].withHandlers++;
          } else {
            stats.componentBreakdown[componentName].withoutHandlers++;
          }
        }
      }
    });
  });
  
  return {
    filePath: relativePath,
    interactions
  };
}

// Get all source files
const sourceFiles = getSourceFiles(SOURCE_DIR);

// Analyze each file
console.log(`Found ${sourceFiles.length} source files to analyze...`);
const results = sourceFiles.map(analyzeFile);

// Filter results to only include files with interactions
const interactionResults = results.filter(result => result.interactions.length > 0);

// Sort components by number of interactions without handlers (descending)
const sortedComponents = Object.entries(stats.componentBreakdown)
  .sort((a, b) => b[1].withoutHandlers - a[1].withoutHandlers)
  .map(([name, data]) => ({ name, ...data }));

// Generate markdown report
let report = `# UI Interaction Audit Report\n\n`;
report += `Generated on: ${new Date().toLocaleString()}\n\n`;

report += `## Summary\n\n`;
report += `- Total files analyzed: ${stats.totalFiles}\n`;
report += `- Total interactive elements found: ${stats.totalInteractions}\n`;
report += `- Elements with handlers: ${stats.totalWithHandlers} (${Math.round(stats.totalWithHandlers / stats.totalInteractions * 100)}%)\n`;
report += `- Elements potentially missing handlers: ${stats.totalWithoutHandlers} (${Math.round(stats.totalWithoutHandlers / stats.totalInteractions * 100)}%)\n\n`;

report += `## Components Ranked by Potential Issues\n\n`;
report += `| Component | Total Interactions | Missing Handlers | Has Handlers | File |\n`;
report += `|-----------|-------------------|-----------------|-------------|------|\n`;

sortedComponents.forEach(component => {
  report += `| ${component.name} | ${component.total} | ${component.withoutHandlers} | ${component.withHandlers} | \`${component.filePath}\` |\n`;
});

report += `\n## Detailed Findings\n\n`;

interactionResults.forEach(result => {
  if (result.interactions.length > 0) {
    report += `### ${result.filePath}\n\n`;
    
    // Group by component and if has handler
    const groupedByHandler = {
      withHandlers: result.interactions.filter(i => i.hasHandler),
      withoutHandlers: result.interactions.filter(i => !i.hasHandler)
    };
    
    if (groupedByHandler.withoutHandlers.length > 0) {
      report += `#### Potentially Missing Handlers\n\n`;
      report += `| Line | Pattern | Code |\n`;
      report += `|------|---------|------|\n`;
      
      groupedByHandler.withoutHandlers.forEach(interaction => {
        const escapedLine = interaction.line.replace(/\|/g, '\\|');
        report += `| ${interaction.lineNumber} | ${interaction.pattern} | \`${escapedLine}\` |\n`;
      });
      
      report += `\n`;
    }
    
    if (groupedByHandler.withHandlers.length > 0) {
      report += `#### Has Handlers\n\n`;
      report += `| Line | Pattern | Code |\n`;
      report += `|------|---------|------|\n`;
      
      groupedByHandler.withHandlers.forEach(interaction => {
        const escapedLine = interaction.line.replace(/\|/g, '\\|');
        report += `| ${interaction.lineNumber} | ${interaction.pattern} | \`${escapedLine}\` |\n`;
      });
      
      report += `\n`;
    }
  }
});

report += `## Next Steps\n\n`;
report += `1. Review the components with the highest number of "Missing Handlers"\n`;
report += `2. Verify that these UI elements have proper functionality\n`;
report += `3. For any confirmed non-functioning elements:\n`;
report += `   - Add appropriate handlers\n`;
report += `   - Connect to your state management (Jotai)\n`;
report += `   - Ensure Supabase API calls are properly implemented\n`;
report += `4. Update tests to verify button functionality\n`;

// Write report to file
fs.writeFileSync(OUTPUT_FILE, report);

console.log(`${colors.green}✅ Audit complete!${colors.reset}`);
console.log(`Results saved to: ${colors.bright}${OUTPUT_FILE}${colors.reset}`);
console.log(`\nSummary:`);
console.log(`- Total files analyzed: ${stats.totalFiles}`);
console.log(`- Total interactive elements found: ${stats.totalInteractions}`);
console.log(`- Elements with handlers: ${stats.totalWithHandlers} (${Math.round(stats.totalWithHandlers / stats.totalInteractions * 100)}%)`);
console.log(`- Elements potentially missing handlers: ${stats.totalWithoutHandlers} (${Math.round(stats.totalWithoutHandlers / stats.totalInteractions * 100)}%)`);

// Top 5 components with potential issues
console.log(`\n${colors.yellow}Top 5 components to review:${colors.reset}`);
sortedComponents.slice(0, 5).forEach((component, index) => {
  console.log(`${index + 1}. ${colors.bright}${component.name}${colors.reset} - ${component.withoutHandlers} potential issues (${component.filePath})`);
});

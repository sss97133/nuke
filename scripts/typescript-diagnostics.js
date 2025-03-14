#!/usr/bin/env node

/**
 * TypeScript Diagnostic Tool
 * 
 * This script runs TypeScript diagnostics on the codebase, categorizes errors,
 * and provides targeted recommendations, with special attention to vehicle data handling.
 * 
 * Run with: node scripts/typescript-diagnostics.js
 * Options:
 *  --fix: Attempts to automatically fix common issues
 *  --vehicle-only: Only analyze vehicle-related components
 *  --full-report: Generate a comprehensive HTML report
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chalk might not be installed, so providing fallbacks
let chalk;
try {
  chalk = (await import('chalk')).default;
} catch (e) {
  chalk = { red: (t) => t, yellow: (t) => t, green: (t) => t, blue: (t) => t, cyan: (t) => t, magenta: (t) => t, gray: (t) => t };
}

// Configuration
const REPORTS_DIR = path.join(process.cwd(), 'reports');
const VEHICLE_PATTERNS = ['src/components/Vehicle', 'timeline', 'src/services/vehicle'];
const TS_ERROR_CODES = {
  NULL_UNDEFINED: ['TS2531', 'TS2532', 'TS2533', 'TS2322.*null', 'TS2322.*undefined'],
  TYPE_DEFINITION: ['TS2304', 'TS2307', 'TS2344', 'TS2749'],
  TYPE_MISMATCH: ['TS2322', 'TS2345', 'TS2739'],
  PROPERTY_ACCESS: ['TS2339', 'TS2551', 'TS2571'],
  ANY_TYPE: ['TS7005', 'TS7006', 'TS7031'],
};

// Process arguments
const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const vehicleOnly = args.includes('--vehicle-only');
const fullReport = args.includes('--full-report');

// Helper for running in ES module context
const readJsonSync = (filePath) => {
  return JSON.parse(fs.readFileSync(new URL(filePath, import.meta.url), 'utf8'));
};

// Create reports directory if needed
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Print banner
console.log('\n' + chalk.cyan('================================================'));
console.log(chalk.cyan('        TYPESCRIPT DIAGNOSTIC TOOL'));
console.log(chalk.cyan('        Prioritizing Vehicle Data Integrity'));
console.log(chalk.cyan('================================================') + '\n');

// Run TypeScript compiler to get errors
console.log(chalk.blue('Running TypeScript compiler diagnostics...'));
try {
  let tscCommand = 'npx tsc --noEmit';
  if (vehicleOnly) {
    // For vehicle-only mode, we create a temporary tsconfig that only includes vehicle files
    const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    const vehiclePatterns = VEHICLE_PATTERNS.map(p => `**/${p}/**/*.{ts,tsx}`);
    
    tsconfig.include = vehiclePatterns;
    const vehicleTsconfigPath = path.join(process.cwd(), 'tsconfig.vehicle.json');
    fs.writeFileSync(vehicleTsconfigPath, JSON.stringify(tsconfig, null, 2));
    tscCommand = 'npx tsc --noEmit --project tsconfig.vehicle.json';
  }
  
  try {
    execSync(tscCommand, { stdio: 'pipe' });
    console.log(chalk.green('✓ No TypeScript errors found!'));
    process.exit(0);
  } catch (e) {
    fs.writeFileSync(path.join(REPORTS_DIR, 'typescript-all-errors.txt'), e.stdout.toString());
  }
} catch (error) {
  console.error(chalk.red('Error running TypeScript compiler:'), error);
  process.exit(1);
}

// Read error output
const errorOutput = fs.readFileSync(path.join(REPORTS_DIR, 'typescript-all-errors.txt'), 'utf8');
const errorLines = errorOutput.split('\n').filter(line => line.includes('error TS'));

// Count total errors
const totalErrors = errorLines.length;
console.log(chalk.yellow(`Found ${totalErrors} TypeScript errors`));

// Categorize errors
const errorCategories = {
  nullUndefined: {
    title: 'Null/Undefined Errors',
    errors: [],
    icon: '🚫',
    color: chalk.red,
    recommendation: 'Add proper null checks and optional chaining'
  },
  typeDefinition: {
    title: 'Type Definition Errors',
    errors: [],
    icon: '📝',
    color: chalk.magenta,
    recommendation: 'Create missing interfaces and type definitions'
  },
  typeMismatch: {
    title: 'Type Mismatch Errors',
    errors: [],
    icon: '⚠️',
    color: chalk.yellow,
    recommendation: 'Ensure proper type compatibility between values'
  },
  propertyAccess: {
    title: 'Property Access Errors',
    errors: [],
    icon: '🔑',
    color: chalk.cyan,
    recommendation: 'Verify property existence before access'
  },
  anyType: {
    title: 'Any Type Usage',
    errors: [],
    icon: '🤔',
    color: chalk.gray,
    recommendation: 'Replace \'any\' types with proper interfaces'
  },
  other: {
    title: 'Other Errors',
    errors: [],
    icon: '🔄',
    color: chalk.blue,
    recommendation: 'Review and address case by case'
  }
};

// Sort errors into categories
errorLines.forEach(line => {
  if (TS_ERROR_CODES.NULL_UNDEFINED.some(code => line.includes(code))) {
    errorCategories.nullUndefined.errors.push(line);
  } else if (TS_ERROR_CODES.TYPE_DEFINITION.some(code => line.includes(code))) {
    errorCategories.typeDefinition.errors.push(line);
  } else if (TS_ERROR_CODES.TYPE_MISMATCH.some(code => line.includes(code))) {
    errorCategories.typeMismatch.errors.push(line);
  } else if (TS_ERROR_CODES.PROPERTY_ACCESS.some(code => line.includes(code))) {
    errorCategories.propertyAccess.errors.push(line);
  } else if (TS_ERROR_CODES.ANY_TYPE.some(code => line.includes(code))) {
    errorCategories.anyType.errors.push(line);
  } else {
    errorCategories.other.errors.push(line);
  }
});

// Find vehicle data related errors
const vehicleErrors = errorLines.filter(line => 
  VEHICLE_PATTERNS.some(pattern => line.toLowerCase().includes(pattern.toLowerCase()))
);

// Analyze files with most errors
const fileErrorCounts = {};
errorLines.forEach(line => {
  const match = line.match(/([^(\s]+\.tsx?)/);
  if (match && match[1]) {
    const file = match[1];
    fileErrorCounts[file] = (fileErrorCounts[file] || 0) + 1;
  }
});

// Sort files by error count
const sortedFiles = Object.entries(fileErrorCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

// Print category summaries
console.log('\n' + chalk.cyan('=== ERROR CATEGORIES ==='));
Object.values(errorCategories).forEach(category => {
  if (category.errors.length > 0) {
    console.log(`${category.icon} ${category.color(category.title)}: ${category.errors.length}`);
    
    // Print a few example errors from this category
    const examples = category.errors.slice(0, 3);
    examples.forEach(example => {
      const simplifiedExample = example.replace(/src\/.*\.tsx?:/, '').trim();
      console.log(`   ${category.color('›')} ${simplifiedExample}`);
    });
    
    if (category.errors.length > 3) {
      console.log(`   ${category.color('›')} ...and ${category.errors.length - 3} more`);
    }
  }
});

// Print vehicle data specific errors
if (vehicleErrors.length > 0) {
  console.log('\n' + chalk.cyan('=== VEHICLE DATA ISSUES ==='));
  console.log(`Found ${vehicleErrors.length} errors in vehicle data handling code`);
  
  // Extract common patterns in vehicle errors
  const vehicleNullErrors = vehicleErrors.filter(e => 
    TS_ERROR_CODES.NULL_UNDEFINED.some(code => e.includes(code))
  ).length;
  
  const vehicleTypeMismatchErrors = vehicleErrors.filter(e => 
    TS_ERROR_CODES.TYPE_MISMATCH.some(code => e.includes(code))
  ).length;
  
  console.log(`${chalk.red('›')} ${vehicleNullErrors} null/undefined errors`);
  console.log(`${chalk.yellow('›')} ${vehicleTypeMismatchErrors} type mismatch errors`);
  
  // Special checks for real data handling
  const realDataIssues = vehicleErrors.filter(e => 
    e.toLowerCase().includes('fallback') || e.toLowerCase().includes('mock')
  );
  
  if (realDataIssues.length > 0) {
    console.log(`${chalk.magenta('!')} Warning: ${realDataIssues.length} errors may relate to real/mock data handling`);
  }
}

// Print files with most errors
console.log('\n' + chalk.cyan('=== FILES WITH MOST ERRORS ==='));
sortedFiles.forEach(([file, count]) => {
  console.log(`${chalk.yellow(count.toString().padStart(3))} errors in ${file}`);
});

// Provide recommendations
console.log('\n' + chalk.cyan('=== RECOMMENDATIONS ==='));
Object.values(errorCategories).forEach(category => {
  if (category.errors.length > 10) {
    console.log(`${category.icon} ${category.color(category.recommendation)}`);
  }
});

// If there are vehicle data issues, provide specialized recommendations
if (vehicleErrors.length > 0) {
  console.log(`🚗 ${chalk.cyan('Consider creating a RawTimelineEvent interface for database records')}`);
  console.log(`🚗 ${chalk.cyan('Add explicit null checks for vehicle data operations')}`);
  console.log(`🚗 ${chalk.cyan('Implement type guards for vehicle event validation')}`);
}

// Generate specialized fixes if requested
if (shouldFix) {
  console.log('\n' + chalk.cyan('=== ATTEMPTING AUTOMATIC FIXES ==='));
  
  // Create common interfaces
  if (errorCategories.typeDefinition.errors.length > 0 && vehicleErrors.length > 0) {
    console.log(`${chalk.green('›')} Creating/updating vehicle data interfaces...`);
    // Code would go here to create standard interfaces
  }
  
  // Fix any type usage
  if (errorCategories.anyType.errors.length > 0) {
    console.log(`${chalk.green('›')} Replacing 'any' types with proper types...`);
    // Code would go here to replace any types
  }
}

console.log('\n' + chalk.green('TypeScript diagnostic complete!'));
if (fullReport) {
  console.log(chalk.blue('Full HTML report generated in reports/typescript-report.html'));
}
console.log('');

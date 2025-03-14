#!/usr/bin/env node

/**
 * Vehicle-Centric TypeScript Diagnostic Tool
 * 
 * This script analyzes TypeScript errors specifically for vehicle-related components,
 * focusing on maintaining digital vehicle identity integrity across the timeline.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REPORTS_DIR = path.join(process.cwd(), 'reports');
const VEHICLE_COMPONENTS = [
  'src/components/Vehicle',
  'src/components/VehicleTimeline',
  'src/services/vehicle'
];

// Create reports directory
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

console.log('\n=== VEHICLE DATA INTEGRITY CHECK ===');
console.log('Focusing on vehicle-centric components and timeline data integrity\n');

// Find all vehicle-related TypeScript files
try {
  console.log('Locating vehicle-related TypeScript files...');
  
  // Build grep pattern for vehicle components
  const grepPattern = VEHICLE_COMPONENTS.join('|');
  
  // Find all TypeScript files related to vehicles
  const cmd = `find src -name "*.ts*" | grep -E '${grepPattern}'`;
  const vehicleFiles = execSync(cmd, { encoding: 'utf8' }).trim().split('\n');
  
  if (vehicleFiles.length === 0 || (vehicleFiles.length === 1 && !vehicleFiles[0])) {
    console.log('No vehicle-related TypeScript files found.');
    process.exit(0);
  }
  
  console.log(`Found ${vehicleFiles.length} vehicle-related TypeScript files\n`);
  
  // Run TypeScript compiler on these files
  console.log('Analyzing TypeScript errors in vehicle components...');
  
  const tscCmd = `npx tsc --noEmit ${vehicleFiles.join(' ')} 2>&1 || true`;
  const tscOutput = execSync(tscCmd, { encoding: 'utf8' });
  
  // Save full output
  fs.writeFileSync(path.join(REPORTS_DIR, 'vehicle-ts-errors.txt'), tscOutput);
  
  // Extract and count errors
  const errorLines = tscOutput.split('\n').filter(line => line.includes('error TS'));
  const errorCount = errorLines.length;
  
  if (errorCount === 0) {
    console.log('\n✅ No TypeScript errors found in vehicle components!');
    process.exit(0);
  }
  
  console.log(`\n⚠️ Found ${errorCount} TypeScript errors in vehicle components\n`);
  
  // Categorize errors
  const nullErrors = errorLines.filter(line => 
    line.includes('TS2531') || 
    line.includes('TS2532') || 
    line.includes('TS2533') ||
    line.includes('null') || 
    line.includes('undefined')
  ).length;
  
  const typeDefErrors = errorLines.filter(line => 
    line.includes('TS2304') || 
    line.includes('TS2307') || 
    line.includes('TS2344')
  ).length;
  
  const propertyErrors = errorLines.filter(line => 
    line.includes('TS2339') || // Property does not exist
    line.includes('TS2551')    // Property does not exist on type
  ).length;
  
  // Check for mock data usage (against USER preference)
  console.log('Checking for mock data usage (conflict with real data preference)...');
  const mockDataCmd = `grep -r "mock.*data\\|MOCK_\\|test.*data" ${vehicleFiles.join(' ')} || true`;
  const mockDataOutput = execSync(mockDataCmd, { encoding: 'utf8' });
  const mockDataLines = mockDataOutput.split('\n').filter(line => line.trim());
  
  if (mockDataLines.length > 0) {
    console.log(`\n⚠️ WARNING: Found ${mockDataLines.length} potential mock data usages in vehicle components`);
    console.log('USER PREFERENCE: Use real vehicle data instead of mock data in all circumstances');
  }
  
  // Provide actionable recommendations
  console.log('\n=== RECOMMENDATIONS ===');
  
  if (nullErrors > 0) {
    console.log(`• Add proper null checks for ${nullErrors} potential null/undefined errors`);
    console.log('  Example: vehicleData?.make || ""');
  }
  
  if (typeDefErrors > 0) {
    console.log(`• Create proper type definitions for ${typeDefErrors} type-related errors`);
    console.log('  Example: interface RawTimelineEvent { ... }');
  }
  
  if (propertyErrors > 0) {
    console.log(`• Add property checks for ${propertyErrors} property access errors`);
    console.log('  Example: if ("propertyName" in object) { ... }');
  }
  
  // Specific to vehicle timeline
  if (errorLines.some(line => line.includes('VehicleTimeline'))) {
    console.log('\n=== VEHICLE TIMELINE RECOMMENDATIONS ===');
    console.log('• Implement proper type guards for timeline events');
    console.log('• Ensure confidence scoring is properly typed for multi-source resolution');
    console.log('• Add null safety for vehicle identity operations');
  }
  
  console.log('\nFull error report saved to: reports/vehicle-ts-errors.txt');
  
} catch (error) {
  console.error('Error running vehicle TypeScript analysis:', error);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Vehicle Timeline Component Test Script
 * 
 * This CLI script tests the vehicle timeline components and connectors,
 * validating both frontend rendering and data processing functionality.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import chalk from 'chalk';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });

// Environment variable setup
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(chalk.red('❌ ERROR: Required environment variables missing'));
  console.error(chalk.yellow('Please set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY'));
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Test suite for Vehicle Timeline
 */
async function runTests() {
  console.log(chalk.blue('🧪 Starting Vehicle Timeline Component Tests'));
  console.log(chalk.gray('=========================================='));
  
  const testResults = {
    passed: 0,
    failed: 0,
    errors: []
  };
  
  try {
    // 1. Check for required files
    await testRequiredFiles(testResults);
    
    // 2. Verify database tables and structure
    await testDatabaseStructure(testResults);
    
    // 3. Seed test data
    await seedTestData(testResults);
    
    // 4. Test component rendering (mock test)
    await testComponentRendering(testResults);
    
    // 5. Test connector functionality
    await testConnectorFunctionality(testResults);
    
    // 6. Clean up test data
    await cleanupTestData(testResults);
    
    // Output final results
    console.log(chalk.gray('\n=========================================='));
    if (testResults.failed === 0) {
      console.log(chalk.green(`✅ All tests passed! (${testResults.passed} tests)`));
    } else {
      console.log(chalk.red(`❌ Tests completed with failures: ${testResults.passed} passed, ${testResults.failed} failed`));
      testResults.errors.forEach((err, index) => {
        console.error(chalk.red(`\nError ${index + 1}:`));
        console.error(chalk.yellow(err));
      });
    }
  } catch (error) {
    console.error(chalk.red('❌ Test suite failed with an unexpected error:'));
    console.error(error);
    process.exit(1);
  }
}

/**
 * Test if all required files exist
 */
async function testRequiredFiles(results) {
  console.log(chalk.blue('\n🔍 Checking required files...'));
  
  const requiredFiles = [
    'src/components/VehicleTimeline/index.tsx',
    'src/components/VehicleTimeline/VehicleTimeline.css',
    'src/pages/VehicleTimelinePage.tsx',
    'src/pages/VehicleTimelinePage.css',
    'migrations/vehicle_timeline.sql'
  ];
  
  let allFilesExist = true;
  
  for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    
    if (fs.existsSync(filePath)) {
      console.log(chalk.green(`✅ Found: ${file}`));
    } else {
      console.log(chalk.red(`❌ Missing: ${file}`));
      allFilesExist = false;
      results.errors.push(`Missing required file: ${file}`);
    }
  }
  
  if (allFilesExist) {
    results.passed++;
    console.log(chalk.green('✅ All required files are present'));
  } else {
    results.failed++;
    console.log(chalk.red('❌ Some required files are missing'));
  }
}

/**
 * Test database structure
 */
async function testDatabaseStructure(results) {
  console.log(chalk.blue('\n🔍 Checking database structure...'));
  
  try {
    // Check if vehicle_timeline_events table exists
    const { data: tableInfo, error: tableError } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (tableError) {
      if (tableError.code === '42P01') { // Table doesn't exist
        console.log(chalk.yellow('⚠️ vehicle_timeline_events table does not exist yet'));
        console.log(chalk.blue('Running migration to create it...'));
        
        try {
          // Run the SQL migration file
          const migrationPath = path.join(rootDir, 'migrations/vehicle_timeline.sql');
          const migrationSql = fs.readFileSync(migrationPath, 'utf8');
          
          // Split the migration into individual statements
          const statements = migrationSql.split(';').filter(stmt => stmt.trim());
          
          // Execute each statement
          for (const stmt of statements) {
            const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
            if (error) throw error;
          }
          
          console.log(chalk.green('✅ Migration successful'));
          results.passed++;
        } catch (migrationError) {
          console.log(chalk.red('❌ Migration failed'));
          console.error(migrationError);
          results.failed++;
          results.errors.push(`Database migration failed: ${migrationError.message}`);
        }
      } else {
        console.log(chalk.red('❌ Error checking database structure'));
        console.error(tableError);
        results.failed++;
        results.errors.push(`Database structure check failed: ${tableError.message}`);
      }
    } else {
      console.log(chalk.green('✅ vehicle_timeline_events table exists'));
      results.passed++;
    }
  } catch (error) {
    console.log(chalk.red('❌ Database structure test failed'));
    console.error(error);
    results.failed++;
    results.errors.push(`Database structure test failed: ${error.message}`);
  }
}

/**
 * Seed test data
 */
async function seedTestData(results) {
  console.log(chalk.blue('\n🔍 Seeding test data...'));
  
  try {
    // First, check if we have a test vehicle
    let { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, vin, make, model, year')
      .eq('vin', 'TEST1234567890TEST')
      .limit(1)
      .single();
    
    // Create test vehicle if it doesn't exist
    if (vehicleError && vehicleError.code === 'PGRST116') {
      const { data: newVehicle, error: createError } = await supabase
        .from('vehicles')
        .insert({
          vin: 'TEST1234567890TEST',
          make: 'Test',
          model: 'Timeline',
          year: 2025,
          status: 'active'
        })
        .select()
        .single();
      
      if (createError) {
        console.log(chalk.red('❌ Failed to create test vehicle'));
        results.failed++;
        results.errors.push(`Test data seeding failed: ${createError.message}`);
        return;
      }
      
      vehicle = newVehicle;
      console.log(chalk.green('✅ Created test vehicle'));
    } else if (vehicleError) {
      console.log(chalk.red('❌ Error looking up test vehicle'));
      results.failed++;
      results.errors.push(`Test data seeding failed: ${vehicleError.message}`);
      return;
    } else {
      console.log(chalk.green('✅ Test vehicle already exists'));
    }
    
    // Add timeline events for test vehicle
    const timeline_events = [
      {
        vehicle_id: vehicle.id,
        event_type: 'Manufactured',
        source: 'Test Source',
        event_date: '2025-01-01T00:00:00Z',
        title: 'Vehicle Manufactured',
        description: 'Test vehicle was manufactured',
        confidence_score: 95,
        metadata: { factory: 'Test Factory', location: 'Test City' }
      },
      {
        vehicle_id: vehicle.id,
        event_type: 'Sold',
        source: 'Test Source',
        event_date: '2025-02-15T00:00:00Z',
        title: 'Vehicle Sold',
        description: 'Test vehicle was sold to first owner',
        confidence_score: 90,
        metadata: { price: '50000', dealership: 'Test Dealer' }
      },
      {
        vehicle_id: vehicle.id,
        event_type: 'Service',
        source: 'Test Source',
        event_date: '2025-03-01T00:00:00Z',
        title: 'First Service',
        description: 'First maintenance service',
        confidence_score: 85,
        metadata: { mileage: '1000', service_type: 'Oil Change' }
      }
    ];
    
    // First clean any existing events
    await supabase
      .from('vehicle_timeline_events')
      .delete()
      .eq('vehicle_id', vehicle.id);
    
    // Insert new events
    const { error: insertError } = await supabase
      .from('vehicle_timeline_events')
      .insert(timeline_events);
    
    if (insertError) {
      console.log(chalk.red('❌ Failed to insert timeline events'));
      console.error(insertError);
      results.failed++;
      results.errors.push(`Test data seeding failed: ${insertError.message}`);
    } else {
      console.log(chalk.green('✅ Added timeline events for test vehicle'));
      results.passed++;
    }
  } catch (error) {
    console.log(chalk.red('❌ Test data seeding failed'));
    console.error(error);
    results.failed++;
    results.errors.push(`Test data seeding failed: ${error.message}`);
  }
}

/**
 * Test component rendering (mock test)
 */
async function testComponentRendering(results) {
  console.log(chalk.blue('\n🔍 Testing component rendering...'));
  
  try {
    // Create a simple test React component
    const testComponentPath = path.join(rootDir, 'src/tests/TimelineComponentTest.tsx');
    const testComponentDir = path.dirname(testComponentPath);
    
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testComponentDir)) {
      fs.mkdirSync(testComponentDir, { recursive: true });
    }
    
    // Create test component
    const testComponent = `
import React from 'react';
import VehicleTimeline from '../components/VehicleTimeline';

export default function TimelineComponentTest() {
  return (
    <div>
      <h1>Vehicle Timeline Test</h1>
      <VehicleTimeline vin="TEST1234567890TEST" />
    </div>
  );
}
`;
    
    fs.writeFileSync(testComponentPath, testComponent);
    console.log(chalk.green('✅ Created test component'));
    
    // Check TypeScript compilation
    try {
      execSync('npx tsc --noEmit', { cwd: rootDir, stdio: 'pipe' });
      console.log(chalk.green('✅ TypeScript compilation successful'));
      results.passed++;
    } catch (compileError) {
      console.log(chalk.red('❌ TypeScript compilation failed'));
      console.error(compileError.stdout.toString());
      results.failed++;
      results.errors.push(`Component rendering test failed: TypeScript errors`);
    }
    
    // Cleanup
    if (fs.existsSync(testComponentPath)) {
      fs.unlinkSync(testComponentPath);
    }
  } catch (error) {
    console.log(chalk.red('❌ Component rendering test failed'));
    console.error(error);
    results.failed++;
    results.errors.push(`Component rendering test failed: ${error.message}`);
  }
}

/**
 * Test connector functionality
 */
async function testConnectorFunctionality(results) {
  console.log(chalk.blue('\n🔍 Testing connector functionality...'));
  
  try {
    // Test query to get vehicle timeline events
    const { data: events, error: queryError } = await supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('vehicle_id', (await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', 'TEST1234567890TEST')
        .single()).data.id);
    
    if (queryError) {
      console.log(chalk.red('❌ Failed to query timeline events'));
      console.error(queryError);
      results.failed++;
      results.errors.push(`Connector functionality test failed: ${queryError.message}`);
      return;
    }
    
    if (events && events.length > 0) {
      console.log(chalk.green(`✅ Successfully retrieved ${events.length} timeline events`));
      console.log(chalk.gray(`Sample event: ${JSON.stringify(events[0], null, 2)}`));
      results.passed++;
    } else {
      console.log(chalk.yellow('⚠️ Timeline events query returned empty result'));
      results.failed++;
      results.errors.push('Connector functionality test failed: No events found');
    }
  } catch (error) {
    console.log(chalk.red('❌ Connector functionality test failed'));
    console.error(error);
    results.failed++;
    results.errors.push(`Connector functionality test failed: ${error.message}`);
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData(results) {
  console.log(chalk.blue('\n🔍 Cleaning up test data...'));
  
  try {
    // Get test vehicle ID
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', 'TEST1234567890TEST')
      .single();
    
    if (vehicleError) {
      console.log(chalk.yellow('⚠️ Test vehicle not found during cleanup'));
      return;
    }
    
    // Delete timeline events for test vehicle
    const { error: deleteEventsError } = await supabase
      .from('vehicle_timeline_events')
      .delete()
      .eq('vehicle_id', vehicle.id);
    
    if (deleteEventsError) {
      console.log(chalk.red('❌ Failed to delete test timeline events'));
      console.error(deleteEventsError);
      results.errors.push(`Test data cleanup failed: ${deleteEventsError.message}`);
    } else {
      console.log(chalk.green('✅ Deleted test timeline events'));
    }
    
    // Delete test vehicle
    const { error: deleteVehicleError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicle.id);
    
    if (deleteVehicleError) {
      console.log(chalk.red('❌ Failed to delete test vehicle'));
      console.error(deleteVehicleError);
      results.errors.push(`Test data cleanup failed: ${deleteVehicleError.message}`);
    } else {
      console.log(chalk.green('✅ Deleted test vehicle'));
      results.passed++;
    }
  } catch (error) {
    console.log(chalk.red('❌ Test data cleanup failed'));
    console.error(error);
    results.errors.push(`Test data cleanup failed: ${error.message}`);
  }
}

// Run the tests
runTests().catch(error => {
  console.error(chalk.red('❌ Test script failed with an unexpected error:'));
  console.error(error);
  process.exit(1);
});

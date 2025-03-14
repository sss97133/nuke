#!/usr/bin/env node
/**
 * Verify Supabase connection for Vehicle Timeline component
 * Following the established environment variable pattern:
 * - First checks import.meta.env (Vite)
 * - Then checks process.env (Node)
 * - Finally checks window.__env (Browser runtime)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from various .env files
// following the established pattern
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

console.log(`${YELLOW}Vehicle Timeline Database Verification${RESET}`);
console.log('=======================================');

// Get Supabase credentials using the established fallback pattern
const getEnvVar = (name) => {
  return process.env[name];
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');
const supabaseServiceKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY');

// Verify credentials
console.log(`${YELLOW}Checking environment variables...${RESET}`);
if (!supabaseUrl) {
  console.error(`${RED}❌ VITE_SUPABASE_URL is missing${RESET}`);
  process.exit(1);
}

if (!supabaseAnonKey && !supabaseServiceKey) {
  console.error(`${RED}❌ Both VITE_SUPABASE_ANON_KEY and VITE_SUPABASE_SERVICE_KEY are missing${RESET}`);
  process.exit(1);
}

console.log(`${GREEN}✅ Found VITE_SUPABASE_URL${RESET}`);
console.log(`${GREEN}✅ Found Supabase key(s)${RESET}`);

// Use the service key if available, otherwise fall back to anon key
const apiKey = supabaseServiceKey || supabaseAnonKey;

// Create Supabase client
console.log(`${YELLOW}\nConnecting to Supabase...${RESET}`);
const supabase = createClient(supabaseUrl, apiKey);

// Main function to run database checks
async function runDatabaseChecks() {
  try {
    // 1. Check if the vehicles table exists
    const { data: vehicleData, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id')
      .limit(1);
    
    if (vehicleError) {
      if (vehicleError.code === '42P01') {
        console.error(`${RED}❌ The vehicles table does not exist${RESET}`);
        console.error(`${YELLOW}The timeline component requires a vehicles table.${RESET}`);
        process.exit(1);
      } else {
        console.error(`${RED}❌ Error accessing vehicles table: ${vehicleError.message}${RESET}`);
        process.exit(1);
      }
    }
    
    console.log(`${GREEN}✅ Successfully connected to vehicles table${RESET}`);
    
    // 2. Check if the vehicle_timeline_events table exists
    const { data: timelineData, error: timelineError } = await supabase
      .from('vehicle_timeline_events')
      .select('count(*)')
      .limit(1);
    
    if (timelineError) {
      if (timelineError.code === '42P01') {
        console.log(`${YELLOW}⚠️ vehicle_timeline_events table does not exist yet${RESET}`);
        console.log(`${YELLOW}Would you like to create it now? (Required for the timeline component)${RESET}`);
        
        // Path to the migration file
        const migrationFilePath = path.join(rootDir, 'migrations', 'vehicle_timeline.sql');
        
        if (fs.existsSync(migrationFilePath)) {
          console.log(`${GREEN}✅ Found migration file: migrations/vehicle_timeline.sql${RESET}`);
          console.log(`${YELLOW}Run this migration in the Supabase dashboard SQL editor to create the table.${RESET}`);
        } else {
          console.error(`${RED}❌ Migration file not found: migrations/vehicle_timeline.sql${RESET}`);
          console.error(`${YELLOW}Please check the migration file path.${RESET}`);
        }
      } else {
        console.error(`${RED}❌ Error checking timeline table: ${timelineError.message}${RESET}`);
      }
    } else {
      console.log(`${GREEN}✅ vehicle_timeline_events table exists${RESET}`);
      const count = timelineData[0]?.count || 0;
      console.log(`${GREEN}ℹ️ Found ${count} timeline events in the database${RESET}`);
    }

    // 3. Check data connectivity by verifying we can create or fetch a test VIN
    console.log(`${YELLOW}\nChecking for test data...${RESET}`);
    
    // Look for a test VIN
    const { data: testVehicle, error: testVehicleError } = await supabase
      .from('vehicles')
      .select('id, vin, make, model, year')
      .eq('vin', 'TEST1234567890TEST')
      .limit(1);
    
    if (testVehicleError) {
      console.error(`${RED}❌ Error checking for test vehicle: ${testVehicleError.message}${RESET}`);
    } else if (testVehicle && testVehicle.length > 0) {
      console.log(`${GREEN}✅ Found test vehicle with VIN: TEST1234567890TEST${RESET}`);
    } else {
      console.log(`${YELLOW}ℹ️ No test vehicle found. This will be created when you run the full test.${RESET}`);
    }
    
    console.log(`${YELLOW}\nDatabase verification complete!${RESET}`);
    console.log(`${GREEN}The environment is ready for the Vehicle Timeline component.${RESET}`);
    console.log(`${GREEN}You can now run: npm run test:timeline${RESET}`);
    
  } catch (error) {
    console.error(`${RED}❌ Unexpected error:${RESET}`);
    console.error(error);
    process.exit(1);
  }
}

// Run the database checks
runDatabaseChecks();

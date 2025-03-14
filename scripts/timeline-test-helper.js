#!/usr/bin/env node
/**
 * Timeline Test Helper
 * 
 * This script provides utility functions for testing the Vehicle Timeline component.
 * It handles environment setup, testing database seeding, and verification of timeline functionality.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Define color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Load environment variables with the three-tier fallback mechanism
 */
function loadEnvironment() {
  console.log(`${YELLOW}Loading environment variables...${RESET}`);
  
  // Try loading from all possible env files
  // Order matters - .env.test should take precedence for testing
  const envFiles = [
    '.env.test',
    '.env',
    '.env.local',
    '.env.development'
  ];
  
  let envLoaded = false;
  
  envFiles.forEach(file => {
    const envPath = path.join(rootDir, file);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`${GREEN}✓ Loaded environment from ${file}${RESET}`);
      envLoaded = true;
    }
  });
  
  if (!envLoaded) {
    console.log(`${YELLOW}⚠️ No environment files found. Using existing environment variables.${RESET}`);
  }
  
  // Print the loaded environment variables (without exposing secrets)
  console.log(`${YELLOW}Environment variables:${RESET}`);
  ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_SERVICE_KEY'].forEach(varName => {
    const value = getEnvVar(varName);
    console.log(`${CYAN}${varName}:${RESET} ${value ? '✓ Set' : '✗ Not set'}`);
  });
}

/**
 * Get environment variable using the established fallback pattern
 */
function getEnvVar(name) {
  // Following the three-tier fallback mechanism:
  // First check import.meta.env (Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
    return import.meta.env[name];
  }
  // Then check process.env (Node)
  if (process.env && process.env[name]) {
    return process.env[name];
  }
  // Finally check window.__env (Browser runtime)
  if (typeof window !== 'undefined' && window.__env && window.__env[name]) {
    return window.__env[name];
  }
  return undefined;
}

/**
 * Initialize Supabase client
 */
function initSupabase() {
  const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
  const supabaseKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY') || getEnvVar('VITE_SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${RED}❌ Missing required Supabase credentials${RESET}`);
    console.error(`Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY (or VITE_SUPABASE_ANON_KEY) are set`);
    return null;
  }
  
  try {
    const client = createClient(supabaseUrl, supabaseKey);
    console.log(`${GREEN}✓ Supabase client initialized${RESET}`);
    return client;
  } catch (error) {
    console.error(`${RED}❌ Failed to initialize Supabase client:${RESET}`, error);
    return null;
  }
}

/**
 * Check if the vehicle timeline table exists
 */
async function checkTimelineTable(supabase) {
  console.log(`${YELLOW}Checking vehicle_timeline_events table...${RESET}`);
  
  try {
    const { data, error } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    console.log(`${GREEN}✓ vehicle_timeline_events table exists${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}❌ vehicle_timeline_events table not found:${RESET}`, error.message);
    return false;
  }
}

/**
 * Create test vehicle if needed
 */
async function ensureTestVehicle(supabase) {
  console.log(`${YELLOW}Checking for test vehicle...${RESET}`);
  
  const testVehicleVin = 'TEST12345678901234';
  
  try {
    // Check if test vehicle exists
    const { data: existingVehicle, error: queryError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', testVehicleVin)
      .maybeSingle();
    
    if (queryError) {
      throw queryError;
    }
    
    if (existingVehicle) {
      console.log(`${GREEN}✓ Test vehicle already exists with ID: ${existingVehicle.id}${RESET}`);
      return existingVehicle.id;
    }
    
    // Create test vehicle
    const { data: newVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert({
        vin: testVehicleVin,
        make: 'Test',
        model: 'Timeline Tester',
        year: 2024,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError) {
      throw insertError;
    }
    
    console.log(`${GREEN}✓ Created test vehicle with ID: ${newVehicle.id}${RESET}`);
    return newVehicle.id;
  } catch (error) {
    console.error(`${RED}❌ Failed to ensure test vehicle:${RESET}`, error.message);
    return null;
  }
}

/**
 * Seed test timeline events
 */
async function seedTimelineEvents(supabase, vehicleId) {
  console.log(`${YELLOW}Seeding timeline events for test vehicle...${RESET}`);
  
  if (!vehicleId) {
    console.error(`${RED}❌ Cannot seed timeline events: No vehicle ID provided${RESET}`);
    return false;
  }
  
  // Sample timeline events from different sources
  const testEvents = [
    {
      vehicle_id: vehicleId,
      event_type: 'manufacture',
      source: 'vin_database',
      event_date: '2024-01-15T00:00:00Z',
      title: 'Vehicle Manufactured',
      description: 'Test Timeline Tester manufactured for testing purposes',
      confidence_score: 90,
      metadata: { manufacturer_location: 'Test Facility' },
      created_at: new Date().toISOString()
    },
    {
      vehicle_id: vehicleId,
      event_type: 'ownership_change',
      source: 'user_submitted',
      event_date: '2024-02-01T00:00:00Z',
      title: 'Initial Ownership',
      description: 'Vehicle acquired by Nuke Testing Department',
      confidence_score: 80,
      metadata: { previous_owner: null, new_owner: 'Nuke Testing' },
      created_at: new Date().toISOString()
    },
    {
      vehicle_id: vehicleId,
      event_type: 'verification',
      source: 'ptz_verification',
      event_date: '2024-02-15T10:30:00Z',
      title: 'Verification Completed',
      description: 'Vehicle verified at Nuke PTZ Center',
      confidence_score: 95,
      metadata: { 
        verification_id: 'PTZ-TEST-001',
        condition_score: 9.8
      },
      created_at: new Date().toISOString()
    }
  ];
  
  try {
    // Check if events already exist
    const { data: existingEvents, error: queryError } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .eq('vehicle_id', vehicleId);
    
    if (queryError) {
      throw queryError;
    }
    
    if (existingEvents && existingEvents.length > 0) {
      console.log(`${GREEN}✓ Timeline already contains ${existingEvents.length} events for this vehicle${RESET}`);
      return true;
    }
    
    // Insert test events
    const { data, error: insertError } = await supabase
      .from('vehicle_timeline_events')
      .insert(testEvents)
      .select();
    
    if (insertError) {
      throw insertError;
    }
    
    console.log(`${GREEN}✓ Successfully seeded ${data.length} timeline events${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}❌ Failed to seed timeline events:${RESET}`, error.message);
    return false;
  }
}

/**
 * Verify timeline component functionality
 */
async function verifyTimelineComponent() {
  console.log(`${YELLOW}Verifying timeline component files...${RESET}`);
  
  const requiredFiles = [
    'src/components/VehicleTimeline/index.tsx',
    'src/components/VehicleTimeline/useTimelineActions.ts',
    'src/components/VehicleTimeline/TimelineEvent.tsx'
  ];
  
  let allFilesExist = true;
  
  for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`${GREEN}✓ Found:${RESET} ${file}`);
    } else {
      console.log(`${RED}✗ Missing:${RESET} ${file}`);
      allFilesExist = false;
    }
  }
  
  return allFilesExist;
}

/**
 * Run the entire timeline test process
 */
async function runTimelineTest() {
  console.log(`${YELLOW}========================================${RESET}`);
  console.log(`${YELLOW}Vehicle Timeline Component Test${RESET}`);
  console.log(`${YELLOW}========================================${RESET}`);
  
  // Load environment variables
  loadEnvironment();
  
  // Initialize Supabase client
  const supabase = initSupabase();
  if (!supabase) {
    process.exit(1);
  }
  
  // Verify timeline table exists
  const tableExists = await checkTimelineTable(supabase);
  if (!tableExists) {
    console.log(`${YELLOW}Suggestion: Run timeline migration first with 'node scripts/run-timeline-migration.js'${RESET}`);
    process.exit(1);
  }
  
  // Create test vehicle if needed
  const vehicleId = await ensureTestVehicle(supabase);
  if (!vehicleId) {
    process.exit(1);
  }
  
  // Seed timeline events
  const eventsSeedingSuccessful = await seedTimelineEvents(supabase, vehicleId);
  if (!eventsSeedingSuccessful) {
    process.exit(1);
  }
  
  // Verify timeline component
  const componentVerified = await verifyTimelineComponent();
  if (!componentVerified) {
    console.log(`${RED}❌ Timeline component files are missing or incomplete${RESET}`);
    process.exit(1);
  }
  
  console.log(`${YELLOW}========================================${RESET}`);
  console.log(`${GREEN}✓ Timeline test setup complete!${RESET}`);
  console.log(`${GREEN}✓ Test vehicle ID: ${vehicleId}${RESET}`);
  console.log(`${YELLOW}========================================${RESET}`);
  console.log(`${CYAN}To test the timeline in your app:${RESET}`);
  console.log(`1. Use this vehicle ID in your application`);
  console.log(`2. Navigate to the vehicle detail page`);
  console.log(`3. Verify that the timeline displays the test events`);
  
  process.exit(0);
}

// Run the test
runTimelineTest();

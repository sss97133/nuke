#!/usr/bin/env node

/**
 * Seed Timeline Events from Extracted Vehicle Data
 * 
 * This script takes extracted vehicle data from BaT and seeds it into the timeline tables,
 * using the admin functions that bypass RLS for testing purposes.
 * 
 * Usage:
 *   node scripts/seed-timeline-from-file.js --file=data/1988-gmc-suburban-3.json --vin=1GKEV16K4JF504317
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import readline from 'readline';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// Global variables
let supabase;

/**
 * Load environment variables with the three-tier fallback mechanism
 */
function loadEnvironment() {
  console.log(`${YELLOW}Loading environment variables...${RESET}`);
  
  const envFiles = [
    '.env.test',
    '.env',
    '.env.local',
    '.env.development'
  ];
  
  // Try to load environment variables from various .env files
  envFiles.forEach(file => {
    try {
      dotenv.config({ path: file });
      console.log(`${GREEN}✓ Attempting to load environment from ${file}${RESET}`);
    } catch (error) {
      console.log(`${YELLOW}Could not load ${file}: ${error.message}${RESET}`);
    }
  });
  
  // Also try loading with no path specified (default behavior)
  try {
    dotenv.config();
  } catch (error) {
    console.log(`${YELLOW}Could not load default .env: ${error.message}${RESET}`);
  }
  
  // Check for required environment variables
  console.log(`${YELLOW}Checking environment variables:${RESET}`);
  const requiredVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_SERVICE_KEY'
  ];
  
  let allVarsPresent = true;
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (!value) {
      console.log(`${RED}✗ Missing ${varName}${RESET}`);
      allVarsPresent = false;
    } else {
      console.log(`${varName}: ${GREEN}✓ Set${RESET}`);
    }
  });
  
  if (!allVarsPresent) {
    throw new Error('Missing required environment variables');
  }
}

/**
 * Initialize Supabase client
 * @returns {Object} Supabase client
 */
function initSupabase() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL or key is missing in environment variables');
  }
  
  const client = createClient(supabaseUrl, supabaseKey);
  console.log(`${GREEN}✓ Supabase client initialized${RESET}`);
  return client;
}

/**
 * Prompt for user input
 * @param {string} question - The question to ask
 * @returns {Promise<string>} User input
 */
async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Check if the vehicle timeline table exists
 * @param {Object} supabase - Supabase client
 * @returns {Promise<boolean>} Whether the table exists
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
    console.error(`${RED}✗ vehicle_timeline_events table does not exist or is not accessible${RESET}`);
    console.error(`${RED}Error: ${error.message}${RESET}`);
    console.log(`${YELLOW}Run 'npm run timeline:setup' to create the table${RESET}`);
    return false;
  }
}

/**
 * Check if the admin_create_timeline_events function exists
 * @param {Object} supabase - Supabase client
 * @returns {Promise<boolean>} Whether the function exists
 */
async function checkAdminFunction(supabase) {
  console.log(`${YELLOW}Checking admin_create_timeline_events function...${RESET}`);
  
  try {
    const dummyEvent = {
      event_type: 'test',
      source: 'test',
      event_date: new Date().toISOString(),
      title: 'Test Event',
      description: 'Test event for function check',
      confidence_score: 100,
      metadata: {},
      source_url: 'https://example.com',
      image_urls: []
    };
    
    // Test if the function exists
    const { error } = await supabase.rpc('admin_create_timeline_events', {
      test_events: [dummyEvent],
      test_vehicle_id: '00000000-0000-0000-0000-000000000000'
    });
    
    // If we get an RLS error, the function exists but we don't have permission
    if (error && error.message.includes('policy')) {
      console.log(`${GREEN}✓ admin_create_timeline_events function exists but returned: ${error.message}${RESET}`);
      return true;
    }
    
    // If we get any other error about the function not existing
    if (error && (error.message.includes('function') || error.message.includes('schema'))) {
      console.error(`${RED}✗ admin_create_timeline_events function does not exist${RESET}`);
      console.log(`${YELLOW}Run the SQL script in Supabase SQL Editor:${RESET}`);
      console.log(`${CYAN}File: scripts/create-timeline-events-function.sql${RESET}`);
      return false;
    }
    
    console.log(`${GREEN}✓ admin_create_timeline_events function exists${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}✗ Error checking admin function:${RESET}`, error.message);
    return false;
  }
}

/**
 * Load vehicle data from JSON file
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<Object>} Vehicle data
 */
async function loadVehicleData(filePath) {
  console.log(`${YELLOW}Loading vehicle data from ${filePath}...${RESET}`);
  
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const vehicleData = JSON.parse(data);
    
    console.log(`${GREEN}✓ Loaded vehicle data from ${filePath}${RESET}`);
    console.log(`${YELLOW}Vehicle: ${vehicleData.vehicle.year} ${vehicleData.vehicle.make} ${vehicleData.vehicle.model}${RESET}`);
    console.log(`${YELLOW}Events: ${vehicleData.events.length}${RESET}`);
    
    return vehicleData;
  } catch (error) {
    console.error(`${RED}✗ Error loading vehicle data:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Create or get vehicle ID
 * @param {Object} supabase - Supabase client
 * @param {Object} vehicleData - Vehicle data
 * @param {string} vin - Vehicle Identification Number (optional)
 * @returns {Promise<string>} Vehicle ID
 */
async function createVehicle(supabase, vehicleData, vin) {
  console.log(`${YELLOW}Creating vehicle record...${RESET}`);
  
  try {
    const { vehicle, user_id } = vehicleData;
    
    // Use provided VIN or from vehicle data
    const vehicleVin = vin || vehicle.vin;
    
    if (!vehicleVin) {
      throw new Error('VIN is required. Provide with --vin parameter');
    }
    
    // Check if a vehicle with this VIN already exists
    const { data: existingVehicle, error: queryError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vehicleVin)
      .maybeSingle();
    
    if (queryError) {
      console.log(`${YELLOW}Query error: ${queryError.message}${RESET}`);
    }
    
    // If vehicle exists, return its ID
    if (existingVehicle) {
      console.log(`${GREEN}✓ Vehicle already exists with ID: ${existingVehicle.id}${RESET}`);
      return existingVehicle.id;
    }
    
    console.log(`${YELLOW}No vehicle found with VIN ${vehicleVin}${RESET}`);
    
    // Try to use the admin_create_test_vehicle function
    console.log(`${YELLOW}Trying to create vehicle using admin function...${RESET}`);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_test_vehicle', {
      test_vin: vehicleVin,
      test_user_id: user_id
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
      console.log(`${YELLOW}This error is expected if admin functions are not yet created in your database.${RESET}`);
      console.log(`${YELLOW}Run the SQL script in Supabase SQL Editor to create the admin functions.${RESET}`);
      console.log(`${YELLOW}Trying direct insert (requires RLS bypass)...${RESET}`);
      
      // Try direct insert as fallback
      const { data: insertedVehicle, error: insertError } = await supabase
        .from('vehicles')
        .insert({
          vin: vehicleVin,
          user_id: user_id,
          make: vehicle.make || 'GMC',
          model: vehicle.model || 'Suburban',
          year: vehicle.year || 1988,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select();
      
      if (insertError) {
        if (insertError.message.includes('policy')) {
          console.error(`${RED}✗ RLS policy prevented direct insert${RESET}`);
          console.log(`${YELLOW}You need to create the admin functions in Supabase SQL Editor first${RESET}`);
          throw new Error('Unable to create vehicle due to RLS policy restrictions');
        } else {
          console.error(`${RED}✗ Insert error: ${insertError.message}${RESET}`);
          throw insertError;
        }
      }
      
      console.log(`${GREEN}✓ Vehicle created with ID: ${insertedVehicle[0].id}${RESET}`);
      return insertedVehicle[0].id;
    }
    
    console.log(`${GREEN}✓ Vehicle created with ID: ${rpcResult}${RESET}`);
    return rpcResult;
  } catch (error) {
    console.error(`${RED}✗ Error creating vehicle:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Create timeline events
 * @param {Object} supabase - Supabase client
 * @param {string} vehicleId - Vehicle ID
 * @param {Array} events - Timeline events
 * @returns {Promise<Array>} Created timeline event IDs
 */
async function createTimelineEvents(supabase, vehicleId, events) {
  console.log(`${YELLOW}Creating ${events.length} timeline events...${RESET}`);
  
  try {
    // Update all events with the actual vehicle ID
    const updatedEvents = events.map(event => ({
      ...event,
      vehicle_id: vehicleId
    }));
    
    // Try to use the admin_create_timeline_events function
    console.log(`${YELLOW}Using admin function to bypass RLS...${RESET}`);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_timeline_events', {
      test_events: updatedEvents,
      test_vehicle_id: vehicleId
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
      console.log(`${YELLOW}This error is expected if admin functions are not yet created in your database.${RESET}`);
      console.log(`${YELLOW}Run the SQL script in Supabase SQL Editor to create the admin functions.${RESET}`);
      console.log(`${YELLOW}Trying direct insert (requires RLS bypass)...${RESET}`);
      
      // Try direct insert as fallback
      const { data: insertedEvents, error: insertError } = await supabase
        .from('vehicle_timeline_events')
        .insert(updatedEvents)
        .select();
      
      if (insertError) {
        if (insertError.message.includes('policy')) {
          console.error(`${RED}✗ RLS policy prevented direct insert${RESET}`);
          console.log(`${YELLOW}You need to create the admin functions in Supabase SQL Editor first${RESET}`);
          throw new Error('Unable to create timeline events due to RLS policy restrictions');
        } else {
          console.error(`${RED}✗ Insert error: ${insertError.message}${RESET}`);
          throw insertError;
        }
      }
      
      const eventIds = insertedEvents.map(event => event.id);
      console.log(`${GREEN}✓ Created ${eventIds.length} timeline events${RESET}`);
      return eventIds;
    }
    
    console.log(`${GREEN}✓ Created ${rpcResult.length} timeline events${RESET}`);
    return rpcResult;
  } catch (error) {
    console.error(`${RED}✗ Error creating timeline events:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log(`${YELLOW}===============================================${RESET}`);
  console.log(`${YELLOW}Seed Timeline Events from Extracted Vehicle Data${RESET}`);
  console.log(`${YELLOW}===============================================${RESET}`);
  
  try {
    // Load environment variables
    loadEnvironment();
    
    // Initialize Supabase client
    supabase = initSupabase();
    
    // Get CLI arguments
    const args = process.argv.slice(2);
    let filePath = '';
    let vin = '';
    
    // Parse command line arguments
    args.forEach(arg => {
      if (arg.startsWith('--file=')) {
        filePath = arg.substring(7);
      } else if (arg.startsWith('--vin=')) {
        vin = arg.substring(6);
      }
    });
    
    // Prompt for file path if not provided
    if (!filePath) {
      filePath = await prompt('Enter path to vehicle data JSON file: ');
    }
    
    if (!filePath) {
      console.error(`${RED}✗ File path is required${RESET}`);
      process.exit(1);
    }
    
    // Check if the vehicle_timeline_events table exists
    const tableExists = await checkTimelineTable(supabase);
    if (!tableExists) {
      console.log(`${YELLOW}Please create the vehicle_timeline_events table first${RESET}`);
      process.exit(1);
    }
    
    // Check if the admin function exists
    const functionExists = await checkAdminFunction(supabase);
    if (!functionExists) {
      console.log(`${YELLOW}Please create the admin_create_timeline_events function first${RESET}`);
      console.log(`${YELLOW}Run the script:${RESET}`);
      console.log(`${CYAN}   SQL file: scripts/create-timeline-events-function.sql${RESET}`);
    }
    
    // Load vehicle data from JSON file
    const vehicleData = await loadVehicleData(filePath);
    
    // Prompt for VIN if not provided and not in the vehicle data
    if (!vin && !vehicleData.vehicle.vin) {
      vin = await prompt('Enter vehicle VIN: ');
    }
    
    if (!vin && !vehicleData.vehicle.vin) {
      console.error(`${RED}✗ VIN is required. Provide with --vin parameter or in the vehicle data${RESET}`);
      process.exit(1);
    }
    
    // Create or get vehicle
    const vehicleId = await createVehicle(supabase, vehicleData, vin);
    
    // Create timeline events
    const eventIds = await createTimelineEvents(supabase, vehicleId, vehicleData.events);
    
    console.log(`${GREEN}✓ Timeline events seeded successfully${RESET}`);
    console.log(`${YELLOW}Vehicle ID: ${vehicleId}${RESET}`);
    console.log(`${YELLOW}Event Count: ${eventIds.length}${RESET}`);
    
    // Summarize events by type
    console.log(`${YELLOW}Timeline event types created:${RESET}`);
    const eventTypes = {};
    vehicleData.events.forEach(event => {
      if (!eventTypes[event.event_type]) {
        eventTypes[event.event_type] = 0;
      }
      eventTypes[event.event_type]++;
    });
    
    for (const [type, count] of Object.entries(eventTypes)) {
      console.log(`${CYAN}${type}${RESET}: ${count}`);
    }
    
  } catch (error) {
    console.error(`${RED}✗ Error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

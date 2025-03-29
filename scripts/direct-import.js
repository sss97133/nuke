#!/usr/bin/env node

/**
 * Direct Vehicle Import Script
 * 
 * This script directly imports extracted vehicle data to create real vehicle
 * timeline entries using the already-extracted JSON data.
 * 
 * Usage:
 *   node scripts/direct-import.js --file=data/1988-gmc-suburban-3.json --vin=1GKEV16K4JF504317
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import { exit } from 'process';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// Use environment variables for Supabase configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error(`${RED}✗ Missing required environment variable: VITE_SUPABASE_SERVICE_KEY${RESET}`);
  process.exit(1);
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
 * Check if the table exists
 * @param {Object} supabase - Supabase client
 * @param {string} tableName - Name of the table to check
 * @returns {Promise<boolean>} Whether the table exists
 */
async function checkTable(supabase, tableName) {
  console.log(`${YELLOW}Checking ${tableName} table...${RESET}`);
  
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('id')
      .limit(1);
    
    if (error) {
      console.error(`${RED}✗ Error checking ${tableName} table: ${error.message}${RESET}`);
      return false;
    }
    
    console.log(`${GREEN}✓ ${tableName} table is accessible${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}✗ Error checking ${tableName} table: ${error.message}${RESET}`);
    return false;
  }
}

/**
 * Create or get vehicle ID using direct insert
 * @param {Object} supabase - Supabase client
 * @param {Object} vehicleData - Vehicle data
 * @param {string} vin - Vehicle Identification Number
 * @returns {Promise<string>} Vehicle ID
 */
async function createOrGetVehicle(supabase, vehicleData, vin) {
  console.log(`${YELLOW}Creating or getting vehicle with VIN: ${vin}...${RESET}`);
  
  try {
    const { vehicle, user_id } = vehicleData;
    
    // Check if vehicle already exists
    const { data: existingVehicle, error: queryError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vin)
      .maybeSingle();
    
    if (queryError) {
      console.error(`${RED}✗ Error querying vehicle: ${queryError.message}${RESET}`);
    }
    
    if (existingVehicle) {
      console.log(`${GREEN}✓ Vehicle already exists with ID: ${existingVehicle.id}${RESET}`);
      return existingVehicle.id;
    }
    
    // Try direct insert first
    const insertPayload = {
      vin: vin,
      year: vehicle.year || 1988,
      make: vehicle.make || 'GMC',
      model: vehicle.model || 'Suburban',
      user_id: user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log(`${YELLOW}Attempting direct insert with payload:${RESET}`, insertPayload);
    
    const { data: insertedVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert(insertPayload)
      .select();
    
    if (insertError) {
      if (insertError.message.includes('policy')) {
        console.log(`${YELLOW}RLS policy prevented direct insert. Trying RPC function...${RESET}`);
        
        // Try using the admin function
        const { data: vehicleId, error: rpcError } = await supabase.rpc('admin_create_test_vehicle', {
          test_vin: vin,
          test_user_id: user_id
        });
        
        if (rpcError) {
          console.error(`${RED}✗ Error using admin function: ${rpcError.message}${RESET}`);
          console.log(`${YELLOW}Note: You need to run the SQL scripts in Supabase SQL Editor:${RESET}`);
          console.log(`${CYAN}1. scripts/create-test-vehicle-function.sql${RESET}`);
          console.log(`${CYAN}2. scripts/create-timeline-events-function.sql${RESET}`);
          throw new Error('Could not create vehicle');
        }
        
        console.log(`${GREEN}✓ Vehicle created with ID: ${vehicleId}${RESET}`);
        return vehicleId;
      } else {
        console.error(`${RED}✗ Insert error: ${insertError.message}${RESET}`);
        throw insertError;
      }
    }
    
    console.log(`${GREEN}✓ Vehicle created with ID: ${insertedVehicle[0].id}${RESET}`);
    return insertedVehicle[0].id;
  } catch (error) {
    console.error(`${RED}✗ Error creating vehicle:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Direct insert of timeline events
 * @param {Object} supabase - Supabase client
 * @param {string} vehicleId - Vehicle ID
 * @param {Array} events - Timeline events
 * @returns {Promise<Array>} Created timeline event IDs
 */
async function createTimelineEvents(supabase, vehicleId, events) {
  console.log(`${YELLOW}Creating ${events.length} timeline events...${RESET}`);
  
  try {
    // Update events with the actual vehicle ID
    const updatedEvents = events.map(event => ({
      ...event,
      vehicle_id: vehicleId
    }));
    
    // Try using the admin function first
    console.log(`${YELLOW}Trying admin function first...${RESET}`);
    try {
      const { data: eventIds, error: rpcError } = await supabase.rpc('admin_create_timeline_events', {
        test_events: updatedEvents,
        test_vehicle_id: vehicleId
      });
      
      if (rpcError) {
        console.log(`${YELLOW}RPC error: ${rpcError.message}${RESET}`);
        throw rpcError; // Move to direct insert
      }
      
      console.log(`${GREEN}✓ Created ${eventIds.length} events via admin function${RESET}`);
      return eventIds;
    } catch (rpcError) {
      console.log(`${YELLOW}Falling back to direct insert...${RESET}`);
      
      // Try direct insert
      const { data: insertedEvents, error: insertError } = await supabase
        .from('vehicle_timeline_events')
        .insert(updatedEvents)
        .select();
      
      if (insertError) {
        if (insertError.message.includes('policy')) {
          console.error(`${RED}✗ RLS policy prevented direct insert${RESET}`);
          console.log(`${YELLOW}Note: You need to run the SQL scripts in Supabase SQL Editor:${RESET}`);
          console.log(`${CYAN}1. scripts/create-test-vehicle-function.sql${RESET}`);
          console.log(`${CYAN}2. scripts/create-timeline-events-function.sql${RESET}`);
          throw new Error('Could not create timeline events due to RLS policy restrictions');
        } else {
          console.error(`${RED}✗ Insert error: ${insertError.message}${RESET}`);
          throw insertError;
        }
      }
      
      const eventIds = insertedEvents.map(event => event.id);
      console.log(`${GREEN}✓ Created ${eventIds.length} events via direct insert${RESET}`);
      return eventIds;
    }
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
  console.log(`${YELLOW}Direct Vehicle Data Import${RESET}`);
  console.log(`${YELLOW}===============================================${RESET}`);
  
  try {
    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log(`${GREEN}✓ Initialized Supabase client${RESET}`);
    
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
      exit(1);
    }
    
    // Check if tables exist
    const vehiclesTableExists = await checkTable(supabase, 'vehicles');
    const timelineTableExists = await checkTable(supabase, 'vehicle_timeline_events');
    
    if (!vehiclesTableExists || !timelineTableExists) {
      console.error(`${RED}✗ Required tables do not exist or are not accessible${RESET}`);
      exit(1);
    }
    
    // Load vehicle data
    const vehicleData = await loadVehicleData(filePath);
    
    // Prompt for VIN if not provided
    if (!vin && !vehicleData.vehicle.vin) {
      vin = await prompt('Enter vehicle VIN: ');
    }
    
    if (!vin && !vehicleData.vehicle.vin) {
      console.error(`${RED}✗ VIN is required${RESET}`);
      exit(1);
    }
    
    // Create or get vehicle
    const vehicleId = await createOrGetVehicle(supabase, vehicleData, vin);
    
    // Create timeline events
    const eventIds = await createTimelineEvents(supabase, vehicleId, vehicleData.events);
    
    console.log(`${GREEN}✓ Import completed successfully${RESET}`);
    console.log(`${YELLOW}Vehicle ID: ${vehicleId}${RESET}`);
    console.log(`${YELLOW}Created ${eventIds.length} timeline events${RESET}`);
    
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
    
    console.log(`${GREEN}✓ Completed!${RESET}`);
    console.log(`${YELLOW}Note: You can view this vehicle in the timeline component using the ID:${RESET}`);
    console.log(`${CYAN}${vehicleId}${RESET}`);
    
  } catch (error) {
    console.error(`${RED}✗ Error:${RESET}`, error.message);
    exit(1);
  }
}

// Run the main function
main();

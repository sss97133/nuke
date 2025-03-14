#!/usr/bin/env node

/**
 * Seed Timeline Events
 * 
 * This script seeds the vehicle_timeline_events table directly
 * with events for testing the Timeline component, bypassing the need
 * to create test vehicles with proper RLS policies.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import readline from 'readline';

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

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Load environment variables with the three-tier fallback mechanism
 */
function loadEnvironment() {
  console.log(`${YELLOW}Loading environment variables...${RESET}`);
  
  const envFiles = ['.env.test', '.env', '.env.local', '.env.development'];
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
  
  // Check for required variables
  const requiredVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_SERVICE_KEY'];
  console.log(`${YELLOW}Checking environment variables:${RESET}`);
  
  let missingVars = false;
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    console.log(`${CYAN}${varName}:${RESET} ${value ? '✓ Set' : '✗ Not set'}`);
    if (!value) missingVars = true;
  });
  
  return !missingVars;
}

/**
 * Prompt for user input
 */
function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer);
    });
  });
}

/**
 * Initialize Supabase client
 */
function initSupabase() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error(`${RED}❌ Missing required Supabase credentials${RESET}`);
    return null;
  }
  
  try {
    const client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
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
 * Generate a static demo vehicle ID for testing
 * This avoids the need to create an actual vehicle record which would be subject to RLS
 */
function getDemoVehicleId() {
  // Using a fixed UUID for demo purposes
  return '11111111-1111-1111-1111-111111111111';
}

/**
 * Seed timeline events for testing
 */
async function seedTimelineEvents(supabase) {
  const vehicleId = getDemoVehicleId();
  console.log(`${YELLOW}Using demo vehicle ID: ${vehicleId}${RESET}`);
  
  // First check if we already have events for this demo vehicle
  const { data: existingEvents, error: queryError } = await supabase
    .from('vehicle_timeline_events')
    .select('id')
    .eq('vehicle_id', vehicleId);
    
  if (!queryError && existingEvents && existingEvents.length > 0) {
    console.log(`${GREEN}✓ Timeline events already exist (${existingEvents.length} events found)${RESET}`);
    const clearEvents = await prompt(`Would you like to clear existing events and recreate them? (y/n): `);
    
    if (clearEvents.toLowerCase() === 'y') {
      console.log(`${YELLOW}Clearing existing events...${RESET}`);
      const { error: deleteError } = await supabase
        .from('vehicle_timeline_events')
        .delete()
        .eq('vehicle_id', vehicleId);
        
      if (deleteError) {
        console.error(`${RED}❌ Failed to clear events:${RESET}`, deleteError.message);
        return false;
      }
      console.log(`${GREEN}✓ Existing events cleared${RESET}`);
    } else {
      console.log(`${YELLOW}Keeping existing events${RESET}`);
      return true;
    }
  }
  
  // Sample timeline events from different sources for Digital Vehicle Identity
  console.log(`${YELLOW}Creating timeline events for testing...${RESET}`);
  
  const testEvents = [
    {
      vehicle_id: vehicleId,
      event_type: 'manufacture',
      source: 'vin_database',
      event_date: '2022-01-15T00:00:00Z',
      title: 'Vehicle Manufactured',
      description: 'Vehicle manufactured at main assembly plant',
      confidence_score: 95,
      metadata: {
        plant_code: 'MAP-1',
        assembly_line: 'A3'
      },
      source_url: 'https://example.com/vin/records',
      image_urls: ['https://example.com/images/manufacturing.jpg']
    },
    {
      vehicle_id: vehicleId,
      event_type: 'sale',
      source: 'dealership_records',
      event_date: '2022-03-10T00:00:00Z',
      title: 'Initial Sale',
      description: 'Vehicle sold to first owner',
      confidence_score: 90,
      metadata: {
        dealer_id: 'D-12345',
        sale_price: 45000
      },
      source_url: 'https://example.com/sales/records',
      image_urls: ['https://example.com/images/dealership.jpg']
    },
    {
      vehicle_id: vehicleId,
      event_type: 'service',
      source: 'service_records',
      event_date: '2022-06-22T00:00:00Z',
      title: 'Regular Maintenance',
      description: 'Oil change and routine inspection',
      confidence_score: 85,
      metadata: {
        service_id: 'S-98765',
        mileage: 5000,
        services_performed: ['oil_change', 'tire_rotation', 'inspection']
      },
      source_url: 'https://example.com/service/records',
      image_urls: []
    },
    {
      vehicle_id: vehicleId,
      event_type: 'ownership_transfer',
      source: 'title_records',
      event_date: '2023-02-15T00:00:00Z',
      title: 'Ownership Transfer',
      description: 'Vehicle sold to second owner',
      confidence_score: 92,
      metadata: {
        transfer_id: 'T-24680',
        sale_price: 42000
      },
      source_url: 'https://example.com/title/records',
      image_urls: ['https://example.com/images/title_transfer.jpg']
    },
    {
      vehicle_id: vehicleId,
      event_type: 'accident',
      source: 'insurance_records',
      event_date: '2023-07-08T00:00:00Z',
      title: 'Minor Accident',
      description: 'Front bumper damage in parking lot',
      confidence_score: 80,
      metadata: {
        claim_id: 'C-13579',
        damage_estimate: 1800,
        repaired: true
      },
      source_url: 'https://example.com/insurance/claims',
      image_urls: ['https://example.com/images/minor_damage.jpg', 'https://example.com/images/repair_complete.jpg']
    },
    {
      vehicle_id: vehicleId,
      event_type: 'modification',
      source: 'aftermarket_records',
      event_date: '2023-09-01T00:00:00Z',
      title: 'Performance Upgrades',
      description: 'Enhanced suspension and exhaust system',
      confidence_score: 75,
      metadata: {
        shop_id: 'AS-11223',
        parts: ['sport_suspension', 'performance_exhaust'],
        cost: 3500
      },
      source_url: 'https://example.com/aftermarket/mods',
      image_urls: ['https://example.com/images/suspension_upgrade.jpg', 'https://example.com/images/exhaust_upgrade.jpg']
    },
    {
      vehicle_id: vehicleId,
      event_type: 'listing',
      source: 'bat_auction',
      event_date: '2024-01-05T00:00:00Z',
      title: 'Bring a Trailer Auction Listing',
      description: 'Vehicle listed for auction on Bring a Trailer',
      confidence_score: 98,
      metadata: {
        auction_id: 'BAT-112233',
        reserve_price: 35000,
        highlights: ['low_mileage', 'service_records', 'modifications']
      },
      source_url: 'https://bringatrailer.com/listing/example-vehicle',
      image_urls: ['https://example.com/images/auction_listing_1.jpg', 'https://example.com/images/auction_listing_2.jpg']
    }
  ];
  
  // Try using the admin_create_timeline_events RPC function first to bypass RLS
  console.log(`${YELLOW}Trying to use admin function to bypass RLS...${RESET}`);
  
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_timeline_events', {
      test_events: testEvents,
      test_vehicle_id: vehicleId
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
      console.log(`${YELLOW}Trying default events via RPC...${RESET}`);
      
      // Try calling the function with no arguments to use default events
      const { data: defaultResult, error: defaultError } = await supabase.rpc('admin_create_timeline_events');
      
      if (defaultError) {
        console.error(`${RED}❌ RPC method failed:${RESET}`, defaultError.message);
        console.log(`${YELLOW}\nImportant: You need to run the SQL in the manual-timeline-setup.sql file to create the admin function.${RESET}`);
        console.log(`${YELLOW}1. Go to your Supabase SQL Editor${RESET}`);
        console.log(`${YELLOW}2. Run the SQL from the scripts/manual-timeline-setup.sql file${RESET}`);
        console.log(`${YELLOW}3. Run this seeding script again${RESET}`);
        return false;
      }
      
      console.log(`${GREEN}✓ Successfully created default timeline events via RPC${RESET}`);
      
      // List the default events we created
      console.log(`${YELLOW}Default timeline events created (3 standard events)${RESET}`);
      console.log(`- ${CYAN}manufacture${RESET}: Vehicle Manufactured (vin_database)`);
      console.log(`- ${CYAN}sale${RESET}: Initial Sale (dealership_records)`);
      console.log(`- ${CYAN}service${RESET}: Regular Maintenance (service_records)`);
      return true;
    }
    
    console.log(`${GREEN}✓ Successfully created ${rpcResult.length} timeline events via RPC${RESET}`);
    
    // List all the events we've created
    console.log(`${YELLOW}Timeline event types created:${RESET}`);
    testEvents.forEach(event => {
      console.log(`- ${CYAN}${event.event_type}${RESET}: ${event.title} (${event.source})`);
    });
    return true;
  } catch (rpcFail) {
    console.log(`${YELLOW}RPC approach failed, trying direct insert...${RESET}`);
    
    // Fallback to direct insert, which might still fail due to RLS
    const { data: insertedEvents, error: insertError } = await supabase
      .from('vehicle_timeline_events')
      .insert(testEvents)
      .select();
    
    if (insertError) {
      console.error(`${RED}❌ Failed to seed timeline events:${RESET}`, insertError.message);
      console.log(`${YELLOW}\nImportant: You need to run the SQL in the manual-timeline-setup.sql file to create the admin function.${RESET}`);
      console.log(`${YELLOW}1. Go to your Supabase SQL Editor${RESET}`);
      console.log(`${YELLOW}2. Run the SQL from the scripts/manual-timeline-setup.sql file${RESET}`);
      console.log(`${YELLOW}3. Run this seeding script again${RESET}`);
      return false;
    }
    
    console.log(`${GREEN}✓ Successfully seeded ${insertedEvents.length} timeline events${RESET}`);
    
    // List all the events we've created
    console.log(`${YELLOW}Timeline event types created:${RESET}`);
    testEvents.forEach(event => {
      console.log(`- ${CYAN}${event.event_type}${RESET}: ${event.title} (${event.source})`);
    });
  }
  
  return true;
}

/**
 * Main function to run the seeding process
 */
async function runSeedProcess() {
  console.log(`${YELLOW}========================================${RESET}`);
  console.log(`${YELLOW}Vehicle Timeline Events Seeder${RESET}`);
  console.log(`${YELLOW}========================================${RESET}`);
  
  try {
    // Load environment variables
    if (!loadEnvironment()) {
      console.error(`${RED}❌ Missing required environment variables${RESET}`);
      rl.close();
      process.exit(1);
    }
    
    // Initialize Supabase
    const supabase = initSupabase();
    if (!supabase) {
      rl.close();
      process.exit(1);
    }
    
    // Check if timeline table exists
    const tableExists = await checkTimelineTable(supabase);
    if (!tableExists) {
      console.error(`${RED}❌ Timeline table doesn't exist. Please run the migration first.${RESET}`);
      rl.close();
      process.exit(1);
    }
    
    // Seed timeline events
    const success = await seedTimelineEvents(supabase);
    
    if (success) {
      console.log(`\n${GREEN}✓ Vehicle timeline events have been successfully seeded for testing${RESET}`);
      console.log(`${YELLOW}You can now test the timeline component with these events${RESET}`);
    } else {
      console.error(`${RED}❌ Failed to seed timeline events${RESET}`);
    }
    
    rl.close();
    
  } catch (error) {
    console.error(`${RED}❌ Unexpected error:${RESET}`, error);
    rl.close();
    process.exit(1);
  }
}

// Run the seed process
runSeedProcess();

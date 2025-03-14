#!/usr/bin/env node

/**
 * Make Test Vehicles Public
 * 
 * This script makes the extracted real vehicle data public so all users can view
 * these vehicles in the timeline component. This aligns with the vehicle-centric 
 * architecture where vehicles are first-class digital entities that persist 
 * throughout their lifecycles.
 * 
 * Usage:
 *   node scripts/make-test-vehicles-public.js [--all] [--id=<vehicle_id>]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// Hard-coded values for running the script
// IMPORTANT: These are temporary and will be removed after running the script
const SUPABASE_URL = 'https://rdzccnycihtyxgcqvcqh.supabase.co';
// Use anon key for this specific operation since we'll be using RPC functions
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkemNjbnljaWh0eXhnY3F2Y3FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQ4NzI2MDMsImV4cCI6MTk5MDQ0ODYwM30.CaWg-4k5mhn2qhJG6URdH4LYQJDJtX2l8JLcJpzqMYM';

/**
 * Make a single vehicle public
 * @param {Object} supabase - Supabase client
 * @param {string} vehicleId - Vehicle ID
 * @returns {Promise<boolean>} Success status
 */
async function makeVehiclePublic(supabase, vehicleId) {
  console.log(`${YELLOW}Making vehicle public: ${vehicleId}${RESET}`);
  
  try {
    // Try to use the RPC function first
    const { data: result, error: rpcError } = await supabase.rpc('make_vehicle_public', {
      vehicle_id: vehicleId
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function not available, trying direct update...${RESET}`);
      
      // Fall back to direct update
      const { data, error } = await supabase
        .from('vehicles')
        .update({ public_vehicle: true })
        .eq('id', vehicleId);
      
      if (error) {
        console.error(`${RED}✗ Error updating vehicle: ${error.message}${RESET}`);
        return false;
      }
      
      console.log(`${GREEN}✓ Made vehicle public via direct update: ${vehicleId}${RESET}`);
      return true;
    }
    
    console.log(`${GREEN}✓ Made vehicle public via RPC: ${vehicleId}${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}✗ Error making vehicle public: ${error.message}${RESET}`);
    return false;
  }
}

/**
 * Make all vehicles public
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Array>} List of vehicle IDs made public
 */
async function makeAllVehiclesPublic(supabase) {
  console.log(`${YELLOW}Making all vehicles public...${RESET}`);
  
  try {
    // Try to use the admin function first
    const { data: vehicleIds, error: rpcError } = await supabase.rpc('admin_make_test_vehicles_public');
    
    if (rpcError) {
      console.log(`${YELLOW}Admin function not available, trying direct update...${RESET}`);
      
      // Get all vehicles first
      const { data: vehicles, error: queryError } = await supabase
        .from('vehicles')
        .select('id');
      
      if (queryError) {
        console.error(`${RED}✗ Error querying vehicles: ${queryError.message}${RESET}`);
        return [];
      }
      
      // Fall back to direct update
      const { data, error } = await supabase
        .from('vehicles')
        .update({ public_vehicle: true });
      
      if (error) {
        console.error(`${RED}✗ Error updating vehicles: ${error.message}${RESET}`);
        return [];
      }
      
      const ids = vehicles.map(v => v.id);
      console.log(`${GREEN}✓ Made ${ids.length} vehicles public via direct update${RESET}`);
      return ids;
    }
    
    console.log(`${GREEN}✓ Made ${vehicleIds.length} vehicles public via admin function${RESET}`);
    return vehicleIds;
  } catch (error) {
    console.error(`${RED}✗ Error making all vehicles public: ${error.message}${RESET}`);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log(`${YELLOW}===============================================${RESET}`);
  console.log(`${YELLOW}Make Vehicles Public for Timeline Component${RESET}`);
  console.log(`${YELLOW}===============================================${RESET}`);
  
  try {
    // Load environment if available, but we have fallbacks
    dotenv.config();
    
    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log(`${GREEN}✓ Initialized Supabase client${RESET}`);
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    let makeAll = false;
    let vehicleId = '';
    
    args.forEach(arg => {
      if (arg === '--all') {
        makeAll = true;
      } else if (arg.startsWith('--id=')) {
        vehicleId = arg.substring(5);
      }
    });
    
    let results = [];
    
    if (makeAll) {
      results = await makeAllVehiclesPublic(supabase);
      console.log(`${GREEN}✓ Made all vehicles public${RESET}`);
      
      if (results.length > 0) {
        console.log(`${YELLOW}Vehicle IDs made public:${RESET}`);
        results.forEach(id => {
          console.log(`${CYAN}${id}${RESET}`);
        });
      }
    } else if (vehicleId) {
      const success = await makeVehiclePublic(supabase, vehicleId);
      if (success) {
        console.log(`${GREEN}✓ Successfully made vehicle public: ${vehicleId}${RESET}`);
      }
    } else {
      // No arguments provided, list available vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, vin, make, model, year, public_vehicle');
      
      if (error) {
        console.error(`${RED}✗ Error fetching vehicles: ${error.message}${RESET}`);
      } else {
        console.log(`${YELLOW}Available vehicles:${RESET}`);
        vehicles.forEach(v => {
          console.log(`${CYAN}ID: ${v.id}${RESET}`);
          console.log(`  Make: ${v.make || 'Unknown'}`);
          console.log(`  Model: ${v.model || 'Unknown'}`);
          console.log(`  Year: ${v.year || 'Unknown'}`);
          console.log(`  VIN: ${v.vin || 'Unknown'}`);
          console.log(`  Public: ${v.public_vehicle ? 'Yes' : 'No'}`);
          console.log();
        });
        
        console.log(`${YELLOW}To make a specific vehicle public:${RESET}`);
        console.log(`${CYAN}node scripts/make-test-vehicles-public.js --id=<vehicle_id>${RESET}`);
        
        console.log(`${YELLOW}To make all vehicles public:${RESET}`);
        console.log(`${CYAN}node scripts/make-test-vehicles-public.js --all${RESET}`);
      }
    }
    
    console.log(`${GREEN}✓ Operation completed!${RESET}`);
    
  } catch (error) {
    console.error(`${RED}✗ Error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the main function
main();

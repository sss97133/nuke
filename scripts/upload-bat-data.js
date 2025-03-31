#!/usr/bin/env node

/**
 * Upload BAT Vehicle Data to Supabase
 * 
 * This script uploads existing Bring a Trailer vehicle data from local JSON files
 * directly to the Supabase database.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory
const DATA_DIR = path.join(__dirname, '../data/bat-vehicles');

// Use environment variables for Supabase configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || '00000000-0000-0000-0000-000000000000';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(`${RED}Error: Missing Supabase credentials${RESET}`);
  console.error(`Please set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY environment variables`);
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Convert raw BAT vehicle data to database format using the exact schema columns
 */
function convertToDbFormat(vehicle) {
  // Using only exact column names found in the actual database
  return {
    user_id: SYSTEM_USER_ID,
    make: vehicle.make || '',
    model: vehicle.model || '',
    year: vehicle.year || null,
    vin: vehicle.vin || null,
    mileage: vehicle.mileage || null,
    color: vehicle.exteriorColor || null,
    body_type: vehicle.bodyType || null,
    engine_type: vehicle.engine || null,
    transmission: vehicle.transmission || null,
    drivetrain: vehicle.drivetrain || null,
    condition: vehicle.condition || null,
    condition_rating: vehicle.condition ? 
      (vehicle.condition.toLowerCase().includes('excellent') ? 5 : 
       vehicle.condition.toLowerCase().includes('very good') ? 4 : 
       vehicle.condition.toLowerCase().includes('good') ? 3 : 
       vehicle.condition.toLowerCase().includes('fair') ? 2 : 1) : null,
    condition_description: vehicle.condition || null,
    notes: vehicle.description || '',
    source: 'Bring a Trailer',
    source_url: vehicle.url || null,
    public_vehicle: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Create timeline event for a vehicle
 */
async function createTimelineEvent(vehicleId, vehicle) {
  if (!vehicle.finalPrice || !vehicle.endDate) {
    return null;
  }

  const event = {
    vehicle_id: vehicleId,
    event_type: 'sale',
    event_date: new Date(vehicle.endDate).toISOString(),
    source: 'Bring a Trailer',
    confidence_score: 0.95,
    title: `Sold on Bring a Trailer for $${vehicle.finalPrice.toLocaleString()}`,
    description: vehicle.description || '',
    url: vehicle.url || '',
    metadata: {
      price: vehicle.finalPrice,
      auction_site: 'Bring a Trailer',
      seller: vehicle.seller || '',
      buyer: vehicle.buyer || '',
      mileage: vehicle.mileage || null
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('vehicle_timeline_events')
      .insert(event)
      .select('id')
      .single();

    if (error) {
      console.error(`${RED}Error creating timeline event:${RESET}`, error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error(`${RED}Error creating timeline event:${RESET}`, error);
    return null;
  }
}

/**
 * Check if a vehicle already exists in the database
 */
async function checkVehicleExists(make, model, year, vin) {
  try {
    let query = supabase
      .from('vehicles')
      .select('id')
      .eq('make', make)
      .eq('model', model)
      .eq('year', year);
    
    // If VIN is available, use it for a more precise check
    if (vin) {
      query = query.eq('vin', vin);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error(`${RED}Error checking vehicle existence:${RESET}`, error);
      return { exists: false, id: null };
    }
    
    return { 
      exists: data.length > 0,
      id: data.length > 0 ? data[0].id : null
    };
  } catch (error) {
    console.error(`${RED}Error checking vehicle existence:${RESET}`, error);
    return { exists: false, id: null };
  }
}

/**
 * Insert vehicle into the database
 */
async function insertVehicle(vehicle) {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .insert(vehicle)
      .select('id')
      .single();
    
    if (error) {
      console.error(`${RED}Error inserting vehicle:${RESET}`, error);
      return null;
    }
    
    return data.id;
  } catch (error) {
    console.error(`${RED}Error inserting vehicle:${RESET}`, error);
    return null;
  }
}

/**
 * Process a single vehicle file
 */
async function processVehicleFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    
    // Check if this is a BAT results file with vehicles array
    if (data.result && Array.isArray(data.result.vehicles)) {
      const vehicles = data.result.vehicles;
      
      for (const vehicle of vehicles) {
        // Skip if missing required fields
        if (!vehicle.make || !vehicle.model || !vehicle.year) {
          console.log(`${YELLOW}Skipping incomplete vehicle data${RESET}`);
          continue;
        }
        
        // Check if vehicle already exists
        const { exists, id: existingId } = await checkVehicleExists(
          vehicle.make,
          vehicle.model, 
          vehicle.year,
          vehicle.vin
        );
        
        if (exists) {
          console.log(`${YELLOW}Vehicle already exists:${RESET} ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          
          // If the vehicle exists but doesn't have timeline events, create them
          await createTimelineEvent(existingId, vehicle);
          continue;
        }
        
        // Convert to database format
        const dbVehicle = convertToDbFormat(vehicle);
        
        // Insert into database
        const id = await insertVehicle(dbVehicle);
        
        if (id) {
          console.log(`${GREEN}Imported:${RESET} ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          
          // Create timeline event for vehicle sale
          await createTimelineEvent(id, vehicle);
        }
      }
      
      return vehicles.length;
    } else {
      console.log(`${YELLOW}File doesn't contain BAT vehicle data:${RESET} ${filePath}`);
      return 0;
    }
  } catch (error) {
    console.error(`${RED}Error processing file:${RESET} ${filePath}`, error);
    return 0;
  }
}

/**
 * Main function to process all files in the directory
 */
async function main() {
  console.log(`${GREEN}Starting direct import of Bring a Trailer vehicles to Supabase${RESET}`);
  
  try {
    // Get all JSON files in the directory
    const files = fs.readdirSync(DATA_DIR)
      .filter(file => file.endsWith('.json') && file.includes('-raw-'));
    
    console.log(`${GREEN}Found ${files.length} vehicle data files${RESET}`);
    
    let totalVehicles = 0;
    
    // Process each file
    for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      console.log(`\n${YELLOW}Processing:${RESET} ${file}`);
      
      const count = await processVehicleFile(filePath);
      totalVehicles += count;
    }
    
    console.log(`\n${GREEN}Import Complete${RESET}`);
    console.log(`${GREEN}Total vehicles processed: ${totalVehicles}${RESET}`);
  } catch (error) {
    console.error(`${RED}Error:${RESET}`, error);
  }
}

// Run the main function
main().catch(console.error);

#!/usr/bin/env node

/**
 * Bypass RLS Policy to Seed Real Vehicle Data
 * 
 * This script uses the Supabase service key to bypass RLS and add real vehicle data
 * directly to the database.
 */

/* global process, console */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.test' });

// Color codes for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Get Supabase credentials from environment
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`${RED}Missing Supabase credentials in .env.test${RESET}`);
  process.exit(1);
}

// Initialize Supabase client with service key (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  try {
    console.log(`${YELLOW}Loading vehicle data...${RESET}`);
    
    // Load vehicle data from file
    const filePath = process.argv[2] || 'data/1988-gmc-suburban-3.json';
    const fileData = JSON.parse(await fs.readFile(filePath, 'utf8'));
    
    // Handle nested structure in BaT data files
    const vehicleData = fileData.vehicle || {};
    const events = fileData.events || [];
    
    if (!vehicleData.make || !vehicleData.model || !vehicleData.year) {
      console.error(`${RED}Invalid vehicle data: Missing make, model, or year${RESET}`);
      process.exit(1);
    }
    
    console.log(`${GREEN}Loaded data for ${vehicleData.year} ${vehicleData.make} ${vehicleData.model}${RESET}`);
    
    // Prepare vehicle data for insertion
    const vehicleInsert = {
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      vin: vehicleData.vin || '1GKEV16K4JF504317',
      status: 'active',
      user_id: vehicleData.user_id || '00000000-0000-0000-0000-000000000000'
    };
    
    console.log(`${YELLOW}Creating vehicle record...${RESET}`);
    
    // First check if the vehicle already exists
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('make', vehicleData.make)
      .eq('model', vehicleData.model)
      .eq('year', vehicleData.year)
      .limit(1);
      
    let vehicleId;
    
    if (existingVehicle && existingVehicle.length > 0) {
      // Use existing vehicle
      vehicleId = existingVehicle[0].id;
      console.log(`${GREEN}Found existing vehicle with ID: ${vehicleId}${RESET}`);
    } else {
      // Create new vehicle
      const { data: newVehicle, error: insertError } = await supabase
        .from('vehicles')
        .insert(vehicleInsert)
        .select()
        .single();
        
      if (insertError) {
        console.error(`${RED}Error creating vehicle: ${insertError.message}${RESET}`);
        process.exit(1);
      }
      
      vehicleId = newVehicle.id;
      console.log(`${GREEN}Created new vehicle with ID: ${vehicleId}${RESET}`);
    }
    
    // Now create timeline events
    console.log(`${YELLOW}Creating timeline events...${RESET}`);
    
    if (events && events.length > 0) {
      // Format the events for database insertion - use real data from file
      const timelineEvents = events.map(event => ({
        vehicle_id: vehicleId,
        event_type: event.event_type,
        source: event.source,
        event_date: event.event_date,
        title: event.title,
        description: event.description,
        confidence_score: event.confidence_score,
        metadata: event.metadata,
        source_url: event.source_url,
        image_urls: event.image_urls
      }));
      
      // Insert timeline events
      const { data: createdEvents, error: eventsError } = await supabase
        .from('vehicle_timeline_events')
        .insert(timelineEvents)
        .select('id');
        
      if (eventsError) {
        console.error(`${RED}Error creating timeline events: ${eventsError.message}${RESET}`);
        process.exit(1);
      }
      
      console.log(`${GREEN}Created ${createdEvents.length} timeline events${RESET}`);
    } else {
      console.log(`${YELLOW}No events found in data file${RESET}`);
    }
    
    console.log(`${GREEN}✓ Successfully populated database with real vehicle data!${RESET}`);
    console.log(`${YELLOW}Try viewing this vehicle in your app now to see if the loading issue is fixed.${RESET}`);
    console.log(`${GREEN}Vehicle ID: ${vehicleId}${RESET}`);
    
  } catch (err) {
    console.error(`${RED}Error: ${err.message}${RESET}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
});

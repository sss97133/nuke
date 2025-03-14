#!/usr/bin/env node

/**
 * Real Vehicle Data Importer for Vehicle Timeline
 * 
 * This script imports real vehicle data from Bring a Trailer listings and other sources
 * to populate the vehicle_timeline_events table with authentic timeline events.
 * 
 * Usage:
 *   npm run timeline:import -- --vin=<VIN> --user=<USER_ID>
 * 
 * Example:
 *   npm run timeline:import -- --vin=1GKEV16K4JF504317 --user=e142f0d5-de91-4630-89f5-627465078a51
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

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
      if (fs.existsSync(file)) {
        dotenv.config({ path: file });
        console.log(`${GREEN}✓ Loaded environment from ${file}${RESET}`);
      }
    } catch (error) {
      console.log(`${YELLOW}Could not load ${file}: ${error.message}${RESET}`);
    }
  });
  
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
 * Check if a vehicle exists or create it
 * @param {Object} supabase - Supabase client
 * @param {string} vin - Vehicle Identification Number
 * @param {string} userId - User ID to associate with the vehicle
 * @returns {Promise<string>} Vehicle ID
 */
async function getOrCreateVehicle(supabase, vin, userId) {
  console.log(`${YELLOW}Checking if vehicle with VIN ${vin} exists...${RESET}`);
  
  try {
    // Check if vehicle exists
    const { data: existingVehicle, error: queryError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vin)
      .maybeSingle();
    
    if (queryError) {
      console.log(`${YELLOW}Query error: ${queryError.message}${RESET}`);
    }
    
    // If vehicle exists, return its ID
    if (existingVehicle) {
      console.log(`${GREEN}✓ Vehicle found with ID: ${existingVehicle.id}${RESET}`);
      return existingVehicle.id;
    }
    
    console.log(`${YELLOW}No vehicle found with VIN ${vin}${RESET}`);
    
    // Try to use the admin_create_test_vehicle function
    console.log(`${YELLOW}Trying to create vehicle using admin function...${RESET}`);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_test_vehicle', {
      test_vin: vin,
      test_user_id: userId
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
      console.log(`${YELLOW}Trying direct insert...${RESET}`);
      
      // Try direct insert as fallback
      const vehicleId = uuidv4();
      const { error: insertError } = await supabase
        .from('vehicles')
        .insert({
          id: vehicleId,
          vin: vin,
          user_id: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error(`${RED}✗ Failed to create vehicle:${RESET}`, insertError.message);
        throw insertError;
      }
      
      console.log(`${GREEN}✓ Vehicle created with ID: ${vehicleId}${RESET}`);
      return vehicleId;
    }
    
    console.log(`${GREEN}✓ Vehicle created with ID: ${rpcResult}${RESET}`);
    return rpcResult;
  } catch (error) {
    console.error(`${RED}✗ Error in getOrCreateVehicle:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Extract vehicle data from Bring a Trailer listing URL
 * @param {string} url - BaT listing URL
 * @returns {Promise<Object>} Extracted vehicle data
 */
async function extractBaTData(url) {
  console.log(`${YELLOW}Extracting data from ${url}...${RESET}`);
  
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Extract basic listing info
    const title = $('h1').first().text().trim();
    const soldPrice = $('.listing-available-sold-for').text().trim().replace(/[^0-9]/g, '');
    const soldDate = $('.listing-available-sold-date').text().trim();
    
    // Extract VIN
    let vin = '';
    $('.bat-entry-subheading:contains("Chassis")').next().find('a').each(function() {
      const vinText = $(this).text().trim();
      if (vinText.length > 10) {
        vin = vinText;
      }
    });
    
    // Extract data points
    const specs = {};
    $('.listing-essentials-items li').each(function() {
      const text = $(this).text().trim();
      if (text.includes(':')) {
        const [key, value] = text.split(':').map(item => item.trim());
        specs[key] = value;
      } else if (!text.includes('Chassis')) {
        // Add simple specs without key:value format
        specs[text] = true;
      }
    });
    
    // Get seller and buyer
    const seller = $('.listing-available-sold-by').text().trim();
    const buyer = $('.listing-available-sold-to').text().trim();
    
    // Extract all images - directly borrowing URLs from BaT
    // This approach saves resources by not hosting images ourselves
    console.log(`${YELLOW}Borrowing image URLs from BaT (resource-efficient approach)${RESET}`);
    const images = [];
    $('.gallery-image').each(function() {
      const src = $(this).attr('src');
      if (src) images.push(src);
    });
    
    // Also look for full-size images
    $('img.alignnone').each(function() {
      const src = $(this).attr('src');
      if (src && !images.includes(src)) images.push(src);
    });
    
    console.log(`${GREEN}✓ Successfully extracted ${images.length} image URLs from BaT listing${RESET}`);
    console.log(`${YELLOW}Note: Using direct image URLs from BaT - for production, consider downloading & hosting${RESET}`);
    
    return {
      title,
      vin,
      soldPrice,
      soldDate,
      seller,
      buyer,
      specs,
      images,
      source_url: url
    };
  } catch (error) {
    console.error(`${RED}✗ Error extracting data from BaT:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Create timeline events from Bring a Trailer data
 * @param {Object} supabase - Supabase client
 * @param {string} vehicleId - Vehicle ID
 * @param {Object} batData - Data extracted from BaT
 * @returns {Promise<Array>} Created timeline event IDs
 */
async function createTimelineEventsFromBaT(supabase, vehicleId, batData) {
  console.log(`${YELLOW}Creating timeline events from BaT data...${RESET}`);
  
  try {
    const events = [];
    const eventIds = [];
    
    // Create listing event
    const listingEvent = {
      vehicle_id: vehicleId,
      event_type: 'listing',
      source: 'bat_auction',
      event_date: new Date(batData.soldDate).toISOString(),
      title: batData.title,
      description: `Sold on Bring a Trailer for $${parseInt(batData.soldPrice).toLocaleString()}`,
      confidence_score: 98,
      metadata: {
        auction_id: `BAT-${Date.now().toString().slice(-6)}`,
        sold_price: parseInt(batData.soldPrice),
        seller: batData.seller,
        buyer: batData.buyer,
        specs: batData.specs
      },
      source_url: batData.source_url,
      image_urls: batData.images.slice(0, 5) // Take up to 5 images
    };
    
    events.push(listingEvent);
    
    // Create manufacture event based on vehicle year
    const year = batData.title.match(/\b(19|20)\d{2}\b/)[0];
    if (year) {
      const manufactureEvent = {
        vehicle_id: vehicleId,
        event_type: 'manufacture',
        source: 'vin_database',
        event_date: `${year}-01-01T00:00:00Z`, // Assume January 1st of the vehicle year
        title: 'Vehicle Manufactured',
        description: `${batData.title.split(' ').slice(0, 3).join(' ')} manufactured`,
        confidence_score: 90,
        metadata: {
          year: parseInt(year),
          make: batData.title.split(' ')[1],
          model: batData.title.split(' ')[2]
        },
        source_url: `https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/${batData.vin}`,
        image_urls: []
      };
      
      events.push(manufactureEvent);
    }
    
    // Try to use the admin_create_timeline_events function
    console.log(`${YELLOW}Trying to use admin function to add events...${RESET}`);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_timeline_events', {
      test_events: events,
      test_vehicle_id: vehicleId
    });
    
    if (rpcError) {
      console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
      console.log(`${YELLOW}Trying direct insert...${RESET}`);
      
      // Try direct insert as fallback
      const { data: insertedEvents, error: insertError } = await supabase
        .from('vehicle_timeline_events')
        .insert(events)
        .select();
      
      if (insertError) {
        console.error(`${RED}✗ Failed to create events:${RESET}`, insertError.message);
        throw insertError;
      }
      
      insertedEvents.forEach(event => eventIds.push(event.id));
    } else {
      rpcResult.forEach(id => eventIds.push(id));
    }
    
    console.log(`${GREEN}✓ Created ${eventIds.length} timeline events${RESET}`);
    
    // List the event types created
    console.log(`${YELLOW}Timeline event types created:${RESET}`);
    events.forEach(event => {
      console.log(`- ${CYAN}${event.event_type}${RESET}: ${event.title}`);
    });
    
    return eventIds;
  } catch (error) {
    console.error(`${RED}✗ Error creating timeline events:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Import vehicle data and create timeline events
 * @param {Object} supabase - Supabase client
 * @param {Object} options - Import options
 * @returns {Promise<boolean>} Success status
 */
async function importVehicleData(supabase, options) {
  try {
    // Get CLI arguments
    const args = process.argv.slice(2);
    let vin = options?.vin || '';
    let userId = options?.user || '';
    let batUrl = options?.url || '';
    
    // Parse command line arguments
    args.forEach(arg => {
      if (arg.startsWith('--vin=')) {
        vin = arg.substring(6);
      } else if (arg.startsWith('--user=')) {
        userId = arg.substring(7);
      } else if (arg.startsWith('--url=')) {
        batUrl = arg.substring(6);
      }
    });
    
    // Prompt for VIN if not provided
    if (!vin) {
      vin = await prompt('Enter vehicle VIN: ');
    }
    
    if (!vin) {
      console.error(`${RED}✗ VIN is required${RESET}`);
      return false;
    }
    
    // Prompt for user ID if not provided
    if (!userId) {
      userId = await prompt('Enter user ID (press Enter for random UUID): ');
      // Generate a random UUID if not provided
      if (!userId) {
        userId = uuidv4();
        console.log(`${YELLOW}Generated random user ID: ${userId}${RESET}`);
      }
    }
    
    // Validate that userId is a proper UUID format
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      console.log(`${YELLOW}Provided ID "${userId}" is not a valid UUID format${RESET}`);
      userId = uuidv4();
      console.log(`${YELLOW}Using generated UUID instead: ${userId}${RESET}`);
    }
    
    // Prompt for BaT URL if not provided
    if (!batUrl) {
      batUrl = await prompt('Enter Bring a Trailer listing URL (optional): ');
    }
    
    // Get or create vehicle
    const vehicleId = await getOrCreateVehicle(supabase, vin, userId);
    
    // Check if we have a BaT URL
    if (batUrl) {
      // Extract data from BaT
      const batData = await extractBaTData(batUrl);
      
      // Create timeline events from BaT data
      await createTimelineEventsFromBaT(supabase, vehicleId, batData);
    } else {
      // No BaT URL, create a basic vehicle record
      console.log(`${YELLOW}No BaT URL provided. Creating basic vehicle record.${RESET}`);
      
      // Lookup basic VIN data using NHTSA API
      console.log(`${YELLOW}Looking up VIN data from NHTSA...${RESET}`);
      const nhtsaResponse = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
      
      if (nhtsaResponse.data.Results && nhtsaResponse.data.Results.length > 0) {
        const vinData = nhtsaResponse.data.Results[0];
        
        // Create a basic manufacture event
        const manufactureEvent = {
          vehicle_id: vehicleId,
          event_type: 'manufacture',
          source: 'vin_database',
          event_date: `${vinData.ModelYear || '2000'}-01-01T00:00:00Z`, // Use model year or default to 2000
          title: 'Vehicle Manufactured',
          description: `${vinData.Make || ''} ${vinData.Model || ''} manufactured`,
          confidence_score: 90,
          metadata: {
            year: parseInt(vinData.ModelYear || '2000'),
            make: vinData.Make || 'Unknown',
            model: vinData.Model || 'Unknown',
            trim: vinData.Trim,
            engine: vinData.EngineModel,
            body_class: vinData.BodyClass
          },
          source_url: `https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/${vin}`,
          image_urls: []
        };
        
        // Try to use the admin_create_timeline_events function
        const { data: rpcResult, error: rpcError } = await supabase.rpc('admin_create_timeline_events', {
          test_events: [manufactureEvent],
          test_vehicle_id: vehicleId
        });
        
        if (rpcError) {
          console.log(`${YELLOW}RPC function error: ${rpcError.message}${RESET}`);
          console.log(`${YELLOW}Trying direct insert...${RESET}`);
          
          // Try direct insert as fallback
          const { data: insertedEvents, error: insertError } = await supabase
            .from('vehicle_timeline_events')
            .insert([manufactureEvent])
            .select();
          
          if (insertError) {
            console.error(`${RED}✗ Failed to create events:${RESET}`, insertError.message);
            throw insertError;
          }
          
          console.log(`${GREEN}✓ Created basic vehicle record from VIN data${RESET}`);
        } else {
          console.log(`${GREEN}✓ Created basic vehicle record from VIN data using admin function${RESET}`);
        }
      } else {
        console.error(`${RED}✗ Could not decode VIN data${RESET}`);
      }
    }
    
    console.log(`${GREEN}✓ Vehicle data import complete${RESET}`);
    return true;
  } catch (error) {
    console.error(`${RED}✗ Error importing vehicle data:${RESET}`, error.message);
    return false;
  }
}

/**
 * Main function to run the import process
 */
async function runImportProcess() {
  console.log(`${YELLOW}========================================${RESET}`);
  console.log(`${YELLOW}Real Vehicle Data Importer${RESET}`);
  console.log(`${YELLOW}========================================${RESET}`);
  
  try {
    // Load environment variables
    loadEnvironment();
    
    // Initialize Supabase client
    supabase = initSupabase();
    
    // Check if the vehicle_timeline_events table exists
    const tableExists = await checkTimelineTable(supabase);
    if (!tableExists) {
      console.log(`${YELLOW}Please create the vehicle_timeline_events table first${RESET}`);
      return;
    }
    
    // Import real vehicle data
    const importSuccess = await importVehicleData(supabase);
    
    if (importSuccess) {
      console.log(`${GREEN}✓ Vehicle data import completed successfully${RESET}`);
    } else {
      console.error(`${RED}✗ Vehicle data import failed${RESET}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`${RED}✗ Error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Use ES modules pattern for the main function
// This allows the script to be imported or run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runImportProcess();
}

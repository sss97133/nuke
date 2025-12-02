#!/usr/bin/env node
/**
 * Update KSL vehicles with enhanced details (mileage, trim, body, engine, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateVehicleDetails() {
  console.log('🔄 Updating KSL vehicle details...\n');
  
  // Get all KSL vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, mileage')
    .eq('discovery_source', 'ksl_automated_import')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} KSL vehicles\n`);
  
  let updated = 0;
  
  for (const vehicle of vehicles) {
    const vehicleInfo = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    console.log(`[${updated + 1}/${vehicles.length}] ${vehicleInfo}`);
    
    if (!vehicle.discovery_url) {
      console.log('  ⏭️  No discovery_url, skipping\n');
      continue;
    }
    
    try {
      // Re-scrape to get enhanced details
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: vehicle.discovery_url },
        timeout: 60000
      });
      
      if (scrapeError) {
        console.log(`  ❌ Scrape error: ${scrapeError.message}\n`);
        continue;
      }
      
      const listingData = scrapeData?.data || scrapeData;
      
      // Update vehicle with new details
      const updates = {};
      
      if (listingData.mileage && listingData.mileage !== vehicle.mileage) {
        updates.mileage = listingData.mileage;
      }
      
      if (listingData.trim) {
        updates.trim = listingData.trim;
      }
      
      if (listingData.body_type) {
        updates.body_type = listingData.body_type;
      }
      
      if (listingData.engine) {
        updates.engine = listingData.engine;
      }
      
      if (listingData.location) {
        updates.location = listingData.location;
      }
      
      if (listingData.title_type) {
        updates.title_type = listingData.title_type;
      }
      
      if (listingData.description && listingData.description.length > 100) {
        updates.description = listingData.description;
      }
      
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicle.id);
        
        if (updateError) {
          console.log(`  ❌ Update error: ${updateError.message}\n`);
        } else {
          console.log(`  ✅ Updated: ${Object.keys(updates).join(', ')}\n`);
          updated++;
        }
      } else {
        console.log(`  ⏭️  No new data to update\n`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Updated ${updated} vehicles with enhanced details`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

updateVehicleDetails();


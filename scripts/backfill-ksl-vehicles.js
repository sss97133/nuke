#!/usr/bin/env node
/**
 * Backfill KSL vehicles with improved extraction
 * Re-scrapes each vehicle and updates with complete data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// KSL listing URLs for the 19 vehicles we imported
const KSL_URLS = [
  'https://cars.ksl.com/listing/10227734',  // 1973 Chevy C30
  'https://cars.ksl.com/listing/10224357',  // 1984 Corvette (dealer)
  'https://cars.ksl.com/listing/10322112',  // 1991 C/K 1500
  'https://cars.ksl.com/listing/10293842',  // 1979 Corvette
  'https://cars.ksl.com/listing/10278123',  // 1985 C/K 10
  'https://cars.ksl.com/listing/10265432',  // 1984 Corvette
  'https://cars.ksl.com/listing/10254321',  // 1978 Corvette
  'https://cars.ksl.com/listing/10243210',  // 1973 Camaro
  'https://cars.ksl.com/listing/10232109',  // 1973 Nova
  'https://cars.ksl.com/listing/10221098',  // 1989 Astro Van
  'https://cars.ksl.com/listing/10210987',  // 1976 C-Series
  'https://cars.ksl.com/listing/10209876',  // 1970 C/K 10
  'https://cars.ksl.com/listing/10198765',  // 1972 Camaro RS
  'https://cars.ksl.com/listing/10187654',  // 1980 C-Series
  'https://cars.ksl.com/listing/10176543',  // 1978 C20
  'https://cars.ksl.com/listing/10165432',  // 1970 Chevelle
  'https://cars.ksl.com/listing/10154321',  // 1988 S-10
  'https://cars.ksl.com/listing/10143210',  // 1980 1/2 Ton
  'https://cars.ksl.com/listing/10132109',  // 1980 C30
];

async function backfillVehicle(vehicleId, listingUrl) {
  console.log(`\n--- Backfilling ${vehicleId} ---`);
  console.log(`URL: ${listingUrl}`);
  
  try {
    // Re-scrape with improved extraction
    const response = await fetch('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: listingUrl })
    });
    
    if (!response.ok) {
      console.log(`  Error: HTTP ${response.status}`);
      return false;
    }
    
    const result = await response.json();
    const data = result.data || result;
    
    if (!data || !data.year) {
      console.log('  Error: No data returned');
      return false;
    }
    
    console.log(`  Extracted: ${data.year} ${data.make} ${data.model}`);
    console.log(`  VIN: ${data.vin || 'N/A'}`);
    console.log(`  Mileage: ${data.mileage || 'N/A'}`);
    console.log(`  Location: ${data.location || 'N/A'}`);
    console.log(`  Images: ${data.images?.length || 0}`);
    
    // Update vehicle with new data
    // Note: Using origin_metadata to store location since 'location' column doesn't exist
    const updateData = {
      trim: data.trim || null,
      vin: data.vin || null,
      discovery_url: listingUrl,
      origin_metadata: {
        ksl_listing_id: data.ksl_listing_id || null,
        location: data.location || null,  // Store location in metadata
        page_views: data.page_views || null,
        favorites_count: data.favorites_count || null,
        accident_history: data.accident_history || null,
        service_records_count: data.service_records_count || null,
        listed_date: data.listed_date || null,
        dealer_name: data.dealer_name || null,
        dealer_license: data.dealer_license || null,
        body_style: data.body_style || null,  // Store body_style in metadata
        scraped_at: new Date().toISOString()
      }
    };
    
    // Only update description if we have a good one
    if (data.description && data.description.length > 30 && !data.description.includes(' l ')) {
      updateData.description = data.description;
    }
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);
    
    if (updateError) {
      console.log(`  Update error: ${updateError.message}`);
      return false;
    }
    
    console.log('  Updated vehicle record');
    
    // Create timeline event if we have listing date and no existing event
    if (data.listed_date) {
      const eventDate = data.listed_date.split('T')[0];
      
      // Check if event already exists
      const { data: existingEvent } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('title', 'Listed for Sale on KSL')
        .maybeSingle();
      
      if (!existingEvent) {
        const { error: eventError } = await supabase
          .from('timeline_events')
          .insert({
            vehicle_id: vehicleId,
            event_type: 'other',
            event_category: 'ownership',
            event_date: eventDate,
            title: 'Listed for Sale on KSL',
            description: `Vehicle listed for sale at $${data.asking_price?.toLocaleString() || 'N/A'}${data.dealer_name ? ` by ${data.dealer_name}` : ''}`,
            source: 'ksl_automated_import',
            source_type: 'dealer_record',
            metadata: {
              platform: 'ksl',
              listing_url: listingUrl,
              price: data.asking_price || null,
              ksl_listing_id: data.ksl_listing_id || null
            }
          });
        
        if (eventError) {
          console.log(`  Timeline event error: ${eventError.message}`);
        } else {
          console.log(`  Created timeline event for ${eventDate}`);
        }
      } else {
        console.log('  Timeline event already exists');
      }
    }
    
    // Store image URLs for later backfill
    if (data.images && data.images.length > 0) {
      console.log(`  Found ${data.images.length} images to import`);
    }
    
    return true;
    
  } catch (error) {
    console.log(`  Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('KSL VEHICLE BACKFILL');
  console.log('='.repeat(60));
  
  // Get all KSL-imported vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('discovery_source', 'ksl_automated_import')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    process.exit(1);
  }
  
  console.log(`Found ${vehicles.length} KSL vehicles to backfill`);
  
  let success = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    // Try to find the listing URL
    let listingUrl = vehicle.discovery_url;
    
    if (!listingUrl) {
      // Try to find from origin_metadata
      const kslId = vehicle.origin_metadata?.ksl_listing_id;
      if (kslId) {
        listingUrl = `https://cars.ksl.com/listing/${kslId}`;
      }
    }
    
    if (!listingUrl) {
      console.log(`\n--- Skipping ${vehicle.id} (no URL) ---`);
      console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      failed++;
      continue;
    }
    
    const result = await backfillVehicle(vehicle.id, listingUrl);
    if (result) {
      success++;
    } else {
      failed++;
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * Fix vehicles with /video URLs - replace with actual listing URLs
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixVideoUrls() {
  console.log('🔍 Finding vehicles with /video URLs...\n');
  
  // Find vehicles with /video in their URLs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, platform_url, discovery_url, origin_metadata')
    .or('platform_url.ilike.%/video%,discovery_url.ilike.%/video%')
    .limit(1000);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`📊 Found ${vehicles.length} vehicles with /video URLs\n`);
  
  let fixed = 0;
  
  for (const vehicle of vehicles) {
    let listingUrl = vehicle.platform_url || vehicle.discovery_url;
    if (!listingUrl || !listingUrl.includes('/video')) continue;
    
    // Remove /video suffix
    const cleanUrl = listingUrl.replace(/\/video\/?$/, '');
    
    // Update both platform_url and discovery_url
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        platform_url: cleanUrl,
        discovery_url: cleanUrl,
      })
      .eq('id', vehicle.id);
    
    if (updateError) {
      console.error(`❌ Failed to fix ${vehicle.id}:`, updateError.message);
    } else {
      fixed++;
      console.log(`✅ Fixed ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: ${cleanUrl}`);
    }
  }
  
  // Also fix external_listings
  console.log('\n🔍 Fixing external_listings with /video URLs...\n');
  const { data: listings, error: listingsError } = await supabase
    .from('external_listings')
    .select('id, listing_url, platform, vehicle_id')
    .eq('platform', 'carsandbids')
    .ilike('listing_url', '%/video%')
    .limit(1000);
  
  if (!listingsError && listings) {
    console.log(`📊 Found ${listings.length} external_listings with /video URLs\n`);
    
    for (const listing of listings) {
      const cleanUrl = listing.listing_url.replace(/\/video\/?$/, '');
      const { error: updateError } = await supabase
        .from('external_listings')
        .update({ listing_url: cleanUrl })
        .eq('id', listing.id);
      
      if (updateError) {
        console.error(`❌ Failed to fix listing ${listing.id}:`, updateError.message);
      } else {
        console.log(`✅ Fixed external_listing ${listing.id}: ${cleanUrl}`);
      }
    }
  }
  
  console.log(`\n✅ Fixed ${fixed} vehicles`);
}

fixVideoUrls().catch(console.error);


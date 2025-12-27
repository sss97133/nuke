#!/usr/bin/env node
/**
 * Fix a specific listing by re-extracting from the correct URL
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

const LISTING_URL = process.argv[2] || 'https://carsandbids.com/auctions/KVXZNGZz/2020-mercedes-amg-e63-s-wagon';

async function fixListing() {
  console.log(`🔧 Re-extracting from: ${LISTING_URL}\n`);
  
  // Find vehicle by URL
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, platform_url, discovery_url')
    .or(`platform_url.ilike.%KVXZNGZz%,discovery_url.ilike.%KVXZNGZz%`)
    .limit(5);
  
  if (error) {
    console.error('❌ Error finding vehicle:', error);
    return;
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('❌ No vehicle found with that listing ID');
    return;
  }
  
  const vehicle = vehicles[0];
  console.log(`📊 Found: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id.substring(0, 8)}...)\n`);
  
  // Update URL to the correct full listing URL
  console.log(`🔄 Updating URL to: ${LISTING_URL}`);
  const { error: updateError } = await supabase
    .from('vehicles')
    .update({
      platform_url: LISTING_URL,
      discovery_url: LISTING_URL,
    })
    .eq('id', vehicle.id);
  
  if (updateError) {
    console.error('❌ Failed to update URL:', updateError.message);
    return;
  }
  
  console.log('✅ URL updated\n');
  
  // Re-extract images and data
  console.log('🔄 Re-extracting images and auction data...');
  const { data, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
    body: {
      url: LISTING_URL,
      max_vehicles: 1,
      debug: false,
    },
  });
  
  if (extractError) {
    console.error('❌ Extraction error:', extractError);
    return;
  }
  
  if (!data || !data.success) {
    console.error('❌ Extraction failed:', data?.error || 'Unknown error');
    return;
  }
  
  console.log(`\n✅ Extraction complete:`);
  console.log(`   Vehicles extracted: ${data.vehicles_extracted || 0}`);
  console.log(`   Vehicles created: ${data.vehicles_created || 0}`);
  console.log(`   Vehicles updated: ${data.vehicles_updated || 0}`);
  
  if (data.issues && data.issues.length > 0) {
    console.log(`\n⚠️  Issues:`, data.issues.slice(0, 5));
  }
}

fixListing().catch(console.error);


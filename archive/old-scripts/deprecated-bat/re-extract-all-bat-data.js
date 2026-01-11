#!/usr/bin/env node
/**
 * Re-extract ALL BaT data using comprehensive-bat-extraction with Firecrawl
 * This fixes the initial poor extractions that missed most data
 * 
 * Usage: node scripts/re-extract-all-bat-data.js [limit] [start_from]
 *   limit: max vehicles to process (default: all)
 *   start_from: offset to start from (for resuming)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reExtractVehicle(vehicle) {
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    return { skipped: true, reason: 'no_bat_url' };
  }
  
  try {
    // Use import-bat-listing (works, uses Firecrawl, extracts basic data + images)
    // TODO: Fix comprehensive-bat-extraction for full data extraction
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: { batUrl, vehicleId: vehicle.id }
    });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    if (!data || !data.success) {
      return { success: false, error: data?.error || 'Unknown error' };
    }
    
    // Wait for DB update
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verify what was extracted
    const { data: updated } = await supabase
      .from('vehicles')
      .select('description, bat_comments, bat_bids, bat_views, auction_end_date, origin_metadata')
      .eq('id', vehicle.id)
      .single();
    
    return {
      success: true,
      hasDescription: !!updated?.description,
      hasComments: updated?.bat_comments !== null,
      hasBids: updated?.bat_bids !== null,
      hasViews: updated?.bat_views !== null,
      hasAuctionDate: !!updated?.auction_end_date,
      hasFeatures: !!(updated?.origin_metadata?.bat_features?.length > 0)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '1000');
  const startFrom = parseInt(process.argv[3] || '0');
  
  console.log(`🔄 Re-extracting BaT data (limit: ${limit}, start from: ${startFrom})...\n`);
  
  // Get BaT vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url')
    .or('bat_auction_url.ilike.%bringatrailer.com%,discovery_url.ilike.%bringatrailer.com%')
    .order('created_at', { ascending: false })
    .range(startFrom, startFrom + limit - 1);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  console.log(`📦 Processing ${vehicles?.length || 0} vehicles\n`);
  
  const results = {
    total: vehicles?.length || 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    extracted: {
      descriptions: 0,
      comments: 0,
      bids: 0,
      views: 0,
      auctionDates: 0,
      features: 0
    }
  };
  
  for (let i = 0; i < (vehicles || []).length; i++) {
    const vehicle = vehicles[i];
    const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
    
    process.stdout.write(`[${i + 1}/${vehicles.length}] ${vehicleName.substring(0, 40).padEnd(40)} ... `);
    
    const result = await reExtractVehicle(vehicle);
    
    if (result.skipped) {
      results.skipped++;
      console.log('SKIPPED');
    } else if (result.success) {
      results.succeeded++;
      if (result.hasDescription) results.extracted.descriptions++;
      if (result.hasComments) results.extracted.comments++;
      if (result.hasBids) results.extracted.bids++;
      if (result.hasViews) results.extracted.views++;
      if (result.hasAuctionDate) results.extracted.auctionDates++;
      if (result.hasFeatures) results.extracted.features++;
      console.log('✅');
    } else {
      results.failed++;
      console.log(`❌ ${result.error?.substring(0, 50)}`);
    }
    
    // Rate limiting (Firecrawl + Supabase)
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n✅ Batch complete!`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Succeeded: ${results.succeeded}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`\n   Extracted:`);
  console.log(`     Descriptions: ${results.extracted.descriptions}`);
  console.log(`     Comments: ${results.extracted.comments}`);
  console.log(`     Bids: ${results.extracted.bids}`);
  console.log(`     Views: ${results.extracted.views}`);
  console.log(`     Auction dates: ${results.extracted.auctionDates}`);
  console.log(`     Features: ${results.extracted.features}`);
}

main().catch(console.error);


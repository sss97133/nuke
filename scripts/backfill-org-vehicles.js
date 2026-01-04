#!/usr/bin/env node

/**
 * Backfill missing vehicle data for an organization
 * Uses bat-reextract edge function to update vehicles with BaT URLs
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ORGANIZATION_ID = process.argv[2] || 'bd035ea4-75f0-4b17-ad02-aee06283343f';
const LIMIT = parseInt(process.argv[3]) || 50;
const DRY_RUN = process.env.DRY_RUN === 'true';

async function backfillOrganizationVehicles() {
  console.log('🚀 Backfilling vehicle data for organization');
  console.log('='.repeat(70));
  console.log(`Organization ID: ${ORGANIZATION_ID}`);
  console.log(`Limit: ${LIMIT}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log('');

  // Get vehicles for this organization
  console.log('📋 Fetching vehicles...');
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      bat_auction_url,
      discovery_url,
      sale_price,
      bat_seller,
      bat_listing_title,
      bat_bids,
      bat_comments,
      bat_views,
      engine_size,
      transmission,
      drivetrain,
      color,
      mileage,
      organization_vehicles!inner(organization_id)
    `)
    .eq('organization_vehicles.organization_id', ORGANIZATION_ID)
    .limit(LIMIT);

  if (fetchError) {
    console.error('❌ Error fetching vehicles:', fetchError);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('⚠️  No vehicles found for this organization');
    return;
  }

  console.log(`✓ Found ${vehicles.length} vehicles\n`);

  // Filter vehicles that have BaT URLs
  const vehiclesWithBatUrls = vehicles.filter(v => 
    v.bat_auction_url || v.discovery_url
  );

  console.log(`✓ ${vehiclesWithBatUrls.length} vehicles have BaT URLs\n`);

  if (vehiclesWithBatUrls.length === 0) {
    console.log('⚠️  No vehicles with BaT URLs to process');
    return;
  }

  // Update bat_auction_url from discovery_url if needed
  for (const vehicle of vehiclesWithBatUrls) {
    if (!vehicle.bat_auction_url && vehicle.discovery_url) {
      // Try to normalize the URL
      let url = vehicle.discovery_url;
      if (!url.endsWith('/')) {
        url = url + '/';
      }
      
      if (!DRY_RUN) {
        await supabase
          .from('vehicles')
          .update({ bat_auction_url: url })
          .eq('id', vehicle.id);
      }
      vehicle.bat_auction_url = url;
    }
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const results = [];

  console.log('🔄 Processing vehicles...\n');

  for (const vehicle of vehiclesWithBatUrls) {
    processed++;
    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim();
    
    console.log(`[${processed}/${vehiclesWithBatUrls.length}] ${vehicleName}`);
    console.log(`   Vehicle ID: ${vehicle.id}`);
    
    if (!vehicle.bat_auction_url) {
      console.log(`   ⚠️  Skipping: No BaT URL`);
      failed++;
      continue;
    }

    console.log(`   URL: ${vehicle.bat_auction_url}`);

    if (DRY_RUN) {
      console.log(`   🔍 DRY RUN: Would call bat-reextract`);
      succeeded++;
      continue;
    }

    try {
      const { data, error } = await supabase.functions.invoke('bat-simple-extract', {
        body: { 
          url: vehicle.bat_auction_url,
          vehicle_id: vehicle.id,
          save_to_db: true
        },
        timeout: 90000  // 90 second timeout for extraction
      });

      if (error) {
        console.log(`   ❌ Error: ${error.message}`);
        failed++;
        results.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicleName,
          success: false,
          error: error.message
        });
        continue;
      }

      if (data && data.success !== false) {
        console.log(`   ✅ Success`);
        if (data.extracted) {
          const ext = data.extracted;
          console.log(`   Updated: ${ext.title || 'N/A'}`);
          if (ext.sale_price) console.log(`   Sale Price: $${ext.sale_price.toLocaleString()}`);
          if (ext.seller_username) console.log(`   Seller: @${ext.seller_username}`);
          if (ext.bid_count) console.log(`   Bids: ${ext.bid_count} | Views: ${ext.view_count || 'N/A'}`);
        }
        succeeded++;
        results.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicleName,
          success: true,
          data: data.extracted
        });
      } else {
        console.log(`   ⚠️  Failed: ${data?.error || 'Unknown error'}`);
        failed++;
        results.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicleName,
          success: false,
          error: data?.error || 'No results returned'
        });
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.log(`   ❌ Exception: ${err.message}`);
      failed++;
      results.push({
        vehicle_id: vehicle.id,
        vehicle_name: vehicleName,
        success: false,
        error: err.message
      });
    }

    console.log('');
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('❌ Failed vehicles:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.vehicle_name || r.vehicle_id}: ${r.error}`);
      });
    console.log('');
  }

  console.log('✅ Done!');
}

backfillOrganizationVehicles()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });


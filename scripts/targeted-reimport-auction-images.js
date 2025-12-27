#!/usr/bin/env node
/**
 * Targeted re-import for auction sites (Cars & Bids, BaT, etc.)
 * Focuses on vehicles we can reliably re-extract from
 * Run: node scripts/targeted-reimport-auction-images.js [batch-size] [start-index]
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

const BATCH_SIZE = parseInt(process.argv[2]) || 5;
const START_INDEX = parseInt(process.argv[3]) || 0;

// Auction sites we can reliably re-extract from
const AUCTION_SITES = [
  'carsandbids.com',
  'bringatrailer.com',
  'mecum.com',
  'barrett-jackson.com',
  'barrettjackson.com',
  'pcarmarket.com'
];

function isAuctionSite(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return AUCTION_SITES.some(site => lower.includes(site));
}

async function targetedReimport() {
  console.log(`🎯 Targeted re-import for auction sites...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Step 1: Find auction site vehicles needing re-import
  console.log('   Finding auction vehicles needing re-import...');
  
  const { data: allVehicles, error: findError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url')
    .not('discovery_url', 'is', null)
    .limit(10000);
  
  if (findError) {
    console.error('❌ Error:', findError);
    return;
  }
  
  // Filter to auction sites that need re-import
  const vehiclesNeedingReimport = [];
  
  for (const vehicle of allVehicles || []) {
    const discoveryUrl = vehicle.discovery_url || vehicle.platform_url;
    
    if (!discoveryUrl || !isAuctionSite(discoveryUrl)) continue;
    
    // Check for /video URLs
    if (discoveryUrl.includes('/video') || discoveryUrl.endsWith('/video')) {
      vehiclesNeedingReimport.push({
        ...vehicle,
        cleanUrl: discoveryUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/'),
        issue: 'video_url'
      });
      continue;
    }
    
    // Check image count
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_primary, is_document')
      .eq('vehicle_id', vehicle.id);
    
    const allImages = images || [];
    const nonDocumentImages = allImages.filter(img => !img.is_document);
    const imageCount = nonDocumentImages.length;
    
    // Check primary image
    const primaryImage = allImages.find(img => img.is_primary);
    const hasBadPrimary = primaryImage && (
      primaryImage.is_document ||
      primaryImage.image_url?.includes('import_queue') ||
      primaryImage.image_url?.includes('organization-logos')
    );
    
    // Include if:
    // - No images
    // - < 5 images
    // - Bad primary image
    if (imageCount === 0 || imageCount < 5 || hasBadPrimary) {
      vehiclesNeedingReimport.push({
        ...vehicle,
        cleanUrl: discoveryUrl,
        imageCount,
        hasBadPrimary,
        issue: imageCount === 0 ? 'no_images' : imageCount < 5 ? 'few_images' : 'bad_primary'
      });
    }
  }
  
  console.log(`📊 Found ${vehiclesNeedingReimport.length} auction vehicles needing re-import\n`);
  
  // Group by site for better reporting
  const bySite = {};
  vehiclesNeedingReimport.forEach(v => {
    const url = v.discovery_url || v.platform_url || '';
    const site = AUCTION_SITES.find(s => url.includes(s)) || 'unknown';
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(v);
  });
  
  console.log('📋 Breakdown by site:');
  Object.entries(bySite).forEach(([site, vehicles]) => {
    console.log(`   ${site}: ${vehicles.length} vehicles`);
  });
  console.log('');
  
  const vehiclesToProcess = vehiclesNeedingReimport.slice(START_INDEX, START_INDEX + BATCH_SIZE);
  console.log(`🔄 Processing ${vehiclesToProcess.length} vehicles (${START_INDEX} to ${START_INDEX + vehiclesToProcess.length - 1})...\n`);
  
  const results = {
    processed: 0,
    fixed: 0,
    reExtracted: 0,
    errors: 0,
    skipped: 0
  };
  
  for (const vehicle of vehiclesToProcess) {
    try {
      let listingUrl = vehicle.cleanUrl || vehicle.discovery_url || vehicle.platform_url;
      
      if (!listingUrl) {
        results.skipped++;
        continue;
      }
      
      // Fix /video URLs first
      if (listingUrl.includes('/video') || listingUrl.endsWith('/video')) {
        listingUrl = listingUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/');
        
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            discovery_url: listingUrl,
            platform_url: listingUrl
          })
          .eq('id', vehicle.id);
        
        if (updateError) {
          console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: URL update failed - ${updateError.message}`);
          results.errors++;
          continue;
        }
        
        results.fixed++;
        console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Fixed /video URL`);
      }
      
      // Re-extract images using extract-premium-auction
      console.log(`   🔄 Re-extracting: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'} [${vehicle.issue}]`);
      console.log(`      ${listingUrl}`);
      
      const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
        body: {
          url: listingUrl,
          max_vehicles: 1,
          debug: false
        }
      });
      
      if (extractError) {
        console.error(`   ❌ Extraction failed: ${extractError.message}`);
        results.errors++;
      } else {
        const extractedVehicles = extractData?.vehicles_extracted || [];
        if (extractedVehicles.length > 0) {
          const imageCount = extractedVehicles[0]?.images?.length || 0;
          console.log(`   ✅ Re-extracted ${imageCount} images`);
          results.reExtracted++;
        } else {
          console.log(`   ⚠️  No vehicles extracted (may already exist)`);
          results.skipped++;
        }
      }
      
      results.processed++;
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Processed: ${results.processed} vehicles`);
  console.log(`   Fixed URLs: ${results.fixed} vehicles`);
  console.log(`   Re-extracted: ${results.reExtracted} vehicles`);
  console.log(`   Skipped: ${results.skipped} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  
  const remaining = vehiclesNeedingReimport.length - (START_INDEX + vehiclesToProcess.length);
  if (remaining > 0) {
    console.log(`\n💡 ${remaining} vehicles remaining. Run again with:`);
    console.log(`   node scripts/targeted-reimport-auction-images.js ${BATCH_SIZE} ${START_INDEX + BATCH_SIZE}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
  }
}

targetedReimport().catch(console.error);


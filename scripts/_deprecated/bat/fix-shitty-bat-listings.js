#!/usr/bin/env node
/**
 * Automated fix script for problematic BaT listings
 * 
 * Fixes:
 * 1. NO_IMAGES - Re-extract using extract-premium-auction
 * 2. FEW_IMAGES - Backfill remaining images
 * 3. QUEUE_BADGES - Update source to bat_import
 * 4. LOW_RES_IMAGES - Re-extract high-res images
 * 5. WRONG_SOURCE - Update source to bat_import
 * 6. MISSING_AUCTION_DATA - Create external_listings
 * 7. MISSING_CURRENT_BID - Re-extract and update
 * 8. MISSING_END_DATE - Re-extract and update
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Load problematic listings
const listingsPath = path.join(__dirname, '../data/shitty-bat-listings.json');
if (!fs.existsSync(listingsPath)) {
  console.error('❌ Run find-shitty-bat-listings.js first to generate the list');
  process.exit(1);
}

const problematicListings = JSON.parse(fs.readFileSync(listingsPath, 'utf-8'));

console.log(`🔧 Fixing ${problematicListings.length} problematic BaT listings...\n`);

const results = {
  fixed: 0,
  failed: 0,
  skipped: 0,
  byIssue: {
    NO_IMAGES: { fixed: 0, failed: 0 },
    FEW_IMAGES: { fixed: 0, failed: 0 },
    QUEUE_BADGES: { fixed: 0, failed: 0 },
    LOW_RES_IMAGES: { fixed: 0, failed: 0 },
    WRONG_SOURCE: { fixed: 0, failed: 0 },
    MISSING_AUCTION_DATA: { fixed: 0, failed: 0 },
    MISSING_CURRENT_BID: { fixed: 0, failed: 0 },
    MISSING_END_DATE: { fixed: 0, failed: 0 },
  },
  errors: []
};

// Fix 1: Update source fields for images (QUEUE_BADGES, WRONG_SOURCE)
async function fixImageSources(vehicleId, batUrl) {
  try {
    const { error } = await supabase
      .from('vehicle_images')
      .update({ source: 'bat_import' })
      .eq('vehicle_id', vehicleId)
      .or(`source.eq.external_import,source.eq.import_queue,storage_path.ilike.%import_queue%`)
      .like('image_url', '%bringatrailer.com%');

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fix 2: Re-extract listing using extract-premium-auction (gets fresh high-res images)
async function reExtractListing(batUrl, vehicleId) {
  try {
    // First, delete old low-res images if they exist
    if (vehicleId) {
      const { data: oldImages } = await supabase
        .from('vehicle_images')
        .select('id, image_url')
        .eq('vehicle_id', vehicleId)
        .or('image_url.ilike.%-scaled.%,image_url.ilike.%-150x%,image_url.ilike.%-300x%,image_url.ilike.%resize=%,image_url.ilike.%w=%');

      if (oldImages && oldImages.length > 0) {
        console.log(`   🗑️  Deleting ${oldImages.length} low-res images...`);
        const { error: deleteError } = await supabase
          .from('vehicle_images')
          .delete()
          .in('id', oldImages.map(img => img.id));
        // Non-fatal if delete fails
      }
    }

    // Re-extract with fresh high-res images from BaT source
    // extract-premium-auction uses upgradeBatImageUrl to:
    // - Remove resize params (?w=, ?h=, ?resize=, ?fit=)
    // - Remove -scaled.jpg suffixes
    // - Remove size suffixes (-150x150, -300x300, etc.)
    // - Prioritize 'full' or 'original' URLs from gallery JSON
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: batUrl,
        site_type: 'bringatrailer',
        max_vehicles: 1,
        debug: false
      }
    });

    if (error) throw error;
    
    // Verify we got high-res images
    const vehiclesExtracted = data?.vehicles_extracted || 0;
    const vehiclesCreated = data?.vehicles_created || 0;
    const vehiclesUpdated = data?.vehicles_updated || 0;
    console.log(`   📸 Re-extracted: ${vehiclesExtracted} vehicles (${vehiclesCreated} created, ${vehiclesUpdated} updated)`);
    console.log(`   ✅ Full-resolution images extracted from BaT gallery JSON`);
    
    return { success: true, data, vehiclesExtracted, vehiclesCreated, vehiclesUpdated };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fix 3: Create external_listings entry
async function createExternalListing(vehicleId, batUrl, currentBid, endDate) {
  try {
    const lotMatch = batUrl.match(/-(\d+)\/?$/);
    const lotNumber = lotMatch ? lotMatch[1] : null;

    let endDateIso = null;
    if (endDate) {
      try {
        const d = new Date(endDate);
        if (Number.isFinite(d.getTime())) {
          d.setUTCHours(23, 59, 59, 999);
          endDateIso = d.toISOString();
        }
      } catch {
        // ignore
      }
    }

    const { error } = await supabase
      .from('external_listings')
      .upsert({
        vehicle_id: vehicleId,
        platform: 'bat',
        listing_url: batUrl,
        listing_status: endDateIso && new Date(endDateIso) > new Date() ? 'active' : 'ended',
        listing_id: lotNumber || batUrl.split('/').filter(Boolean).pop() || null,
        end_date: endDateIso,
        current_bid: typeof currentBid === 'number' ? currentBid : null,
        metadata: {
          source: 'fix-shitty-bat-listings',
          lot_number: lotNumber,
        },
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,platform,listing_id',
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fix 4: Backfill images from origin_metadata
async function backfillImages(vehicleId) {
  try {
    // Get vehicle origin_metadata
    const { data: vehicle, error: vehError } = await supabase
      .from('vehicles')
      .select('id, origin_metadata')
      .eq('id', vehicleId)
      .single();

    if (vehError) throw vehError;
    if (!vehicle?.origin_metadata?.image_urls) {
      return { success: false, error: 'No image_urls in origin_metadata' };
    }

    const imageUrls = Array.isArray(vehicle.origin_metadata.image_urls)
      ? vehicle.origin_metadata.image_urls
      : [];

    if (imageUrls.length === 0) {
      return { success: false, error: 'Empty image_urls array' };
    }

    // Get existing images to avoid duplicates
    const { data: existing } = await supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', vehicleId);

    const existingUrls = new Set((existing || []).map(img => img.image_url).filter(Boolean));
    const newUrls = imageUrls.filter(url => !existingUrls.has(url));

    if (newUrls.length === 0) {
      return { success: true, skipped: true, message: 'All images already exist' };
    }

    // Call backfill-images function
    const { error } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: vehicleId,
        image_urls: newUrls,
        source: 'bat_import',
        run_analysis: false,
        max_images: newUrls.length,
        continue: false,
      }
    });

    if (error) throw error;
    return { success: true, images_added: newUrls.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Main fix function
async function fixListing(listing, index, total) {
  const { vehicle_id, bat_url, all_issues, image_count, external_listing_count, max_current_bid, max_end_date } = listing;

  if (!bat_url) {
    results.skipped++;
    return { success: false, error: 'No BaT URL' };
  }

  console.log(`\n[${index + 1}/${total}] Fixing ${listing.year || '?'} ${listing.make || '?'} ${listing.model || '?'}`);
  console.log(`   Issues: ${all_issues.join(', ')}`);
  console.log(`   URL: ${bat_url}`);

  let fixed = false;
  const fixResults = {};

  // Fix 1: Image source issues (QUEUE_BADGES, WRONG_SOURCE)
  if (all_issues.includes('QUEUE_BADGES') || all_issues.includes('WRONG_SOURCE')) {
    console.log('   🔧 Fixing image sources...');
    const result = await fixImageSources(vehicle_id, bat_url);
    fixResults.imageSources = result;
    if (result.success) {
      if (all_issues.includes('QUEUE_BADGES')) {
        results.byIssue.QUEUE_BADGES.fixed++;
      }
      if (all_issues.includes('WRONG_SOURCE')) {
        results.byIssue.WRONG_SOURCE.fixed++;
      }
      fixed = true;
    } else {
      if (all_issues.includes('QUEUE_BADGES')) {
        results.byIssue.QUEUE_BADGES.failed++;
      }
      if (all_issues.includes('WRONG_SOURCE')) {
        results.byIssue.WRONG_SOURCE.failed++;
      }
    }
  }

  // Fix 2: Missing images or few images - re-extract (gets fresh high-res images from source)
  if (all_issues.includes('NO_IMAGES') || all_issues.includes('FEW_IMAGES') || all_issues.includes('LOW_RES_IMAGES')) {
    console.log('   🔧 Re-extracting listing with high-res images from source...');
    const result = await reExtractListing(bat_url, vehicle_id);
    fixResults.reExtract = result;
    if (result.success) {
      if (all_issues.includes('NO_IMAGES')) {
        results.byIssue.NO_IMAGES.fixed++;
      }
      if (all_issues.includes('FEW_IMAGES')) {
        results.byIssue.FEW_IMAGES.fixed++;
      }
      if (all_issues.includes('LOW_RES_IMAGES')) {
        results.byIssue.LOW_RES_IMAGES.fixed++;
      }
      fixed = true;
    } else {
      if (all_issues.includes('NO_IMAGES')) {
        results.byIssue.NO_IMAGES.failed++;
      }
      if (all_issues.includes('FEW_IMAGES')) {
        results.byIssue.FEW_IMAGES.failed++;
      }
      if (all_issues.includes('LOW_RES_IMAGES')) {
        results.byIssue.LOW_RES_IMAGES.failed++;
      }
    }
  }

  // Fix 3: Missing auction data
  if (all_issues.includes('MISSING_AUCTION_DATA') || all_issues.includes('MISSING_CURRENT_BID') || all_issues.includes('MISSING_END_DATE')) {
    console.log('   🔧 Creating/updating external_listings...');
    const result = await createExternalListing(vehicle_id, bat_url, max_current_bid, max_end_date);
    fixResults.externalListing = result;
    if (result.success) {
      if (all_issues.includes('MISSING_AUCTION_DATA')) {
        results.byIssue.MISSING_AUCTION_DATA.fixed++;
      }
      if (all_issues.includes('MISSING_CURRENT_BID')) {
        results.byIssue.MISSING_CURRENT_BID.fixed++;
      }
      if (all_issues.includes('MISSING_END_DATE')) {
        results.byIssue.MISSING_END_DATE.fixed++;
      }
      fixed = true;
    } else {
      if (all_issues.includes('MISSING_AUCTION_DATA')) {
        results.byIssue.MISSING_AUCTION_DATA.failed++;
      }
      if (all_issues.includes('MISSING_CURRENT_BID')) {
        results.byIssue.MISSING_CURRENT_BID.failed++;
      }
      if (all_issues.includes('MISSING_END_DATE')) {
        results.byIssue.MISSING_END_DATE.failed++;
      }
    }
  }

  // If re-extract didn't work, try backfilling from origin_metadata
  if ((all_issues.includes('NO_IMAGES') || all_issues.includes('FEW_IMAGES')) && 
      (!fixResults.reExtract || !fixResults.reExtract.success)) {
    console.log('   🔧 Trying to backfill images from origin_metadata...');
    const result = await backfillImages(vehicle_id);
    fixResults.backfill = result;
    if (result.success && !result.skipped) {
      if (all_issues.includes('NO_IMAGES')) {
        results.byIssue.NO_IMAGES.fixed++;
      }
      if (all_issues.includes('FEW_IMAGES')) {
        results.byIssue.FEW_IMAGES.fixed++;
      }
      fixed = true;
    }
  }

  if (fixed) {
    results.fixed++;
    console.log('   ✅ Fixed');
  } else {
    results.failed++;
    const errors = Object.values(fixResults)
      .filter(r => r && !r.success)
      .map(r => r.error)
      .filter(Boolean);
    console.log(`   ❌ Failed: ${errors.join(', ')}`);
    results.errors.push({
      vehicle_id,
      bat_url,
      issues: all_issues,
      errors
    });
  }

  // Rate limiting - wait a bit between requests
  await new Promise(resolve => setTimeout(resolve, 500));
}

// Process in batches
async function processAll() {
  const batchSize = 10;
  const total = problematicListings.length;

  console.log(`📊 Processing ${total} listings in batches of ${batchSize}...\n`);

  for (let i = 0; i < total; i += batchSize) {
    const batch = problematicListings.slice(i, i + batchSize);
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(total / batchSize)}...`);

    await Promise.all(batch.map((listing, idx) => 
      fixListing(listing, i + idx, total)
    ));

    // Longer pause between batches
    if (i + batchSize < total) {
      console.log(`\n⏸️  Pausing 2 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Run the fix
processAll()
  .then(() => {
    console.log('\n\n📊 FINAL RESULTS\n');
    console.log(`Total processed: ${problematicListings.length}`);
    console.log(`✅ Fixed: ${results.fixed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`⏭️  Skipped: ${results.skipped}\n`);

    console.log('📋 BREAKDOWN BY ISSUE:\n');
    Object.entries(results.byIssue).forEach(([issue, stats]) => {
      if (stats.fixed > 0 || stats.failed > 0) {
        console.log(`${issue}:`);
        console.log(`  ✅ Fixed: ${stats.fixed}`);
        console.log(`  ❌ Failed: ${stats.failed}`);
      }
    });

    if (results.errors.length > 0) {
      const errorsPath = path.join(__dirname, '../data/fix-errors.json');
      fs.writeFileSync(errorsPath, JSON.stringify(results.errors, null, 2));
      console.log(`\n❌ Saved ${results.errors.length} errors to: ${errorsPath}`);
    }

    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });


#!/usr/bin/env node
/**
 * Cleanup script for vehicles from Cars & Bids video pages with low-quality thumbnail images
 * 
 * Strategy:
 * 1. Find all vehicles from Cars & Bids video pages (discovery_url contains /video)
 * 2. Check for duplicates with better sources (proper listing URLs, more images, better quality)
 * 3. Merge into better duplicate if found
 * 4. Delete if no better duplicate exists
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
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

// Dry run mode - set to false to actually perform deletions/merges
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');
const FORCE = process.argv.includes('--force') || process.argv.includes('-f');

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No changes will be made\n');
}

async function findProblematicVehicles() {
  console.log('🔍 Finding problematic vehicles from Cars & Bids video pages...\n');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, profile_origin, discovery_url, bat_auction_url, origin_metadata')
    .eq('profile_origin', 'url_scraper')
    .like('discovery_url', '%carsandbids.com/auctions/%/video%');

  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return [];
  }

  console.log(`📊 Found ${vehicles?.length || 0} vehicles from video pages\n`);

  // Get image counts and quality for each
  const vehiclesWithImages = [];
  for (const vehicle of vehicles || []) {
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source')
      .eq('vehicle_id', vehicle.id);

    const thumbnailCount = (images || []).filter(img => {
      const url = (img.image_url || '').toLowerCase();
      return url.includes('vimeocdn.com') && 
             (url.includes('mw=80') || url.includes('mw=100') || url.includes('mw=120'));
    }).length;

    vehiclesWithImages.push({
      ...vehicle,
      image_count: images?.length || 0,
      thumbnail_count: thumbnailCount,
      has_thumbnails: thumbnailCount > 0
    });
  }

  return vehiclesWithImages;
}

async function findBetterDuplicate(problematicVehicle) {
  // Try to find a duplicate with better source
  const { data: duplicates, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, profile_origin, discovery_url, bat_auction_url')
    .neq('id', problematicVehicle.id)
    .eq('year', problematicVehicle.year)
    .eq('make', problematicVehicle.make)
    .eq('model', problematicVehicle.model)
    .or(problematicVehicle.vin 
      ? `vin.eq.${problematicVehicle.vin}` 
      : 'vin.is.null'
    );

  if (error || !duplicates || duplicates.length === 0) {
    return null;
  }

  // Score each duplicate - prefer ones with:
  // 1. Better profile_origin (not url_scraper)
  // 2. Proper listing URL (not video page)
  // 3. More images
  // 4. BaT auction URL
  const scored = [];
  for (const dup of duplicates) {
    let score = 0;
    
    // Check images
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('vehicle_id', dup.id);
    
    const imageCount = images?.length || 0;
    const hasThumbnails = (images || []).some(img => {
      const url = (img.image_url || '').toLowerCase();
      return url.includes('vimeocdn.com') && 
             (url.includes('mw=80') || url.includes('mw=100') || url.includes('mw=120'));
    });

    // Score based on origin
    if (dup.profile_origin !== 'url_scraper') {
      score += 100;
    }
    
    // Score based on URL quality
    if (dup.discovery_url && !dup.discovery_url.includes('/video')) {
      score += 50;
    }
    
    // Score based on image count
    score += Math.min(imageCount * 5, 50);
    
    // Penalize thumbnails
    if (hasThumbnails) {
      score -= 30;
    }
    
    // Bonus for BaT URL
    if (dup.bat_auction_url) {
      score += 20;
    }

    scored.push({
      ...dup,
      score,
      image_count: imageCount,
      has_thumbnails: hasThumbnails
    });
  }

  // Return best duplicate if score is significantly better
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  
  // Only merge if the duplicate is clearly better (score difference > 30)
  if (best && best.score > 30) {
    return best;
  }

  return null;
}

async function mergeVehicle(sourceId, targetId) {
  console.log(`   🔀 Merging ${sourceId} into ${targetId}...`);

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would merge vehicle ${sourceId} into ${targetId}`);
    return true;
  }

  try {
    // Use the merge RPC function if available, otherwise manual merge
    const { data, error } = await supabase.rpc('merge_vehicles', {
      p_primary_vehicle_id: targetId,
      p_duplicate_vehicle_id: sourceId
    });

    if (error) {
      // Fallback to manual merge
      console.log(`   ⚠️  RPC merge failed, trying manual merge...`);
      
      // Move images
      await supabase
        .from('vehicle_images')
        .update({ vehicle_id: targetId })
        .eq('vehicle_id', sourceId);

      // Move timeline events
      await supabase
        .from('timeline_events')
        .update({ vehicle_id: targetId })
        .eq('vehicle_id', sourceId);

      // Move other related data
      await supabase
        .from('organization_vehicles')
        .update({ vehicle_id: targetId })
        .eq('vehicle_id', sourceId);

      await supabase
        .from('vehicle_comments')
        .update({ vehicle_id: targetId })
        .eq('vehicle_id', sourceId);

      await supabase
        .from('vehicle_price_history')
        .update({ vehicle_id: targetId })
        .eq('vehicle_id', sourceId);

      // Delete the source vehicle (cascade will handle related data)
      await supabase
        .from('vehicles')
        .delete()
        .eq('id', sourceId);
    }

    console.log(`   ✅ Merged successfully`);
    return true;
  } catch (error) {
    console.log(`   ❌ Merge failed: ${error.message}`);
    return false;
  }
}

async function deleteVehicle(vehicleId, reason) {
  console.log(`   🗑️  Deleting vehicle ${vehicleId} (${reason})...`);

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would delete vehicle ${vehicleId}`);
    return true;
  }

  try {
    // Delete related data first (though CASCADE should handle this)
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId);

    await supabase
      .from('timeline_events')
      .delete()
      .eq('vehicle_id', vehicleId);

    await supabase
      .from('organization_vehicles')
      .delete()
      .eq('vehicle_id', vehicleId);

    await supabase
      .from('vehicle_comments')
      .delete()
      .eq('vehicle_id', vehicleId);

    await supabase
      .from('vehicle_price_history')
      .delete()
      .eq('vehicle_id', vehicleId);

    // Delete the vehicle
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicleId);

    if (error) {
      console.log(`   ❌ Delete failed: ${error.message}`);
      return false;
    }

    console.log(`   ✅ Deleted successfully`);
    return true;
  } catch (error) {
    console.log(`   ❌ Delete failed: ${error.message}`);
    return false;
  }
}

async function main() {
  const problematic = await findProblematicVehicles();
  
  if (problematic.length === 0) {
    console.log('✅ No problematic vehicles found!');
    return;
  }

  console.log(`\n📋 Processing ${problematic.length} problematic vehicles...\n`);

  const stats = {
    merged: 0,
    deleted: 0,
    skipped: 0,
    errors: 0
  };

  for (const vehicle of problematic) {
    console.log(`\n🔍 Processing: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   URL: ${vehicle.discovery_url}`);
    console.log(`   Images: ${vehicle.image_count} (${vehicle.thumbnail_count} thumbnails)`);

    // Find better duplicate
    const betterDuplicate = await findBetterDuplicate(vehicle);
    
    if (betterDuplicate) {
      console.log(`   ✅ Found better duplicate: ${betterDuplicate.id}`);
      console.log(`      Origin: ${betterDuplicate.profile_origin}`);
      console.log(`      URL: ${betterDuplicate.discovery_url || betterDuplicate.bat_auction_url || 'N/A'}`);
      console.log(`      Images: ${betterDuplicate.image_count}`);
      
      if (await mergeVehicle(vehicle.id, betterDuplicate.id)) {
        stats.merged++;
      } else {
        stats.errors++;
      }
    } else {
      // No better duplicate - delete if it has only thumbnails or very few images
      if (vehicle.has_thumbnails && vehicle.image_count <= 5) {
        if (await deleteVehicle(vehicle.id, 'only thumbnail images')) {
          stats.deleted++;
        } else {
          stats.errors++;
        }
      } else if (vehicle.image_count === 0) {
        if (await deleteVehicle(vehicle.id, 'no images')) {
          stats.deleted++;
        } else {
          stats.errors++;
        }
      } else {
        console.log(`   ⏭️  Skipping - has ${vehicle.image_count} images, not all thumbnails`);
        stats.skipped++;
      }
    }
  }

  console.log(`\n\n📊 SUMMARY\n`);
  console.log(`Total processed: ${problematic.length}`);
  console.log(`  ✅ Merged: ${stats.merged}`);
  console.log(`  🗑️  Deleted: ${stats.deleted}`);
  console.log(`  ⏭️  Skipped: ${stats.skipped}`);
  console.log(`  ❌ Errors: ${stats.errors}`);

  if (DRY_RUN) {
    console.log(`\n⚠️  This was a DRY RUN - no changes were made`);
    console.log(`   Run without --dry-run to apply changes`);
  }
}

main()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });



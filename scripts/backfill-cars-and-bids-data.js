#!/usr/bin/env node

/**
 * BACKFILL CARS & BIDS MISSING DATA
 * 
 * Re-extracts missing data for Cars & Bids profiles:
 * - Missing vehicle fields (mileage, color, transmission, engine, drivetrain)
 * - Missing images (many profiles have 0-9 images when 40-250+ exist)
 * - Missing comments (many profiles have 0-5 comments when 20-400+ exist)
 * - Missing auction metadata
 * 
 * Usage:
 *   node scripts/backfill-cars-and-bids-data.js [--limit=N] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-premium-auction`;
const COMMENTS_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-cars-and-bids-comments`;

async function findProfilesWithMissingData(limit = 50, prioritizeActive = true) {
  console.log(`\n🔍 Finding Cars & Bids profiles with missing data...\n`);
  
  // Use LEFT JOIN (no !inner) to include all vehicles, even without external_listings
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      discovery_url,
      mileage,
      color,
      transmission,
      engine_size,
      drivetrain,
      external_listings(listing_status, end_date)
    `)
    .or('discovery_url.ilike.%carsandbids.com%,origin_metadata->>source.ilike.%cars%bid%')
    .limit(500); // Get enough to filter and sort
    
  if (error) {
    console.error('Error querying vehicles:', error);
    return [];
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('   No vehicles found matching criteria');
    return [];
  }
  
  console.log(`   Found ${vehicles.length} total Cars & Bids vehicles to check`);
  
  // Get comment counts for each vehicle
  const profilesWithCounts = await Promise.all(
    vehicles.map(async (v) => {
      const commentsResult = await supabase
        .from('auction_comments')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', v.id)
        .eq('platform', 'cars_and_bids');
      
      const commentCount = commentsResult.count || 0;
      
      // Check image count
      const imagesResult = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', v.id);
      const imageCount = imagesResult.count || 0;
      
      const hasMissingFields = !v.mileage || !v.color || !v.transmission || !v.engine_size || !v.drivetrain;
      const hasLowImages = imageCount < 30; // Cars & Bids typically has 40-100+ images
      
      // Get listing info from joined external_listings (could be array or single or null)
      const listings = Array.isArray(v.external_listings) 
        ? v.external_listings.filter(Boolean)
        : (v.external_listings ? [v.external_listings] : []);
      const listing = listings.find(l => l && (l.listing_status || l.end_date)) || listings[0] || null;
      const listingStatus = listing?.listing_status || null;
      const endDate = listing?.end_date || null;
      const isActive = listingStatus === 'active';
      const isRecent = endDate ? new Date(endDate) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : false;
      
      return {
        id: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        discovery_url: v.discovery_url,
        mileage: v.mileage,
        color: v.color,
        transmission: v.transmission,
        engine_size: v.engine_size,
        drivetrain: v.drivetrain,
        imageCount,
        commentCount,
        hasMissingFields,
        hasLowImages,
        hasLowComments: commentCount < 10,
        listingStatus,
        isActive,
        isRecent,
      };
    })
  );
  
  // Filter for missing data - prioritize low images (most visible issue on homepage)
  const filtered = profilesWithCounts.filter(p => 
    p.hasLowImages || p.hasMissingFields || p.hasLowComments
  );
  
  console.log(`   ${filtered.length} profiles have missing data`);
  
  // Sort: prioritize low images first (most visible on homepage), then active/recent, then missing fields
  // OLD listings (ended >90 days ago) are less likely to have data available
  filtered.sort((a, b) => {
    // First: vehicles with very low image counts (< 15 images) get highest priority
    const aVeryLowImages = a.imageCount < 15;
    const bVeryLowImages = b.imageCount < 15;
    if (aVeryLowImages !== bVeryLowImages) return aVeryLowImages ? -1 : 1;
    
    // Second: vehicles with low images (< 30)
    if (a.hasLowImages !== b.hasLowImages) return a.hasLowImages ? -1 : 1;
    
    // Third: active listings (data most likely available)
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    
    // Fourth: recent listings (last 90 days)
    if (a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
    
    // Fifth: missing fields
    if (a.hasMissingFields !== b.hasMissingFields) return a.hasMissingFields ? -1 : 1;
    
    // Finally: sort by image count (lowest first)
    return a.imageCount - b.imageCount;
  });
  
  // Warn about old listings
  const activeCount = filtered.filter(p => p.isActive).length;
  const recentCount = filtered.filter(p => p.isRecent && !p.isActive).length;
  const oldCount = filtered.length - activeCount - recentCount;
  
  if (oldCount > 0) {
    console.log(`   ⚠️  ${oldCount} old listings (>90 days) - data may not be available on page`);
  }
  if (activeCount > 0) {
    console.log(`   ✅ ${activeCount} active listings - best chance for complete data`);
  }
  if (recentCount > 0) {
    console.log(`   ⚠️  ${recentCount} recent listings - data should be available`);
  }
  
  return filtered.slice(0, limit);
}

async function reExtractVehicleData(vehicleId, listingUrl, dryRun = false) {
  console.log(`\n📥 Re-extracting data for: ${listingUrl}`);
  console.log(`   Vehicle ID: ${vehicleId}`);
  
  if (dryRun) {
    console.log('   [DRY RUN] Would call extract-premium-auction');
    return { success: true, dryRun: true };
  }
  
  try {
    // Step 1: Re-extract core vehicle data (including images)
    console.log('   → Step 1: Extracting core vehicle data and images...');
    const extractResponse = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: listingUrl,
        site_type: 'carsandbids',
        max_vehicles: 1,
        debug: false,
        download_images: false, // Extract image URLs but don't download (images are stored as URLs)
      }),
    });
    
    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      throw new Error(`Extract failed: ${extractResponse.status} ${errorText}`);
    }
    
    const extractResult = await extractResponse.json();
    console.log(`   ✅ Extracted: ${extractResult.vehicles_extracted || 0} vehicles`);
    
    // Step 2: Extract comments (separate function)
    console.log('   → Step 2: Extracting comments...');
    try {
      const commentsResponse = await fetch(COMMENTS_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auction_url: listingUrl,
          vehicle_id: vehicleId,
        }),
      });
      
      if (commentsResponse.ok) {
        const commentsResult = await commentsResponse.json();
        console.log(`   ✅ Comments extracted: ${commentsResult.comments_extracted || 0}`);
      } else {
        console.warn(`   ⚠️ Comments extraction failed: ${commentsResponse.status}`);
      }
    } catch (commentError) {
      console.warn(`   ⚠️ Comments extraction error: ${commentError.message}`);
    }
    
    return {
      success: true,
      vehiclesExtracted: extractResult.vehicles_extracted || 0,
      vehiclesCreated: extractResult.vehicles_created || 0,
      vehiclesUpdated: extractResult.vehicles_updated || 0,
    };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 50;
  const dryRun = args.includes('--dry-run');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  console.log(`\n🚀 Backfilling missing data for Cars & Bids profiles`);
  console.log(`   Limit: ${limit} profiles`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  try {
    // Find profiles with missing data
    const profiles = await findProfilesWithMissingData(limit);
    
    if (!profiles || profiles.length === 0) {
      console.log('✅ No profiles with missing data found!');
      return;
    }
    
    console.log(`\n📋 Found ${profiles.length} profiles with missing data:\n`);
    
    // Show summary
    const missingFields = profiles.filter(p => p.hasMissingFields).length;
    const lowImages = profiles.filter(p => p.hasLowImages).length;
    const veryLowImages = profiles.filter(p => p.imageCount < 15).length;
    const lowComments = profiles.filter(p => p.hasLowComments).length;
    const activeCount = profiles.filter(p => p.isActive).length;
    const recentCount = profiles.filter(p => p.isRecent && !p.isActive).length;
    
    console.log(`   Very low images (<15): ${veryLowImages}`);
    console.log(`   Low images (<30): ${lowImages}`);
    console.log(`   Missing vehicle fields (mileage/color/transmission/engine/drivetrain): ${missingFields}`);
    console.log(`   Low comment count (<10): ${lowComments}`);
    console.log(`   Active listings: ${activeCount}`);
    console.log(`   Recent listings (last 90 days): ${recentCount}`);
    console.log('');
    
    // Process each profile
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const vehicleId = profile.id;
      const listingUrl = profile.discovery_url || profile.platform_url;
      
      if (!listingUrl || !listingUrl.includes('carsandbids.com')) {
        console.log(`\n⚠️ Skipping ${vehicleId}: No valid Cars & Bids URL`);
        continue;
      }
      
      console.log(`\n[${i + 1}/${profiles.length}] Processing: ${profile.year || '?'} ${profile.make || '?'} ${profile.model || '?'}`);
      
      const result = await reExtractVehicleData(vehicleId, listingUrl, dryRun);
      
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
      }
      
      // Rate limiting: wait 2 seconds between requests to avoid overwhelming the API
      if (i < profiles.length - 1 && !dryRun) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`\n\n✅ Backfill complete!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Total: ${profiles.length}`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { findProfilesWithMissingData, reExtractVehicleData };


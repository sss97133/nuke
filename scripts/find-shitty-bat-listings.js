#!/usr/bin/env node
/**
 * Find all problematic BaT listings that need fixing
 * 
 * Issues detected:
 * - NO_IMAGES: No images at all
 * - FEW_IMAGES: 12 or fewer images (should have more from BaT)
 * - QUEUE_BADGES: Images with "Queue" badge instead of "BaT"
 * - LOW_RES_IMAGES: Images with resize/scaled parameters
 * - WRONG_SOURCE: Images not marked as bat_import
 * - MISSING_AUCTION_DATA: No external_listings entry for active auctions
 * - MISSING_CURRENT_BID: Active auction but no current_bid
 * - MISSING_END_DATE: Active auction but no end_date
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

async function findProblematicListings() {
  console.log('🔍 Finding problematic BaT listings...\n');

  // Get all BaT vehicles
  const { data: batVehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, listing_url, platform_url, discovery_url, bat_auction_url, auction_end_date, created_at')
    .or('listing_url.ilike.%bringatrailer.com%,platform_url.ilike.%bringatrailer.com%,discovery_url.ilike.%bringatrailer.com%,bat_auction_url.ilike.%bringatrailer.com%,listing_source.ilike.%bring a trailer%,platform_source.eq.bringatrailer,import_source.eq.bringatrailer');

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError);
    return;
  }

  console.log(`📊 Found ${batVehicles?.length || 0} BaT vehicles\n`);

  const problematic = [];
  const stats = {
    no_images: 0,
    few_images: 0,
    queue_badges: 0,
    low_res: 0,
    wrong_source: 0,
    missing_auction_data: 0,
    missing_current_bid: 0,
    missing_end_date: 0,
    total: 0
  };

  // Process in batches to avoid overwhelming the DB
  const batchSize = 50;
  for (let i = 0; i < (batVehicles || []).length; i += batchSize) {
    const batch = (batVehicles || []).slice(i, i + batchSize);
    const vehicleIds = batch.map(v => v.id);

    // Get image stats for this batch
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, source, storage_path, image_url, is_document')
      .in('vehicle_id', vehicleIds)
      .or('is_document.is.null,is_document.eq.false');

    if (imagesError) {
      console.warn(`⚠️  Error fetching images for batch: ${imagesError.message}`);
      continue;
    }

    // Get external_listings for this batch
    const { data: externalListings, error: listingsError } = await supabase
      .from('external_listings')
      .select('vehicle_id, current_bid, end_date, listing_status')
      .in('vehicle_id', vehicleIds)
      .eq('platform', 'bat');

    if (listingsError) {
      console.warn(`⚠️  Error fetching external_listings for batch: ${listingsError.message}`);
    }

    // Process each vehicle
    for (const vehicle of batch) {
      const vehicleImages = (images || []).filter(img => img.vehicle_id === vehicle.id);
      const vehicleListings = (externalListings || []).filter(el => el.vehicle_id === vehicle.id);

      const totalImages = vehicleImages.length;
      const batImportImages = vehicleImages.filter(img => img.source === 'bat_import').length;
      const queueImages = vehicleImages.filter(img => 
        img.storage_path?.toLowerCase().includes('import_queue') || 
        img.image_url?.toLowerCase().includes('import_queue')
      ).length;
      const lowResImages = vehicleImages.filter(img => {
        const url = (img.image_url || '').toLowerCase();
        return url.includes('-scaled.') || 
               url.includes('-150x') || 
               url.includes('-300x') || 
               url.includes('resize=') || 
               url.includes('w=');
      }).length;
      const batHostedImages = vehicleImages.filter(img => 
        img.image_url?.includes('bringatrailer.com/wp-content/uploads')
      ).length;

      const activeListing = vehicleListings.find(el => el.listing_status === 'active');
      const hasActiveListing = !!activeListing;
      const maxCurrentBid = vehicleListings.length > 0 
        ? Math.max(...vehicleListings.map(el => el.current_bid || 0))
        : null;
      const maxEndDate = vehicleListings.length > 0
        ? vehicleListings.map(el => el.end_date).filter(Boolean).sort().reverse()[0] || null
        : null;

      const issues = [];
      if (totalImages === 0) {
        issues.push('NO_IMAGES');
        stats.no_images++;
      } else if (totalImages <= 12) {
        issues.push('FEW_IMAGES');
        stats.few_images++;
      }
      if (queueImages > 0) {
        issues.push('QUEUE_BADGES');
        stats.queue_badges++;
      }
      if (lowResImages > 0) {
        issues.push('LOW_RES_IMAGES');
        stats.low_res++;
      }
      if (batImportImages === 0 && totalImages > 0) {
        issues.push('WRONG_SOURCE');
        stats.wrong_source++;
      }
      if (vehicleListings.length === 0) {
        issues.push('MISSING_AUCTION_DATA');
        stats.missing_auction_data++;
      }
      if (hasActiveListing && !maxCurrentBid) {
        issues.push('MISSING_CURRENT_BID');
        stats.missing_current_bid++;
      }
      if (hasActiveListing && !maxEndDate) {
        issues.push('MISSING_END_DATE');
        stats.missing_end_date++;
      }

      if (issues.length > 0) {
        const batUrl = vehicle.listing_url || vehicle.platform_url || vehicle.discovery_url || vehicle.bat_auction_url;
        problematic.push({
          vehicle_id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          bat_url: batUrl,
          image_count: totalImages,
          bat_import_count: batImportImages,
          queue_image_count: queueImages,
          low_res_count: lowResImages,
          bat_hosted_count: batHostedImages,
          external_listing_count: vehicleListings.length,
          max_current_bid: maxCurrentBid,
          max_end_date: maxEndDate,
          has_active_listing: hasActiveListing,
          primary_issue: issues[0],
          all_issues: issues,
          created_at: vehicle.created_at
        });
        stats.total++;
      }
    }

    process.stdout.write(`\r📊 Processed ${Math.min(i + batchSize, batVehicles.length)}/${batVehicles.length} vehicles...`);
  }

  console.log('\n\n📋 SUMMARY\n');
  console.log(`Total problematic listings: ${stats.total}`);
  console.log(`  - No images: ${stats.no_images}`);
  console.log(`  - Few images (≤12): ${stats.few_images}`);
  console.log(`  - Queue badges: ${stats.queue_badges}`);
  console.log(`  - Low-res images: ${stats.low_res}`);
  console.log(`  - Wrong source: ${stats.wrong_source}`);
  console.log(`  - Missing auction data: ${stats.missing_auction_data}`);
  console.log(`  - Missing current bid: ${stats.missing_current_bid}`);
  console.log(`  - Missing end date: ${stats.missing_end_date}\n`);

  // Group by primary issue
  const byIssue = {};
  problematic.forEach(item => {
    if (!byIssue[item.primary_issue]) {
      byIssue[item.primary_issue] = [];
    }
    byIssue[item.primary_issue].push(item);
  });

  console.log('📊 BREAKDOWN BY PRIMARY ISSUE\n');
  Object.entries(byIssue)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([issue, items]) => {
      console.log(`${issue}: ${items.length} listings`);
    });

  // Save to JSON file
  const outputPath = path.join(__dirname, '../data/shitty-bat-listings.json');
  fs.writeFileSync(outputPath, JSON.stringify(problematic, null, 2));
  console.log(`\n💾 Saved detailed list to: ${outputPath}`);

  // Save CSV for easy viewing
  const csvPath = path.join(__dirname, '../data/shitty-bat-listings.csv');
  const csvHeader = 'vehicle_id,year,make,model,bat_url,image_count,bat_import_count,queue_image_count,low_res_count,external_listing_count,max_current_bid,max_end_date,has_active_listing,primary_issue,all_issues\n';
  const csvRows = problematic.map(item => [
    item.vehicle_id,
    item.year || '',
    item.make || '',
    item.model || '',
    item.bat_url || '',
    item.image_count,
    item.bat_import_count,
    item.queue_image_count,
    item.low_res_count,
    item.external_listing_count,
    item.max_current_bid || '',
    item.max_end_date || '',
    item.has_active_listing,
    item.primary_issue,
    item.all_issues.join(';')
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows);
  console.log(`💾 Saved CSV to: ${csvPath}`);

  // Show sample of worst offenders
  console.log('\n🔴 TOP 20 WORST OFFENDERS\n');
  problematic
    .sort((a, b) => {
      // Sort by number of issues, then by image count (fewer is worse)
      if (b.all_issues.length !== a.all_issues.length) {
        return b.all_issues.length - a.all_issues.length;
      }
      return a.image_count - b.image_count;
    })
    .slice(0, 20)
    .forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.year || '?'} ${item.make || '?'} ${item.model || '?'}`);
      console.log(`   ID: ${item.vehicle_id}`);
      console.log(`   URL: ${item.bat_url || 'N/A'}`);
      console.log(`   Issues: ${item.all_issues.join(', ')}`);
      console.log(`   Images: ${item.image_count} (${item.bat_import_count} bat_import, ${item.queue_image_count} queue, ${item.low_res_count} low-res)`);
      console.log(`   External listings: ${item.external_listing_count}`);
      console.log('');
    });

  return problematic;
}

findProblematicListings()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });


#!/usr/bin/env node
/**
 * MONITOR PCARMARKET AUCTIONS
 * 
 * Checks all active PCarMarket auctions for:
 * - New bids
 * - New comments
 * - Final auction outcomes (sold vs RNM)
 * 
 * Can be run as a scheduled job or manually
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Monitor a single auction
 */
async function monitorAuction(vehicle) {
  const url = vehicle.discovery_url || vehicle.origin_metadata?.pcarmarket_url;
  if (!url) {
    console.log(`   ⚠️  No URL for vehicle ${vehicle.id}`);
    return { success: false, reason: 'no_url' };
  }

  try {
    // Call monitor function
    const { data, error } = await supabase.functions.invoke('monitor-pcarmarket-auction', {
      body: {
        vehicle_id: vehicle.id,
        listing_url: url
      }
    });

    if (error) {
      console.error(`   ❌ Error monitoring ${vehicle.id}:`, error.message);
      return { success: false, error: error.message };
    }

    const changes = data?.changes_detected || {};
    const update = data?.update || {};

    if (changes.bid_changed || changes.status_changed || changes.outcome_determined) {
      console.log(`   ✅ Updated: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      if (changes.bid_changed) {
        console.log(`      💰 New bid: $${(update.current_bid / 100).toLocaleString()}`);
      }
      if (changes.status_changed) {
        console.log(`      📊 Status: ${update.status}`);
      }
      if (changes.outcome_determined) {
        console.log(`      🎯 Outcome: ${update.auction_outcome}`);
      }
    } else {
      console.log(`   ✓ No changes: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    }

    return { success: true, data };

  } catch (error) {
    console.error(`   ❌ Error monitoring ${vehicle.id}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract comments for a vehicle
 */
async function extractComments(vehicle) {
  const url = vehicle.discovery_url || vehicle.origin_metadata?.pcarmarket_url;
  if (!url) {
    return { success: false, reason: 'no_url' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('extract-pcarmarket-comments', {
      body: {
        vehicle_id: vehicle.id,
        listing_url: url
      }
    });

    if (error) {
      console.error(`   ❌ Error extracting comments:`, error.message);
      return { success: false, error: error.message };
    }

    if (data.comment_count > 0) {
      console.log(`   💬 Extracted ${data.comment_count} comments`);
      if (data.bid_comments?.length > 0) {
        console.log(`      💰 Found ${data.bid_comments.length} bid comments`);
      }
    }

    return { success: true, data };

  } catch (error) {
    console.error(`   ❌ Error extracting comments:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main monitoring function
 */
async function monitorAllAuctions(options = {}) {
  const {
    checkBids = true,
    checkComments = true,
    checkOutcomes = true,
    limit = null,
    onlyActive = true
  } = options;

  console.log('\n🔍 Monitoring PCarMarket Auctions\n');
  console.log(`   Options:`);
  console.log(`   - Check bids: ${checkBids}`);
  console.log(`   - Check comments: ${checkComments}`);
  console.log(`   - Check outcomes: ${checkOutcomes}`);
  console.log(`   - Only active: ${onlyActive}`);
  console.log(`   - Limit: ${limit || 'all'}\n`);

  // Get all PCarMarket vehicles
  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata, auction_end_date, auction_outcome')
    .eq('profile_origin', 'pcarmarket_import')
    .order('updated_at', { ascending: false });

  if (onlyActive) {
    query = query.or('auction_end_date.is.null,auction_end_date.gt.' + new Date().toISOString());
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data: vehicles, error } = await query;

  if (error) {
    console.error('❌ Error fetching vehicles:', error.message);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('   No PCarMarket vehicles found');
    return;
  }

  console.log(`📋 Found ${vehicles.length} vehicles to monitor\n`);

  const results = {
    checked: 0,
    updated: 0,
    errors: 0,
    comments_extracted: 0
  };

  // Monitor each vehicle
  for (const vehicle of vehicles) {
    results.checked++;

    console.log(`\n[${results.checked}/${vehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

    // Check for bid/status updates
    if (checkBids || checkOutcomes) {
      const monitorResult = await monitorAuction(vehicle);
      if (monitorResult.success) {
        if (monitorResult.data?.changes_detected) {
          const changes = monitorResult.data.changes_detected;
          if (changes.bid_changed || changes.status_changed || changes.outcome_determined) {
            results.updated++;
          }
        }
      } else {
        results.errors++;
      }
    }

    // Extract comments
    if (checkComments) {
      const commentResult = await extractComments(vehicle);
      if (commentResult.success && commentResult.data?.comment_count > 0) {
        results.comments_extracted += commentResult.data.comment_count;
      }
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n\n📊 Monitoring Summary:');
  console.log(`   Vehicles checked: ${results.checked}`);
  console.log(`   Vehicles updated: ${results.updated}`);
  console.log(`   Comments extracted: ${results.comments_extracted}`);
  console.log(`   Errors: ${results.errors}`);
  console.log('\n✅ Monitoring complete!\n');
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const options = {
    checkBids: !args.includes('--no-bids'),
    checkComments: !args.includes('--no-comments'),
    checkOutcomes: !args.includes('--no-outcomes'),
    onlyActive: !args.includes('--include-ended'),
    limit: args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || null
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('\nUsage: node scripts/monitor-pcarmarket-auctions.js [options]\n');
    console.log('Options:');
    console.log('  --no-bids          Skip bid checking');
    console.log('  --no-comments      Skip comment extraction');
    console.log('  --no-outcomes      Skip outcome checking');
    console.log('  --include-ended    Include ended auctions');
    console.log('  --limit=N          Limit to N vehicles');
    console.log('  --help, -h         Show this help\n');
    process.exit(0);
  }

  await monitorAllAuctions(options);
}

main();


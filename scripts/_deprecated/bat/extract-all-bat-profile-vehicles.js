#!/usr/bin/env node

/**
 * Extract vehicles from all BaT user profiles
 * 
 * This script:
 * 1. Fetches all BaT usernames from the database
 * 2. Constructs profile URLs for each
 * 3. Calls extract-bat-profile-vehicles Edge Function for each username
 * 4. Processes in batches with rate limiting
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Configuration
const BATCH_SIZE = 50; // Process 50 profiles at a time (maximum parallel processing)
const DELAY_BETWEEN_BATCHES = 0; // No delay - Firecrawl handles rate limiting
const DELAY_BETWEEN_REQUESTS = 0; // No delay between requests (process in parallel)

/**
 * Call the extract-bat-profile-vehicles Edge Function
 */
async function extractProfileVehicles(username) {
  try {
    const { data, error } = await supabase.functions.invoke('extract-bat-profile-vehicles', {
      body: {
        username,
        extract_vehicles: true,
      },
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (err) {
    console.error(`  ❌ Error extracting ${username}:`, err.message);
    return { error: err.message, username };
  }
}

/**
 * Process a batch of usernames
 */
async function processBatch(usernames, batchNum, totalBatches) {
  console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${usernames.length} usernames)...`);

  const results = await Promise.all(
    usernames.map(async (username) => {
      console.log(`  Processing: ${username}`);
      const result = await extractProfileVehicles(username);

      if (result.error) {
        return { username, success: false, error: result.error };
      }

      const summary = {
        username,
        success: true,
        listings_found: result.listings_found || 0,
        listings_from_db: result.listings_from_db || 0,
        listings_from_scrape: result.listings_from_scrape || 0,
        vehicles_linked: result.vehicles_linked || 0,
        vehicles_created: result.vehicles_created || 0,
        vehicles_updated: result.vehicles_updated || 0,
        errors: result.errors?.length || 0,
      };

      console.log(`    ✓ Found ${summary.listings_found} listings, linked ${summary.vehicles_linked} vehicles`);

      return summary;
    })
  );

  return results;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting BaT profile vehicle extraction for all users...\n');

  // Fetch all BaT usernames (or use chunk from env if running as worker)
  let usernames;
  if (process.env.WORKER_CHUNK) {
    usernames = JSON.parse(process.env.WORKER_CHUNK);
    console.log(`📋 Worker ${process.env.WORKER_ID}: Processing ${usernames.length} assigned usernames...\n`);
  } else {
    console.log('📋 Fetching BaT usernames from database...');
    const { data: users, error } = await supabase
      .from('bat_users')
      .select('bat_username')
      .not('bat_username', 'is', null)
      .neq('bat_username', '')
      .neq('bat_username', 'account')
      .neq('bat_username', 'all')
      .order('bat_username');

    if (error) {
      console.error('❌ Error fetching usernames:', error);
      process.exit(1);
    }

    usernames = [...new Set(users.map(u => u.bat_username))];
    console.log(`✓ Found ${usernames.length} unique BaT usernames\n`);
  }

  // Split into batches
  const batches = [];
  for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
    batches.push(usernames.slice(i, i + BATCH_SIZE));
  }

  console.log(`📊 Processing ${usernames.length} usernames in ${batches.length} batches of ${BATCH_SIZE}\n`);

  // Process each batch
  const allResults = [];
  let totalProcessed = 0;
  let totalListings = 0;
  let totalVehicles = 0;
  let totalErrors = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const results = await processBatch(batch, i + 1, batches.length);

    allResults.push(...results);

    // Update totals
    results.forEach(r => {
      if (r.success) {
        totalProcessed++;
        totalListings += r.listings_found || 0;
        totalVehicles += (r.vehicles_linked || 0) + (r.vehicles_created || 0) + (r.vehicles_updated || 0);
        totalErrors += r.errors || 0;
      }
    });

    // Delay between batches (except for the last one)
    if (i < batches.length - 1) {
      console.log(`  ⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total usernames: ${usernames.length}`);
  console.log(`Successfully processed: ${totalProcessed}`);
  console.log(`Total listings found: ${totalListings}`);
  console.log(`Total vehicles linked/created/updated: ${totalVehicles}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log('='.repeat(60));

  // Show top results
  const topByListings = allResults
    .filter(r => r.success && r.listings_found > 0)
    .sort((a, b) => (b.listings_found || 0) - (a.listings_found || 0))
    .slice(0, 10);

  if (topByListings.length > 0) {
    console.log('\n🏆 Top 10 profiles by listings found:');
    topByListings.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.username}: ${r.listings_found} listings, ${r.vehicles_linked} vehicles`);
    });
  }

  // Show errors
  const errors = allResults.filter(r => !r.success || r.error);
  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} profiles had errors:`);
    errors.slice(0, 10).forEach(r => {
      console.log(`  - ${r.username}: ${r.error || 'Unknown error'}`);
    });
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }

  console.log('\n✅ Done!\n');
}

// Run the script
main().catch(console.error);


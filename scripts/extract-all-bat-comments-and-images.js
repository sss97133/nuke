#!/usr/bin/env node
/**
 * Extract comments and images for ALL BaT listings
 * Similar to what was done for the BMW - extracts comments and images for all vehicles
 * 
 * Usage: node scripts/extract-all-bat-comments-and-images.js [limit] [start_from]
 *   limit: max vehicles to process (default: all)
 *   start_from: offset to start from (for resuming)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPath = join(__dirname, '..', 'nuke_frontend', '.env.local');
const envFile = readFileSync(envPath, 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
});

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function extractCommentsAndImages(vehicle) {
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    return { skipped: true, reason: 'no_bat_url' };
  }

  try {
    // Step 1: Ensure auction_event exists
    const { data: auctionEvent, error: eventError } = await supabase
      .from('auction_events')
      .upsert(
        {
          vehicle_id: vehicle.id,
          source: 'bat',
          source_url: batUrl,
          outcome: 'sold',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vehicle_id,source_url' }
      )
      .select('id')
      .single();

    if (eventError) {
      return { success: false, error: `Auction event error: ${eventError.message}` };
    }

    const auctionEventId = auctionEvent?.id;
    if (!auctionEventId) {
      return { success: false, error: 'Failed to create/get auction event' };
    }

    // Step 2: Extract comments
    let commentsExtracted = 0;
    try {
      const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-auction-comments', {
        body: {
          auction_url: batUrl,
          auction_event_id: auctionEventId,
          vehicle_id: vehicle.id,
        },
      });

      if (extractError) {
        console.warn(`   ⚠️  Comment extraction error: ${extractError.message}`);
      } else {
        commentsExtracted = extractData?.comments_extracted || 0;
      }
    } catch (err) {
      console.warn(`   ⚠️  Comment extraction exception: ${err.message}`);
    }

    // Step 3: Import BaT listing (extracts and backfills images)
    let imagesExtracted = false;
    try {
      const { data: importData, error: importError } = await supabase.functions.invoke('import-bat-listing', {
        body: {
          batUrl,
          vehicleId: vehicle.id,
        },
      });

      if (importError) {
        console.warn(`   ⚠️  Image import error: ${importError.message}`);
      } else {
        imagesExtracted = true;
      }
    } catch (err) {
      console.warn(`   ⚠️  Image import exception: ${err.message}`);
    }

    // Wait a bit for images to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify what was extracted
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    return {
      success: true,
      commentsExtracted: commentsExtracted || commentCount || 0,
      imagesExtracted: imageCount || 0,
      auctionEventId,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '1000');
  const startFrom = parseInt(process.argv[3] || '0');

  console.log(`🔄 Extracting comments and images for ALL BaT listings`);
  console.log(`   Limit: ${limit}, Start from: ${startFrom}\n`);

  // Get all BaT vehicles
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
    totalComments: 0,
    totalImages: 0,
  };

  for (let i = 0; i < (vehicles || []).length; i++) {
    const vehicle = vehicles[i];
    const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;

    process.stdout.write(`[${i + 1}/${vehicles.length}] ${vehicleName.substring(0, 50).padEnd(50)} ... `);

    const result = await extractCommentsAndImages(vehicle);

    if (result.skipped) {
      results.skipped++;
      console.log(`SKIPPED (${result.reason})`);
    } else if (result.success) {
      results.succeeded++;
      results.totalComments += result.commentsExtracted || 0;
      results.totalImages += result.imagesExtracted || 0;
      console.log(`✅ C:${result.commentsExtracted || 0} I:${result.imagesExtracted || 0}`);
    } else {
      results.failed++;
      console.log(`❌ ${result.error?.substring(0, 60)}`);
    }

    // Rate limiting (Firecrawl + Supabase)
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log(`\n✅ Batch complete!`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Succeeded: ${results.succeeded}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`\n   Total Comments Extracted: ${results.totalComments}`);
  console.log(`   Total Images Extracted: ${results.totalImages}`);
}

main().catch(console.error);


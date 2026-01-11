#!/usr/bin/env node
/**
 * Complete fix for BaT vehicle: comments, images, cleanup
 * Usage: node scripts/fix-bat-vehicle-complete.js <vehicle_id> <bat_url>
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
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Normalize image URLs for comparison
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url
    .split('#')[0]
    .split('?')[0]
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/-scaled\./g, '.')
    .replace(/[?&]w=\d+/g, '')
    .trim();
}

// Check if image is known BaT noise
function isKnownNoise(url) {
  const f = url.toLowerCase();
  return (
    f.includes('qotw') ||
    f.includes('winner-template') ||
    f.includes('weekly-weird') ||
    f.includes('logo') ||
    f.includes('bringatrailer.com/logo') ||
    f.includes('bat-logo') ||
    f.includes('related') ||
    f.includes('sponsor') ||
    f.includes('.svg') ||
    f.includes('themes/') ||
    f.includes('assets/img/')
  );
}

async function main() {
  const vehicleId = process.argv[2];
  const batUrl = process.argv[3] || 'https://bringatrailer.com/listing/1973-bmw-3-0csi-40/';

  if (!vehicleId) {
    console.error('Usage: node scripts/fix-bat-vehicle-complete.js <vehicle_id> [bat_url]');
    process.exit(1);
  }

  console.log(`🔧 Fixing BaT vehicle ${vehicleId}\n`);

  try {
    // Step 1: Ensure auction_event exists
    console.log('📋 Step 1: Ensuring auction_event exists...');
    const { data: auctionEvent } = await supabase
      .from('auction_events')
      .upsert(
        {
          vehicle_id: vehicleId,
          source: 'bat',
          source_url: batUrl,
          outcome: 'sold',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vehicle_id,source_url' }
      )
      .select('id')
      .single();

    const auctionEventId = auctionEvent?.id;
    console.log(`✅ Auction event ID: ${auctionEventId}\n`);

    // Step 2: Extract and save comments
    console.log('📝 Step 2: Extracting comments...');
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-auction-comments', {
      body: {
        auction_url: batUrl,
        auction_event_id: auctionEventId,
        vehicle_id: vehicleId,
      },
    });

    if (extractError) {
      console.error('❌ Comment extraction error:', extractError);
    } else {
      console.log(`✅ Comments extracted: ${extractData?.comments_extracted || 0}\n`);
    }

    // Step 3: Import BaT listing (extracts and backfills images)
    console.log('📸 Step 3: Importing BaT listing (extracts images)...');
    const { data: importData, error: importError } = await supabase.functions.invoke('import-bat-listing', {
      body: {
        batUrl,
        vehicleId,
      },
    });

    if (importError) {
      console.error('❌ Import error:', importError);
    } else {
      console.log('✅ BaT listing imported\n');
    }

    // Wait for images to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 4: Get vehicle to check origin_metadata for canonical images
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, origin_metadata')
      .eq('id', vehicleId)
      .single();

    // Step 5: Remove contaminated images
    console.log('🧹 Step 4: Cleaning contaminated images...');
    const om = (vehicle?.origin_metadata && typeof vehicle.origin_metadata === 'object') ? vehicle.origin_metadata : {};
    const canonicalUrls = Array.isArray(om?.image_urls) ? om.image_urls : [];
    
    // Filter noise from canonical
    const cleanCanonical = canonicalUrls.filter(url => {
      if (!url || typeof url !== 'string') return false;
      return url.includes('bringatrailer.com/wp-content/uploads/') && 
             !url.includes('.svg') &&
             !isKnownNoise(url);
    });
    
    const canonicalSet = new Set(cleanCanonical.map(normalizeImageUrl).filter(Boolean));
    console.log(`   Canonical images: ${canonicalSet.size}`);

    // Get all existing images
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source')
      .eq('vehicle_id', vehicleId);

    if (existingImages && existingImages.length > 0) {
      const toRemove = existingImages.filter(img => {
        const url = img.image_url;
        const normalized = normalizeImageUrl(url);
        
        // Remove if it's known noise
        if (isKnownNoise(url)) return true;
        
        // Remove if it's not in canonical set and looks like BaT noise
        if (!canonicalSet.has(normalized) && url.includes('bringatrailer.com')) {
          return isKnownNoise(url);
        }
        
        return false;
      });

      if (toRemove.length > 0) {
        console.log(`   Removing ${toRemove.length} contaminated images...`);
        const { error: deleteError } = await supabase
          .from('vehicle_images')
          .delete()
          .in('id', toRemove.map(img => img.id));
        
        if (deleteError) {
          console.error('   ⚠️  Error:', deleteError);
        } else {
          console.log(`   ✅ Removed ${toRemove.length} images\n`);
        }
      } else {
        console.log('   ✅ No contaminated images found\n');
      }
    }

    // Step 6: Verify final counts
    console.log('🔍 Step 5: Verifying final data...');
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    console.log(`✅ Final counts:`);
    console.log(`   Comments: ${commentCount || 0}`);
    console.log(`   Images: ${imageCount || 0}`);
    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * Backfill BaT vehicles missing auto_approved images from their origin_metadata.image_urls
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function backfillMissingBatImages(batchSize = 25) {
  console.log(`🔍 Finding BaT vehicles missing auto_approved images...`);
  
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, origin_metadata, discovery_url, listing_url, bat_auction_url')
    .or('profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .limit(500);

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  const candidates = [];
  for (const v of vehicles || []) {
    const hasImages = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', v.id)
      .eq('source', 'bat_import')
      .eq('approval_status', 'auto_approved')
      .is('is_duplicate', false)
      .is('is_document', false);

    if (hasImages.count === 0) {
      const om = v.origin_metadata || {};
      const urls = Array.isArray(om.image_urls) ? om.image_urls : [];
      const batUrl = v.bat_auction_url || v.listing_url || v.discovery_url;
      
      if (urls.length > 0 || batUrl) {
        candidates.push({ id: v.id, urls, batUrl });
      }
    }
  }

  console.log(`✅ Found ${candidates.length} vehicles missing images`);
  console.log(`📦 Processing first ${Math.min(batchSize, candidates.length)}...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < Math.min(batchSize, candidates.length); i++) {
    const v = candidates[i];
    const urls = v.urls.length > 0 ? v.urls : null;
    const batUrl = v.batUrl;

    try {
      if (urls && urls.length > 0) {
        // Use existing URLs from origin_metadata
        console.log(`  [${i + 1}/${Math.min(batchSize, candidates.length)}] Backfilling ${v.id} with ${urls.length} URLs...`);
        const { error: backfillErr } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: v.id,
            image_urls: urls.slice(0, 200), // Limit to 200 per vehicle
            source: 'bat_import',
            run_analysis: false,
            max_images: 0,
            continue: true,
            sleep_ms: 150,
            max_runtime_ms: 60000,
          },
        });

        if (backfillErr) throw backfillErr;
        success++;
      } else if (batUrl && batUrl.includes('bringatrailer.com/listing/')) {
        // Fetch from BaT URL
        console.log(`  [${i + 1}/${Math.min(batchSize, candidates.length)}] Importing ${v.id} from ${batUrl}...`);
        const { error: importErr } = await supabase.functions.invoke('import-bat-listing', {
          body: {
            url: batUrl,
            allowFuzzyMatch: false,
            imageBatchSize: 50,
          },
        });

        if (importErr) throw importErr;
        success++;
      } else {
        console.log(`  [${i + 1}/${Math.min(batchSize, candidates.length)}] Skipping ${v.id} (no URLs or BaT URL)`);
      }
    } catch (err) {
      console.error(`  ❌ Failed ${v.id}:`, err.message);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Complete: ${success} succeeded, ${failed} failed`);
}

backfillMissingBatImages(50).catch(console.error);


#!/usr/bin/env node
/**
 * Fix vehicle images: extract from BaT, remove contaminated ones
 * Usage: node scripts/fix-vehicle-images.js <vehicle_id> <bat_url>
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

async function main() {
  const vehicleId = process.argv[2];
  const batUrl = process.argv[3] || 'https://bringatrailer.com/listing/1973-bmw-3-0csi-40/';

  if (!vehicleId) {
    console.error('Usage: node scripts/fix-vehicle-images.js <vehicle_id> [bat_url]');
    process.exit(1);
  }

  console.log(`🔧 Fixing images for vehicle ${vehicleId}\n`);

  try {
    // Step 1: Get BaT listing HTML and extract images
    console.log('📥 Step 1: Extracting images from BaT listing...');
    const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
      body: { url: batUrl },
    });

    if (scrapeError || !scrapeData?.html) {
      console.error('❌ Failed to scrape BaT listing:', scrapeError);
      process.exit(1);
    }

    const html = scrapeData.html;

    // Extract images using batDomMap
    const { extractBatDomMap } = await import('../supabase/functions/_shared/batDomMap.ts');
    const { extracted: domExtracted } = extractBatDomMap(html, batUrl);
    const galleryImages = Array.isArray(domExtracted?.image_urls) ? domExtracted.image_urls : [];
    
    console.log(`✅ Found ${galleryImages.length} gallery images\n`);

    // Step 2: Remove contaminated images (logos, etc.)
    console.log('🧹 Step 2: Removing contaminated images...');
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source')
      .eq('vehicle_id', vehicleId);

    if (existingImages && existingImages.length > 0) {
      // Identify contaminated images (logos, BaT branding, etc.)
      const contaminated = existingImages.filter(img => {
        const url = (img.image_url || '').toLowerCase();
        return url.includes('logo') || 
               url.includes('bringatrailer.com/logo') ||
               url.includes('bat-logo') ||
               url.includes('related') ||
               url.includes('sponsor');
      });

      if (contaminated.length > 0) {
        console.log(`   Found ${contaminated.length} contaminated images, deleting...`);
        const { error: deleteError } = await supabase
          .from('vehicle_images')
          .delete()
          .in('id', contaminated.map(img => img.id));
        
        if (deleteError) {
          console.error('   ⚠️  Error deleting contaminated images:', deleteError);
        } else {
          console.log(`   ✅ Deleted ${contaminated.length} contaminated images\n`);
        }
      } else {
        console.log('   ✅ No contaminated images found\n');
      }
    }

    // Step 3: Backfill gallery images
    if (galleryImages.length > 0) {
      console.log(`📸 Step 3: Backfilling ${galleryImages.length} gallery images...`);
      const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
        body: {
          vehicle_id: vehicleId,
          image_urls: galleryImages,
          source: 'bat_gallery_extraction',
          run_analysis: false,
          max_images: 0, // Upload all
          continue: true,
          sleep_ms: 150,
        },
      });

      if (backfillError) {
        console.error('❌ Image backfill error:', backfillError);
      } else {
        console.log(`✅ Image backfill completed:`, backfillResult);
      }
    }

    // Step 4: Verify final image count
    const { count: finalCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    console.log(`\n✅ Final image count: ${finalCount || 0}`);
    console.log('✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);


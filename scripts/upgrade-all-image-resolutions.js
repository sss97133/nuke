#!/usr/bin/env node
/**
 * Upgrade all image URLs to full resolution
 * Removes resize params and size suffixes
 * Run: node scripts/upgrade-all-image-resolutions.js [batch-size] [start-index]
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = parseInt(process.argv[2]) || 500;
const START_INDEX = parseInt(process.argv[3]) || 0;

// Upgrade image URLs to full resolution
function upgradeImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  let upgraded = url
    // Remove resize/width/height query parameters
    .split('?')[0]
    // Remove size suffixes (-150x150, -300x300, -thumb, -small, -medium, -scaled)
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
    .trim();
  
  return upgraded;
}

// Check if URL needs upgrading
function needsUpgrade(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    url.includes('?') && (url.includes('w=') || url.includes('h=') || url.includes('resize=')) ||
    /-\d+x\d+\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-small\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-medium\.(jpg|jpeg|png|webp)$/i.test(url) ||
    /-scaled\.(jpg|jpeg|png|webp)$/i.test(url)
  );
}

async function upgradeImageResolutions() {
  console.log(`🔧 Upgrading image URLs to full resolution...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Step 1: Find images that need upgrading
  console.log('   Finding images that need upgrading...');
  
  let offset = START_INDEX;
  let totalUpgraded = 0;
  let totalProcessed = 0;
  let totalErrors = 0;
  
  while (true) {
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id, is_primary')
      .not('image_url', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);
    
    if (error) {
      console.error('❌ Error fetching images:', error);
      break;
    }
    
    if (!images || images.length === 0) {
      break;
    }
    
    for (const image of images) {
      try {
        if (!image.image_url || !needsUpgrade(image.image_url)) {
          continue;
        }
        
        const upgraded = upgradeImageUrl(image.image_url);
        if (upgraded === image.image_url) {
          continue;
        }
        
        // Update image URL
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ image_url: upgraded })
          .eq('id', image.id);
        
        if (updateError) {
          console.error(`   ❌ Error updating image ${image.id}: ${updateError.message}`);
          totalErrors++;
        } else {
          totalUpgraded++;
          if (image.is_primary) {
            // Also update vehicle's primary_image_url if this is the primary
            await supabase
              .from('vehicles')
              .update({ primary_image_url: upgraded })
              .eq('id', image.vehicle_id);
          }
        }
      } catch (e) {
        console.error(`   ❌ Error processing image ${image.id}: ${e.message}`);
        totalErrors++;
      }
    }
    
    totalProcessed += images.length;
    process.stdout.write(`   Processed: ${totalProcessed}, Upgraded: ${totalUpgraded}, Errors: ${totalErrors}\r`);
    
    if (images.length < BATCH_SIZE) {
      break;
    }
    
    offset += BATCH_SIZE;
  }
  
  console.log(`\n\n📊 RESULTS:\n`);
  console.log(`   Processed: ${totalProcessed} images`);
  console.log(`   Upgraded: ${totalUpgraded} images`);
  console.log(`   Errors: ${totalErrors}`);
  
  if (totalProcessed >= BATCH_SIZE) {
    console.log(`\n💡 More images may remain. Run again with:`);
    console.log(`   node scripts/upgrade-all-image-resolutions.js ${BATCH_SIZE} ${offset}`);
  } else {
    console.log(`\n✅ All images processed!`);
  }
}

upgradeImageResolutions().catch(console.error);


#!/usr/bin/env node
/**
 * Fix vehicles with /video URLs by updating to actual listing pages
 * Run: node scripts/fix-video-urls.js [dry-run]
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

const DRY_RUN = process.argv[2] === 'dry-run' || process.argv[2] === '--dry-run';

async function fixVideoUrls() {
  console.log(`🔧 Fixing /video URLs...\n`);
  if (DRY_RUN) {
    console.log('   DRY RUN MODE - No changes will be made\n');
  }
  
  // Find vehicles with /video URLs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url')
    .or('discovery_url.ilike.%/video%,platform_url.ilike.%/video%');
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`📊 Found ${vehicles?.length || 0} vehicles with /video URLs\n`);
  
  const results = {
    fixed: 0,
    errors: 0,
    skipped: 0
  };
  
  for (const vehicle of vehicles || []) {
    try {
      // Extract the auction ID from the /video URL
      // Pattern: /auctions/ID/video -> /auctions/ID
      const videoUrl = vehicle.discovery_url || vehicle.platform_url;
      if (!videoUrl || !videoUrl.includes('/video')) {
        results.skipped++;
        continue;
      }
      
      // Remove /video suffix to get actual listing URL
      const cleanUrl = videoUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/');
      
      if (cleanUrl === videoUrl) {
        console.log(`   ⚠️  ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Could not clean URL`);
        results.skipped++;
        continue;
      }
      
      console.log(`   🔧 ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}:`);
      console.log(`      ${videoUrl}`);
      console.log(`      → ${cleanUrl}`);
      
      if (!DRY_RUN) {
        // Update both discovery_url and platform_url
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            discovery_url: cleanUrl,
            platform_url: cleanUrl
          })
          .eq('id', vehicle.id);
        
        if (updateError) {
          console.error(`      ❌ Update failed: ${updateError.message}`);
          results.errors++;
        } else {
          console.log(`      ✅ Updated`);
          results.fixed++;
        }
      } else {
        results.fixed++;
      }
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Fixed: ${results.fixed} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  console.log(`   Skipped: ${results.skipped}`);
  
  if (DRY_RUN) {
    console.log(`\n💡 Run without 'dry-run' to apply changes`);
  } else {
    console.log(`\n✅ Done! Re-run extract-premium-auction on these URLs to get proper images.`);
  }
}

fixVideoUrls().catch(console.error);



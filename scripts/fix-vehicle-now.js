#!/usr/bin/env node

/**
 * Fix specific vehicle - clean model name and backfill images
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Clean model name function (same as in Edge Function)
function cleanModelName(model) {
  if (!model) return '';
  
  let cleaned = model.trim();
  
  // Remove pricing patterns
  cleaned = cleaned.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?/g, '');
  cleaned = cleaned.replace(/\s*\(\s*Est\.\s*payment\s*OAC[^)]*\)/gi, '');
  
  // Remove dealer info
  cleaned = cleaned.replace(/\s*\([^)]*call[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*\(?\d{3}\)?\s*[\d-]+\s*\)/g, '');
  cleaned = cleaned.replace(/\s*\([A-Z][a-z]+\s*[A-Z][a-z]+(?:\s*[A-Z][a-z]+)?\)/g, '');
  
  // Remove financing text
  cleaned = cleaned.replace(/\s*\([^)]*financ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*credit[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*buy\s+here[^)]*\)/gi, '');
  
  // Remove SKU/stock numbers
  cleaned = cleaned.replace(/\s*SKU\s*:\s*\w+/gi, '');
  cleaned = cleaned.replace(/\s*Stock\s*#?\s*:\s*\w+/gi, '');
  
  // Remove BaT platform text
  cleaned = cleaned.replace(/\s*on\s*BaT\s*Auctions?\s*-?\s*ending[^|]*/gi, '');
  cleaned = cleaned.replace(/\s*\(Lot\s*#?\s*[\d,]+\)/gi, '');
  cleaned = cleaned.replace(/\s*\|\s*Bring\s*a\s*Trailer/gi, '');
  
  // Remove common descriptors
  cleaned = cleaned.replace(/\s*\b(classic|vintage|restored|clean|mint|excellent|beautiful|collector['s]?|very\s+original|with\s+only|stunning|gorgeous)\b/gi, '');
  
  // Remove mileage text
  cleaned = cleaned.replace(/\s*\d+[,\s]*\d*\s*miles?/gi, '');
  cleaned = cleaned.replace(/\s*only\s+\d+/gi, '');
  
  // Remove parenthetical content
  cleaned = cleaned.replace(/\s*\([^)]{20,}\)/g, '');
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

async function fixVehicle(vehicleId) {
  console.log(`\n🔧 Fixing vehicle ${vehicleId}...`);
  
  // Get vehicle
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error(`❌ Vehicle not found: ${vehicleError?.message}`);
    return;
  }
  
  console.log(`   Current model: "${vehicle.model}"`);
  
  // Clean model name
  const cleanedModel = cleanModelName(vehicle.model);
  console.log(`   Cleaned model: "${cleanedModel}"`);
  
  // Fix make if needed
  let fixedMake = vehicle.make;
  if (vehicle.make === 'This' && vehicle.model.toLowerCase().includes('lincoln')) {
    fixedMake = 'Lincoln';
    console.log(`   Fixed make: "This" → "Lincoln"`);
  } else if (vehicle.make === 'El' && vehicle.model.toLowerCase().includes('camino')) {
    fixedMake = 'Chevrolet';
    console.log(`   Fixed make: "El" → "Chevrolet"`);
  }
  
  // Update vehicle
  const updates = {};
  if (cleanedModel !== vehicle.model) {
    updates.model = cleanedModel;
  }
  if (fixedMake !== vehicle.make) {
    updates.make = fixedMake;
  }
  
  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);
    
    if (updateError) {
      console.error(`   ❌ Update failed: ${updateError.message}`);
    } else {
      console.log(`   ✅ Vehicle updated`);
    }
  }
  
  // Backfill images
  const { count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);
  
  if ((imageCount || 0) === 0) {
    console.log(`   🖼️  No images found, backfilling...`);
    
    // Get image URLs from origin_metadata
    const imageUrls = vehicle.origin_metadata?.image_urls || [];
    
    if (imageUrls.length > 0) {
      // Filter out thumbnails (50x50c) - keep 600x450 images
      const fullSizeImages = imageUrls.filter(url => 
        !url.includes('50x50c') && 
        (url.includes('600x450') || url.includes('1200x900'))
      );
      
      if (fullSizeImages.length > 0) {
        console.log(`   📤 Uploading ${fullSizeImages.length} images...`);
        console.log(`   📋 Sample URLs: ${fullSizeImages.slice(0, 3).join(', ')}`);
        
        const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicleId,
            image_urls: fullSizeImages.slice(0, 20),
            source: 'manual_fix',
            run_analysis: false
          }
        });
        
        if (backfillError) {
          console.error(`   ❌ Image backfill failed: ${JSON.stringify(backfillError, null, 2)}`);
        } else {
          console.log(`   📊 Backfill result: ${JSON.stringify(backfillResult, null, 2)}`);
          console.log(`   ✅ Images backfilled: ${backfillResult?.uploaded || 0} uploaded, ${backfillResult?.failed || 0} failed`);
          if (backfillResult?.errors && backfillResult.errors.length > 0) {
            console.log(`   ⚠️  Errors: ${backfillResult.errors.slice(0, 3).join('; ')}`);
          }
        }
      } else {
        console.log(`   ⚠️  No full-size images found in metadata (found ${imageUrls.length} total URLs)`);
      }
    } else if (vehicle.discovery_url) {
      // Try scraping fresh images
      console.log(`   🔍 Scraping fresh images from ${vehicle.discovery_url}...`);
      
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url }
      });
      
      if (!scrapeError && scrapeData?.success && scrapeData.data?.images && scrapeData.data.images.length > 0) {
        const imageUrls = scrapeData.data.images.filter(url => 
          !url.includes('50x50c') && 
          (url.includes('600x450') || url.includes('1200x900'))
        );
        
        if (imageUrls.length > 0) {
          const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicleId,
              image_urls: imageUrls.slice(0, 20),
              source: 'scrape_fix',
              run_analysis: false
            }
          });
          
          if (backfillError) {
            console.error(`   ❌ Image backfill failed: ${backfillError.message}`);
          } else {
            console.log(`   ✅ Images backfilled: ${backfillResult?.uploaded || 0} uploaded`);
          }
        }
      }
    }
  } else {
    console.log(`   ✅ Already has ${imageCount} images`);
  }
  
  console.log(`   ✅ Vehicle fixed!`);
}

async function main() {
  const vehicleId = process.argv[2] || 'bd043fc7-e7a8-41b7-aadd-7a0d10585a8c';
  
  await fixVehicle(vehicleId);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


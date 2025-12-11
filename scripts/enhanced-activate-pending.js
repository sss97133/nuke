#!/usr/bin/env node

/**
 * Enhanced Activation Script
 * 
 * Uses Firecrawl and OpenAI to:
 * - Accurately parse Year, Make, Model
 * - Get accurate price and sub data
 * - Ensure lead photos are uploaded and set as primary
 * - Create timeline events
 * - Activate vehicles when ready
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
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Use Firecrawl to scrape the URL
 */
async function scrapeWithFirecrawl(url) {
  if (!FIRECRAWL_API_KEY) {
    console.log('   ⚠️  FIRECRAWL_API_KEY not set, using simple-scraper');
    return null;
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        formats: ['html', 'markdown'],
        pageOptions: { waitFor: 2000 }
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Firecrawl returned ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.data) {
      return {
        html: data.data.html || '',
        markdown: data.data.markdown || '',
        url: data.data.url || url
      };
    }
  } catch (error) {
    console.log(`   ⚠️  Firecrawl failed: ${error.message}`);
  }

  return null;
}

/**
 * Use AI proofreader to accurately parse vehicle data
 */
async function parseWithOpenAI(html, markdown, currentData, vehicleId) {
  try {
    // Use the ai-proofread-pending function which we know works
    const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-proofread-pending', {
      body: {
        vehicle_ids: [vehicleId],
        batch_size: 1
      }
    });

    if (aiError) {
      console.log(`   ⚠️  AI proofreading failed: ${aiError.message}`);
      return null;
    }

    if (aiData && aiData.success && aiData.vehicles_updated && aiData.vehicles_updated.length > 0) {
      // Get the updated vehicle data
      const { data: updatedVehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (updatedVehicle) {
        return {
          year: updatedVehicle.year,
          make: updatedVehicle.make,
          model: updatedVehicle.model,
          vin: updatedVehicle.vin,
          price: updatedVehicle.asking_price || updatedVehicle.current_value,
          mileage: updatedVehicle.mileage,
          color: updatedVehicle.color,
          engine: updatedVehicle.engine,
          transmission: updatedVehicle.transmission,
          description: updatedVehicle.description,
          location: updatedVehicle.location
        };
      }
    }

    return null;
  } catch (error) {
    console.log(`   ⚠️  AI parsing failed: ${error.message}`);
    return null;
  }
}

/**
 * Process and activate a vehicle
 */
async function processVehicle(vehicle) {
  console.log(`\n🔍 Processing: ${vehicle.id}`);
  console.log(`   Current: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
  console.log(`   URL: ${vehicle.discovery_url || 'NONE'}`);

  if (!vehicle.discovery_url) {
    console.log(`   ⏭️  No discovery URL, skipping`);
    return { processed: false, reason: 'no_url' };
  }

  // Step 1: Scrape with Firecrawl
  console.log(`   📡 Scraping with Firecrawl...`);
  let scrapeData = await scrapeWithFirecrawl(vehicle.discovery_url);
  
  if (!scrapeData) {
    // Fallback to simple-scraper
    console.log(`   📡 Using simple-scraper fallback...`);
    try {
      const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url }
      });
      
      if (!simpleError && simpleData?.success) {
        scrapeData = {
          html: simpleData.data.html || '',
          markdown: '',
          url: vehicle.discovery_url
        };
      }
    } catch (err) {
      console.log(`   ❌ Scraping failed: ${err.message}`);
      return { processed: false, reason: 'scrape_failed' };
    }
  }

  if (!scrapeData) {
    return { processed: false, reason: 'scrape_failed' };
  }

  // Step 2: Parse with OpenAI
  console.log(`   🤖 Parsing with OpenAI...`);
  const parsedData = await parseWithOpenAI(
    scrapeData.html,
    scrapeData.markdown,
    {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin,
      asking_price: vehicle.asking_price,
      mileage: vehicle.mileage
    },
    vehicle.id
  );

  if (!parsedData) {
    console.log(`   ⚠️  AI parsing failed, using basic extraction`);
  }

  // Step 3: Update vehicle with parsed data
  const updates = {};
  
  if (parsedData) {
    if (parsedData.year && parsedData.year >= 1885 && parsedData.year <= new Date().getFullYear() + 1) {
      updates.year = parsedData.year;
    }
    if (parsedData.make && parsedData.make.length > 0) {
      updates.make = parsedData.make;
    }
    if (parsedData.model && parsedData.model.length > 0) {
      updates.model = parsedData.model;
    }
    if (parsedData.vin && parsedData.vin.length === 17) {
      updates.vin = parsedData.vin;
    }
    if (parsedData.price && parsedData.price > 0) {
      updates.asking_price = parsedData.price;
    }
    if (parsedData.mileage && parsedData.mileage > 0) {
      updates.mileage = parsedData.mileage;
    }
    if (parsedData.color) {
      updates.color = parsedData.color;
    }
    if (parsedData.engine) {
      updates.engine = parsedData.engine;
    }
    if (parsedData.transmission) {
      updates.transmission = parsedData.transmission;
    }
    if (parsedData.description) {
      updates.description = parsedData.description;
    }
    if (parsedData.location) {
      updates.location = parsedData.location;
    }
  }

  // Step 4: Backfill images - use simple-scraper to get fresh image URLs
  let imageUrls = [];
  
  // Always use simple-scraper to get fresh image URLs (most reliable)
  try {
    const { data: imageData, error: imageError } = await supabase.functions.invoke('simple-scraper', {
      body: { url: vehicle.discovery_url }
    });

    if (!imageError && imageData?.success && imageData.data?.images && imageData.data.images.length > 0) {
      imageUrls = imageData.data.images;
      console.log(`   🖼️  Found ${imageUrls.length} images from simple-scraper`);
    }
  } catch (err) {
    console.log(`   ⚠️  Image extraction failed: ${err.message}`);
  }

  // Fallback to parsed data if simple-scraper didn't work
  if (imageUrls.length === 0 && parsedData?.image_urls && parsedData.image_urls.length > 0) {
    imageUrls = parsedData.image_urls;
  }

  // Filter and clean image URLs
  imageUrls = imageUrls
    .filter(url => {
      const cleanUrl = url.replace(/&#038;/g, '&').replace(/&amp;/g, '&');
      return cleanUrl.match(/\.(jpg|jpeg|png|webp)/i) && 
             !cleanUrl.includes('icon') && 
             !cleanUrl.includes('logo') && 
             !cleanUrl.includes('.svg') &&
             !cleanUrl.includes('thumbnail') &&
             cleanUrl.length < 500;
    })
    .slice(0, 30); // Limit to 30 images

  if (imageUrls.length > 0) {
    console.log(`   🖼️  Found ${imageUrls.length} images, uploading...`);
    
    // Check current image count
    const { count: currentImageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    if ((currentImageCount || 0) === 0) {
      const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
        body: {
          vehicle_id: vehicle.id,
          image_urls: imageUrls,
          source: 'enhanced_activation',
          run_analysis: false
        }
      });

      if (!backfillError && backfillResult?.uploaded > 0) {
        console.log(`   ✅ Uploaded ${backfillResult.uploaded} images`);
        
        // CRITICAL: Ensure first image is set as primary (lead photo)
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id, is_primary')
          .eq('vehicle_id', vehicle.id)
          .order('created_at', { ascending: true });
        
        if (images && images.length > 0) {
          // Unset all primary flags first
          await supabase
            .from('vehicle_images')
            .update({ is_primary: false })
            .eq('vehicle_id', vehicle.id);
          
          // Set first image as primary
          await supabase
            .from('vehicle_images')
            .update({ is_primary: true })
            .eq('id', images[0].id);
          
          console.log(`   ✅ Set lead photo (image ${images[0].id} is now primary)`);
        }
      } else {
        console.log(`   ⚠️  Image upload failed: ${backfillError?.message || 'Unknown error'}`);
      }
    } else {
      console.log(`   ℹ️  Already has ${currentImageCount} images`);
    }
  }

  // Step 5: Update vehicle
  if (Object.keys(updates).length > 0) {
    console.log(`   💾 Updating vehicle with ${Object.keys(updates).length} fields...`);
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);

    if (updateError) {
      console.log(`   ❌ Update failed: ${updateError.message}`);
    } else {
      console.log(`   ✅ Vehicle updated`);
    }
  }

  // Step 6: Create timeline event
  const { count: eventCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id)
    .eq('event_type', 'auction_listed');

  if ((eventCount || 0) === 0) {
    try {
      const source = vehicle.discovery_url.includes('craigslist') ? 'craigslist' :
                     vehicle.discovery_url.includes('bringatrailer') ? 'bring_a_trailer' :
                     vehicle.discovery_url.includes('hemmings') ? 'hemmings' :
                     'automated_import';

      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          event_type: 'auction_listed',
          event_date: new Date().toISOString().split('T')[0],
          title: 'Listed for Sale',
          description: `Listed on ${new URL(vehicle.discovery_url).hostname}`,
          source: source,
          metadata: {
            source_url: vehicle.discovery_url,
            price: parsedData?.price || updates.asking_price,
            location: parsedData?.location || updates.location
          }
        });
      
      console.log(`   ✅ Timeline event created`);
    } catch (err) {
      console.log(`   ⚠️  Timeline event failed: ${err.message}`);
    }
  }

  // Step 7: Validate and activate
  const { data: validation, error: validationError } = await supabase.rpc(
    'validate_vehicle_before_public',
    { p_vehicle_id: vehicle.id }
  );

  if (validationError) {
    console.log(`   ❌ Validation error: ${validationError.message}`);
    return { processed: true, activated: false, reason: 'validation_error' };
  }

  if (validation && validation.can_go_live) {
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ status: 'active', is_public: true })
      .eq('id', vehicle.id);

    if (activateError) {
      console.log(`   ❌ Activation failed: ${activateError.message}`);
      return { processed: true, activated: false, reason: 'activation_error' };
    }

    console.log(`   🎉 ACTIVATED! (Score: ${validation.quality_score})`);
    return { processed: true, activated: true, quality_score: validation.quality_score };
  } else {
    console.log(`   ⚠️  Not ready: ${validation?.recommendation || 'Unknown'}`);
    return { processed: true, activated: false, reason: validation?.recommendation || 'not_ready' };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 20;

  console.log('🚀 Enhanced Activation Script');
  console.log('   Using Firecrawl + OpenAI for accurate parsing\n');

  // Get pending vehicles
  const { data: pendingVehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, asking_price, mileage, discovery_url, status')
    .eq('status', 'pending')
    .not('discovery_url', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!pendingVehicles || pendingVehicles.length === 0) {
    console.log('✅ No pending vehicles to process');
    return;
  }

  console.log(`📋 Processing ${pendingVehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    failed: 0
  };

  for (const vehicle of pendingVehicles) {
    const result = await processVehicle(vehicle);
    results.processed++;
    
    if (result.activated) {
      results.activated++;
    } else if (result.reason === 'validation_error' || result.reason === 'activation_error') {
      results.failed++;
    }

    // Delay between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated}`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


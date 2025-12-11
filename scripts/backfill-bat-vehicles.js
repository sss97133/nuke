#!/usr/bin/env node

/**
 * BaT-Specific Backfill Script
 * 
 * Focuses on Bring a Trailer vehicles to ensure:
 * - Images are uploaded (with proper URL cleaning)
 * - Timeline events are created
 * - All vehicle info is extracted
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

function cleanBaTImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  // Decode HTML entities (&#038; -> &, etc.)
  let decoded = url
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  
  const lower = decoded.toLowerCase();
  
  // EXCLUDE: Icons, logos, SVGs, UI elements
  if (lower.includes('icon') || 
      lower.includes('logo') || 
      lower.includes('.svg') ||
      lower.includes('opt-out') ||
      lower.includes('social-') ||
      lower.includes('countries/') ||
      lower.includes('listings/') ||
      lower.includes('partial-load') ||
      lower.includes('themes/') ||
      lower.includes('assets/img/') ||
      lower.includes('youtube.com/vi')) {
    return null;
  }
  
  // ONLY INCLUDE: Actual vehicle images from wp-content/uploads
  if (!lower.includes('wp-content/uploads')) {
    return null;
  }
  
  // Remove resize parameters to get full-size images
  let cleaned = decoded
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]fit=[^&]*/g, '')
    .replace(/[?&]$/, '');
  
  // Convert scaled images to originals
  if (cleaned.includes('-scaled.')) {
    cleaned = cleaned.replace('-scaled.', '.');
  }
  
  return cleaned;
}

async function backfillBaTVehicle(vehicle) {
  console.log(`\n🎯 BaT Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   ID: ${vehicle.id}`);
  console.log(`   URL: ${vehicle.discovery_url}`);

  const updates = {};
  let imagesBackfilled = false;
  let timelineCreated = false;

  // Step 1: Backfill images - try fresh scrape first, then fallback to stored URLs
  const { count: existingImageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  if (existingImageCount === 0 && vehicle.discovery_url) {
    console.log(`   🖼️  Fetching fresh image URLs from BaT page...`);
    
    // First, try to get fresh image URLs from simple-scraper
    let imageUrls = [];
    try {
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url },
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });

      if (!scrapeError && scrapeData?.success && scrapeData.data?.images) {
        imageUrls = scrapeData.data.images;
        console.log(`   ✅ Found ${imageUrls.length} fresh image URLs from scraper`);
      }
    } catch (err) {
      console.log(`   ⚠️  Fresh scrape failed: ${err.message}`);
    }

    // Fallback to stored URLs if fresh scrape didn't work
    if (imageUrls.length === 0 && vehicle.origin_metadata?.image_urls && Array.isArray(vehicle.origin_metadata.image_urls)) {
      console.log(`   🔄 Falling back to stored image URLs...`);
      imageUrls = vehicle.origin_metadata.image_urls;
    }

    // Clean and filter BaT image URLs
    const validImages = imageUrls
      .map(cleanBaTImageUrl)
      .filter(url => url !== null)
      .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
      .slice(0, 30);

    if (validImages.length > 0) {
      console.log(`   🖼️  Backfilling ${validImages.length} BaT images...`);
      try {
        const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicle.id,
            image_urls: validImages,
            source: 'bat_backfill',
            run_analysis: false,
            listed_date: vehicle.origin_metadata?.listed_date || vehicle.created_at?.split('T')[0]
          },
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        });

          if (backfillError) {
            console.log(`   ⚠️  Image backfill error: ${backfillError.message}`);
          } else {
            const uploaded = backfillResult?.uploaded || 0;
            const failed = backfillResult?.failed || 0;
            const skipped = backfillResult?.skipped || 0;
            if (uploaded > 0) {
              console.log(`   ✅ Images backfilled: ${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`);
              imagesBackfilled = true;
            } else {
              console.log(`   ⚠️  No images uploaded (${failed} failed, ${skipped} skipped)`);
              // Show error details if available
              if (backfillResult?.errors && backfillResult.errors.length > 0) {
                console.log(`   🔍 Error details:`);
                backfillResult.errors.slice(0, 3).forEach((err, idx) => {
                  console.log(`      ${idx + 1}. ${err}`);
                });
              }
              // Show sample URLs for debugging
              console.log(`   🔍 Sample URLs: ${validImages.slice(0, 2).join(', ')}`);
            }
          }
      } catch (err) {
        console.log(`   ⚠️  Image backfill exception: ${err.message}`);
      }
    } else {
      console.log(`   ⚠️  No valid BaT image URLs found`);
    }
  } else if (existingImageCount > 0) {
    console.log(`   ✅ Already has ${existingImageCount} images`);
    imagesBackfilled = true;
  }

  // Step 2: Extract BaT data using simple-scraper
  const needsData = !vehicle.description || 
                    !vehicle.mileage || 
                    !vehicle.asking_price || 
                    !vehicle.color || 
                    !vehicle.engine_type || 
                    !vehicle.transmission ||
                    !vehicle.vin;

  if (needsData && vehicle.discovery_url) {
    console.log(`   🔄 Extracting BaT data...`);
    try {
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url },
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });

      if (!scrapeError && scrapeData?.success && scrapeData.data) {
        const data = scrapeData.data;
        const html = data.html || '';
        const bodyText = data.text || html;

        // Extract mileage
        if (!vehicle.mileage) {
          const mileagePatterns = [
            /(\d+(?:,\d+)?)\s*k\s*Miles?\s*(?:Shown)?/i,
            /(\d+(?:,\d+)?)\s*Miles?\s*Shown/i,
            /(\d+(?:,\d+)?)\s*Miles?/i
          ];
          for (const pattern of mileagePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              let miles = parseInt(match[1].replace(/,/g, ''));
              if (match[0].toLowerCase().includes('k')) {
                miles = miles * 1000;
              }
              if (miles > 0 && miles < 10000000) {
                updates.mileage = miles;
                console.log(`   ✅ Extracted mileage: ${miles}`);
                break;
              }
            }
          }
        }

        // Extract price
        if (!vehicle.asking_price) {
          const pricePatterns = [
            /Current\s+Bid[:\s]*USD\s*\$?([\d,]+)/i,
            /Bid[:\s]*\$?([\d,]+)/i
          ];
          for (const pattern of pricePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              const price = parseInt(match[1].replace(/,/g, ''));
              if (price > 100 && price < 10000000) {
                updates.asking_price = price;
                console.log(`   ✅ Extracted price: $${price.toLocaleString()}`);
                break;
              }
            }
          }
        }

        // Extract color
        if (!vehicle.color) {
          const colorMatch = bodyText.match(/finished\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
          if (colorMatch) {
            updates.color = colorMatch[1].trim();
            console.log(`   ✅ Extracted color: ${updates.color}`);
          }
        }

        // Extract engine
        if (!vehicle.engine_type) {
          const engineMatch = bodyText.match(/(\d+\.?\d*)\s*-?liter\s+([A-Za-z0-9\s-]+)\s+V?\d+/i);
          if (engineMatch) {
            updates.engine_type = engineMatch[0].trim();
            console.log(`   ✅ Extracted engine: ${updates.engine_type}`);
          }
        }

        // Extract transmission
        if (!vehicle.transmission) {
          const transMatch = bodyText.match(/(\d+)[-\s]*Speed\s+(Manual|Automatic)/i);
          if (transMatch) {
            updates.transmission = `${transMatch[1]}-Speed ${transMatch[2]}`;
            console.log(`   ✅ Extracted transmission: ${updates.transmission}`);
          }
        }

        // Extract VIN
        if (!vehicle.vin) {
          const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
          if (vinMatch) {
            updates.vin = vinMatch[1];
            console.log(`   ✅ Extracted VIN`);
          }
        }

        // Extract description
        if (!vehicle.description && data.description && data.description.length > 10) {
          updates.description = data.description.substring(0, 2000);
          console.log(`   ✅ Extracted description`);
        }
      } else {
        console.log(`   ⚠️  Scraping failed: ${scrapeError?.message || 'Unknown'}`);
      }
    } catch (err) {
      console.log(`   ⚠️  Extraction error: ${err.message}`);
    }
  }

  // Step 3: Create/update timeline event
  const { count: timelineCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id)
    .eq('event_type', 'auction_listed');

  if (timelineCount === 0) {
    console.log(`   📅 Creating BaT timeline event...`);
    try {
      const lotMatch = vehicle.discovery_url.match(/-(\d+)\/?$/);
      const lotNumber = lotMatch ? lotMatch[1] : null;

      const { error: timelineError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          event_type: 'auction_listed',
          event_date: vehicle.origin_metadata?.listed_date || vehicle.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
          title: 'Listed on Bring a Trailer',
          description: `Listed on Bring a Trailer${lotNumber ? ` (Lot #${lotNumber})` : ''}`,
          source: 'bring_a_trailer',
          metadata: {
            source_url: vehicle.discovery_url,
            discovery: true,
            lot_number: lotNumber,
            platform: 'bat'
          }
        });

      if (!timelineError) {
        console.log(`   ✅ Timeline event created`);
        timelineCreated = true;
      } else {
        console.log(`   ⚠️  Timeline creation failed: ${timelineError.message}`);
      }
    } catch (err) {
      console.log(`   ⚠️  Timeline error: ${err.message}`);
    }
  } else {
    console.log(`   ✅ Already has timeline event`);
    timelineCreated = true;
  }

  // Step 4: Update vehicle
  if (Object.keys(updates).length > 0) {
    console.log(`   💾 Updating vehicle with ${Object.keys(updates).length} fields...`);
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);

    if (updateError) {
      console.log(`   ❌ Update failed: ${updateError.message}`);
      return { success: false, error: updateError.message };
    }
    console.log(`   ✅ Vehicle updated`);
  }

  // Step 5: Validate and activate
  const { data: validation, error: validationError } = await supabase.rpc(
    'validate_vehicle_before_public',
    { p_vehicle_id: vehicle.id }
  );

  if (validationError) {
    console.log(`   ⚠️  Validation error: ${validationError.message}`);
  } else if (validation && validation.can_go_live) {
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ status: 'active', is_public: true })
      .eq('id', vehicle.id);

    if (activateError) {
      console.log(`   ⚠️  Activation failed: ${activateError.message}`);
    } else {
      console.log(`   🎉 VEHICLE ACTIVATED! (Score: ${validation.quality_score})`);
      return { success: true, activated: true, imagesBackfilled, timelineCreated };
    }
  } else {
    const missing = [];
    if (validation?.issues) {
      validation.issues.forEach((issue) => {
        if (issue.type === 'error') missing.push(issue.field);
      });
    }
    if (missing.length > 0) {
      console.log(`   ⚠️  Still pending: Missing ${missing.join(', ')}`);
    }
  }

  return { success: true, activated: false, imagesBackfilled, timelineCreated };
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 20;

  console.log('🎯 BaT-Specific Backfill Script\n');
  console.log(`   Batch size: ${batchSize}\n`);

  // Get BaT vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      vin,
      mileage,
      asking_price,
      description,
      color,
      engine_type,
      transmission,
      discovery_url,
      origin_metadata,
      created_at
    `)
    .like('discovery_url', '%bringatrailer.com%')
    .eq('status', 'pending')
    .is('is_public', false)
    .order('created_at', { ascending: false })
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch BaT vehicles:', error.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No pending BaT vehicles to process');
    return;
  }

  console.log(`📋 Processing ${vehicles.length} BaT vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    imagesBackfilled: 0,
    timelinesCreated: 0,
    failed: 0
  };

  for (const vehicle of vehicles) {
    try {
      const result = await backfillBaTVehicle(vehicle);
      results.processed++;
      
      if (result.activated) results.activated++;
      if (result.imagesBackfilled) results.imagesBackfilled++;
      if (result.timelineCreated) results.timelinesCreated++;
      if (!result.success) results.failed++;

      // Delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`❌ Error processing ${vehicle.id}:`, error.message);
      results.failed++;
      results.processed++;
    }
  }

  console.log(`\n✅ BaT Backfill Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated}`);
  console.log(`   Images Backfilled: ${results.imagesBackfilled}`);
  console.log(`   Timelines Created: ${results.timelinesCreated}`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


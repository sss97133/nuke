#!/usr/bin/env node

/**
 * Comprehensive Backfill for All Pending Vehicles
 * 
 * Processes ALL pending vehicles to backfill:
 * - Images (from stored URLs in origin_metadata)
 * - Description, mileage, price, color, engine, transmission (from discovery_url)
 * - VIN (if available)
 * - Timeline events
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

async function backfillVehicle(vehicle) {
  console.log(`\n🔍 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   ID: ${vehicle.id}`);
  console.log(`   URL: ${vehicle.discovery_url || 'NONE'}`);

  const updates = {};
  let imagesBackfilled = false;
  let timelineCreated = false;

  // Step 1: Backfill images from stored URLs
  if (vehicle.origin_metadata?.image_urls && Array.isArray(vehicle.origin_metadata.image_urls)) {
    const imageUrls = vehicle.origin_metadata.image_urls;
    
    // Check if vehicle already has images
    const { count: existingImageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    if (existingImageCount === 0 && imageUrls.length > 0) {
      // Filter and clean valid images (especially for BaT)
      const validImages = imageUrls
        .filter(url => {
          if (!url || typeof url !== 'string') return false;
          const lower = url.toLowerCase();
          
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
            return false;
          }
          
          // For BaT: ONLY include wp-content/uploads (actual vehicle images)
          if (url.includes('bringatrailer.com')) {
            return lower.includes('wp-content/uploads');
          }
          
          // For other sources: Include valid image formats
          return lower.includes('.jpg') || 
                 lower.includes('.jpeg') || 
                 lower.includes('.png') ||
                 lower.includes('images.craigslist.org');
        })
        .map(url => {
          // Decode HTML entities first
          url = url
            .replace(/&#038;/g, '&')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"');
          
          // Clean BaT URLs - remove resize parameters to get full-size images
          if (url.includes('bringatrailer.com') || url.includes('wp-content/uploads')) {
            // Remove resize parameters: ?w=620&resize=620%2C413 -> get full size
            url = url.replace(/[?&]w=\d+/g, '');
            url = url.replace(/[?&]resize=[^&]*/g, '');
            url = url.replace(/[?&]fit=[^&]*/g, '');
            // Remove trailing ? or &
            url = url.replace(/[?&]$/, '');
            // If it's a scaled image, try to get the original
            if (url.includes('-scaled.')) {
              url = url.replace('-scaled.', '.');
            }
          }
          return url;
        })
        .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
        .slice(0, 30); // Limit to 30 for BaT (they have lots of images)

      if (validImages.length > 0) {
        console.log(`   🖼️  Backfilling ${validImages.length} images (BaT: ${vehicle.discovery_url?.includes('bringatrailer') ? 'YES' : 'NO'})...`);
        try {
          const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicle.id,
              image_urls: validImages,
              source: vehicle.discovery_url?.includes('bringatrailer') ? 'bat_backfill' : 'comprehensive_backfill',
              run_analysis: false,
              listed_date: vehicle.origin_metadata?.listed_date || vehicle.created_at?.split('T')[0]
            },
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
          });

          if (backfillError) {
            console.log(`   ⚠️  Image backfill failed: ${backfillError.message || 'Unknown'}`);
            // Try to get more details
            if (backfillError.message?.includes('500')) {
              console.log(`   💡 Tip: Check Edge Function logs for backfill-images`);
            }
          } else {
            const uploaded = backfillResult?.uploaded || 0;
            const failed = backfillResult?.failed || 0;
            if (uploaded > 0) {
              console.log(`   ✅ Images backfilled: ${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}`);
              imagesBackfilled = true;
            } else {
              console.log(`   ⚠️  No images uploaded (${failed} failed) - URLs may be invalid or blocked`);
              // Log first few URLs for debugging
              if (validImages.length > 0) {
                console.log(`   🔍 Sample URLs: ${validImages.slice(0, 2).join(', ')}`);
              }
            }
          }
        } catch (err) {
          console.log(`   ⚠️  Image backfill error: ${err.message}`);
        }
      } else {
        console.log(`   ⚠️  No valid images found in origin_metadata`);
      }
    }
  }

  // Step 2: Backfill data from discovery_url if missing
  // For BaT, use process-import-queue logic; for others, use simple-scraper
  if (vehicle.discovery_url) {
    const needsData = !vehicle.description || 
                      !vehicle.mileage || 
                      !vehicle.asking_price || 
                      !vehicle.color || 
                      !vehicle.engine_type || 
                      !vehicle.transmission ||
                      !vehicle.vin;

    if (needsData) {
      console.log(`   🔄 Extracting missing data from URL...`);
      try {
        let extractedData = null;
        
        // For BaT, trigger process-import-queue which has better BaT parsing
        if (vehicle.discovery_url.includes('bringatrailer.com')) {
          console.log(`   🎯 Using BaT-specific extraction...`);
          // Use simple-scraper first, then enhance with BaT-specific logic
          const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
            body: { url: vehicle.discovery_url }
          });

          if (!scrapeError && scrapeData?.success && scrapeData.data) {
            extractedData = scrapeData.data;
            
            // Enhance BaT data extraction
            const html = scrapeData.data.html || '';
            const bodyText = scrapeData.data.text || html;
            
            // Extract mileage from BaT format: "95k miles", "31k Miles Shown"
            if (!extractedData.mileage) {
              const mileagePatterns = [
                /(\d+(?:,\d+)?)\s*k\s*Miles?\s*(?:Shown)?/i,
                /(\d+(?:,\d+)?)\s*Miles?\s*Shown/i,
                /(\d+(?:,\d+)?)\s*Miles?/i,
                /Odometer[:\s]*(\d+(?:,\d+)?)\s*k?/i
              ];
              for (const pattern of mileagePatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                  let miles = parseInt(match[1].replace(/,/g, ''));
                  if (match[0].toLowerCase().includes('k')) {
                    miles = miles * 1000;
                  }
                  if (miles > 0 && miles < 10000000) {
                    extractedData.mileage = miles;
                    break;
                  }
                }
              }
            }
            
            // Extract price: "Current Bid: USD $8,000"
            if (!extractedData.price) {
              const pricePatterns = [
                /Current\s+Bid[:\s]*USD\s*\$?([\d,]+)/i,
                /Bid[:\s]*\$?([\d,]+)/i,
                /Price[:\s]*\$?([\d,]+)/i
              ];
              for (const pattern of pricePatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                  const price = parseInt(match[1].replace(/,/g, ''));
                  if (price > 100 && price < 10000000) {
                    extractedData.price = price;
                    break;
                  }
                }
              }
            }
            
            // Extract color: "finished in black", "black over black leather"
            if (!extractedData.color) {
              const colorPatterns = [
                /finished\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+over\s+[a-z]+/i
              ];
              for (const pattern of colorPatterns) {
                const match = bodyText.match(pattern);
                if (match && match[1].length < 30) {
                  extractedData.color = match[1].trim();
                  break;
                }
              }
            }
            
            // Extract engine: "3.0-liter diesel V6", "350 V8"
            if (!extractedData.engine_type) {
              const enginePatterns = [
                /(\d+\.?\d*)\s*-?liter\s+([A-Za-z0-9\s-]+)\s+V?\d+/i,
                /(\d+)\s*V\d+/i,
                /powered by a\s+([0-9,\.]+cc\s+[A-Za-z0-9\s-]+)/i
              ];
              for (const pattern of enginePatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                  extractedData.engine_type = match[0].trim();
                  break;
                }
              }
            }
            
            // Extract transmission: "eight-speed Tiptronic S automatic"
            if (!extractedData.transmission) {
              const transPatterns = [
                /(\d+)[-\s]*Speed\s+(Manual|Automatic)/i,
                /(Manual|Automatic)\s+transmission/i,
                /mated to a\s+([A-Za-z0-9\s-]+)\s+transaxle/i
              ];
              for (const pattern of transPatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                  if (match[2]) {
                    extractedData.transmission = `${match[1]}-Speed ${match[2]}`;
                  } else if (match[1]) {
                    extractedData.transmission = match[1];
                  }
                  break;
                }
              }
            }
            
            // Extract VIN
            if (!extractedData.vin) {
              const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
              if (vinMatch) {
                extractedData.vin = vinMatch[1];
              }
            }
          }
        } else {
          // For non-BaT, use simple-scraper
          const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
            body: { url: vehicle.discovery_url }
          });

          if (!scrapeError && scrapeData?.success && scrapeData.data) {
            extractedData = scrapeData.data;
          }
        }

        if (extractedData) {
          // Backfill missing fields
          if (!vehicle.description && extractedData.description && extractedData.description.length > 10) {
            updates.description = extractedData.description.substring(0, 2000);
            console.log(`   ✅ Backfilled description`);
          }
          if (!vehicle.mileage && extractedData.mileage) {
            updates.mileage = extractedData.mileage;
            console.log(`   ✅ Backfilled mileage: ${extractedData.mileage}`);
          }
          if (!vehicle.asking_price && extractedData.price && extractedData.price > 100) {
            updates.asking_price = extractedData.price;
            console.log(`   ✅ Backfilled price: $${extractedData.price.toLocaleString()}`);
          }
          if (!vehicle.color && extractedData.color) {
            updates.color = extractedData.color;
            console.log(`   ✅ Backfilled color: ${updates.color}`);
          }
          if (!vehicle.engine_type && extractedData.engine_type) {
            updates.engine_type = extractedData.engine_type;
            console.log(`   ✅ Backfilled engine: ${updates.engine_type}`);
          }
          if (!vehicle.transmission && extractedData.transmission) {
            updates.transmission = extractedData.transmission;
            console.log(`   ✅ Backfilled transmission: ${updates.transmission}`);
          }
          if (!vehicle.vin && extractedData.vin && extractedData.vin.length === 17) {
            updates.vin = extractedData.vin;
            console.log(`   ✅ Backfilled VIN`);
          }
        } else {
          console.log(`   ⚠️  Scraping failed`);
        }
      } catch (err) {
        console.log(`   ⚠️  Extraction error: ${err.message}`);
      }
    }
  }

  // Step 3: Create timeline event if missing (ALWAYS create for BaT)
  const { count: timelineCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  if (timelineCount === 0 || vehicle.discovery_url?.includes('bringatrailer.com')) {
    console.log(`   📅 Creating timeline event...`);
    try {
      const source = vehicle.discovery_url?.includes('craigslist') ? 'craigslist' :
                     vehicle.discovery_url?.includes('bringatrailer') ? 'bring_a_trailer' :
                     vehicle.discovery_url?.includes('hemmings') ? 'hemmings' :
                     'automated_import';

      // For BaT, try to extract auction date from URL or metadata
      let eventDate = vehicle.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];
      if (vehicle.origin_metadata?.listed_date) {
        eventDate = vehicle.origin_metadata.listed_date;
      } else if (vehicle.origin_metadata?.auction_start_date) {
        eventDate = vehicle.origin_metadata.auction_start_date;
      }

      const { error: timelineError } = await supabase
        .from('timeline_events')
        .upsert({
          vehicle_id: vehicle.id,
          event_type: vehicle.discovery_url?.includes('bringatrailer') ? 'auction_listed' : 'listed_for_sale',
          event_date: eventDate,
          title: vehicle.discovery_url?.includes('bringatrailer') ? 'Listed on Bring a Trailer' : 'Listed for Sale',
          description: vehicle.discovery_url 
            ? `Listed on ${new URL(vehicle.discovery_url).hostname.replace('www.', '')}${vehicle.origin_metadata?.lot_number ? ` (Lot #${vehicle.origin_metadata.lot_number})` : ''}`
            : 'Imported vehicle',
          source: source,
          metadata: {
            source_url: vehicle.discovery_url,
            discovery: true,
            lot_number: vehicle.origin_metadata?.lot_number,
            platform: vehicle.discovery_url?.includes('bringatrailer') ? 'bat' : null
          }
        }, {
          onConflict: 'vehicle_id,event_type,event_date'
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
  }

  // Step 4: Update vehicle with backfilled data
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

  // Step 5: Validate and activate if ready
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
  const batchSize = parseInt(process.argv[2]) || 50;
  const startFrom = parseInt(process.argv[3]) || 0;

  console.log('🚀 Comprehensive Backfill for All Pending Vehicles\n');
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Starting from: ${startFrom}\n`);

  // Get all pending vehicles
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
    .eq('status', 'pending')
    .is('is_public', false)
    .order('created_at', { ascending: false })
    .range(startFrom, startFrom + batchSize - 1);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No pending vehicles to process');
    return;
  }

  console.log(`📋 Processing ${vehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    imagesBackfilled: 0,
    timelinesCreated: 0,
    failed: 0
  };

  for (const vehicle of vehicles) {
    try {
      const result = await backfillVehicle(vehicle);
      results.processed++;
      
      if (result.activated) results.activated++;
      if (result.imagesBackfilled) results.imagesBackfilled++;
      if (result.timelineCreated) results.timelinesCreated++;
      if (!result.success) results.failed++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ Error processing ${vehicle.id}:`, error.message);
      results.failed++;
      results.processed++;
    }
  }

  console.log(`\n✅ Batch Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated}`);
  console.log(`   Images Backfilled: ${results.imagesBackfilled}`);
  console.log(`   Timelines Created: ${results.timelinesCreated}`);
  console.log(`   Failed: ${results.failed}`);
  
  if (results.processed === batchSize) {
    console.log(`\n💡 Run again with: node scripts/comprehensive-backfill-pending.js ${batchSize} ${startFrom + batchSize}`);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


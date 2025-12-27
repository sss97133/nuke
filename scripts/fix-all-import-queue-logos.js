#!/usr/bin/env node
/**
 * Fix ALL vehicles with import_queue organization logos
 * Deletes import_queue images and re-extracts from source
 * Run: node scripts/fix-all-import-queue-logos.js [batch-size] [start-index]
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

const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const START_INDEX = parseInt(process.argv[3]) || 0;

async function fixAllImportQueueLogos() {
  console.log(`🔧 Fixing import_queue logo issue...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Step 1: Get all DISTINCT vehicles with import_queue images
  // Query in chunks to handle large datasets efficiently
  console.log('   Fetching all vehicles with import_queue images...');
  let offset = 0;
  const chunkSize = 5000;
  const seenIds = new Set();
  
  while (true) {
    const { data: chunk, error: chunkError } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .or('storage_path.ilike.%import_queue%,image_url.ilike.%import_queue%')
      .range(offset, offset + chunkSize - 1);
    
    if (chunkError) {
      console.error('❌ Error fetching vehicle IDs:', chunkError);
      return;
    }
    
    if (!chunk || chunk.length === 0) break;
    
    chunk.forEach(v => {
      if (v && v.vehicle_id) seenIds.add(v.vehicle_id);
    });
    
    if (chunk.length < chunkSize) break; // Last chunk
    offset += chunkSize;
    
    if (seenIds.size % 1000 === 0) {
      process.stdout.write(`   Found ${seenIds.size} unique vehicles so far...\r`);
    }
  }
  
  const uniqueVehicleIds = Array.from(seenIds);
  console.log(`\n📊 Found ${uniqueVehicleIds.length} vehicles with import_queue images\n`);
  
  const vehiclesToProcess = uniqueVehicleIds.slice(START_INDEX, START_INDEX + BATCH_SIZE);
  console.log(`🔄 Processing ${vehiclesToProcess.length} vehicles (${START_INDEX} to ${START_INDEX + vehiclesToProcess.length - 1})...\n`);
  
  // Step 2: Get vehicle details
  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      platform_url,
      discovery_url,
      origin_metadata,
      primary_image_url
    `)
    .in('id', vehiclesToProcess);
  
  if (vError) {
    console.error('❌ Error:', vError);
    return;
  }
  
  const results = {
    processed: 0,
    deleted: 0,
    reExtracted: 0,
    fixedPrimary: 0,
    errors: 0,
    skipped: 0
  };
  
  for (const vehicle of vehicles || []) {
    try {
      // Get all images
      const { data: images, error: imgError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, storage_path, is_primary, source')
        .eq('vehicle_id', vehicle.id);
      
      if (imgError) {
        results.errors++;
        continue;
      }
      
      // Find import_queue images
      const importQueueImages = (images || []).filter(img => 
        img.storage_path?.includes('import_queue') || 
        img.image_url?.includes('import_queue')
      );
      
      if (importQueueImages.length === 0) {
        results.skipped++;
        continue;
      }
      
      const goodImages = (images || []).filter(img => 
        !img.storage_path?.includes('import_queue') && 
        !img.image_url?.includes('import_queue') &&
        !img.image_url?.includes('organization-logos') &&
        !img.image_url?.includes('uploads/dealer/')
      );
      
      const primaryIsImportQueue = importQueueImages.some(img => img.is_primary);
      
      // Delete import_queue images
      const importQueueIds = importQueueImages.map(img => img.id);
      const { error: deleteError } = await supabase
        .from('vehicle_images')
        .delete()
        .in('id', importQueueIds);
      
      if (deleteError) {
        console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Delete failed - ${deleteError.message}`);
        results.errors++;
        continue;
      }
      
      results.deleted += importQueueIds.length;
      results.processed++;
      
      // If no good images left, re-extract from source
      if (goodImages.length === 0) {
        const originImages = vehicle.origin_metadata?.image_urls || 
                            vehicle.origin_metadata?.external_images || [];
        
        // Filter out logos from origin images
        const validOriginImages = Array.isArray(originImages) ? originImages.filter((url) => {
          if (!url || typeof url !== 'string') return false;
          const lower = url.toLowerCase();
          return !lower.includes('logo') && 
                 !lower.includes('icon') && 
                 !lower.includes('favicon') &&
                 !lower.includes('organization-logos') &&
                 !lower.includes('uploads/dealer/') &&
                 (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('media.') || lower.includes('images.'));
        }) : [];
        
        if (validOriginImages.length > 0) {
          // Re-extract from origin_metadata using backfill-images
          try {
            const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id: vehicle.id,
                image_urls: validOriginImages.slice(0, 50),
                source: 'external_import',
                max_images: 50,
                run_analysis: false
              }
            });
            
            if (backfillError) {
              console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Backfill failed`);
              results.errors++;
            } else {
              results.reExtracted++;
              console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Deleted ${importQueueIds.length}, re-extracted ${backfillData?.uploaded || 0} images`);
            }
          } catch (e) {
            console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Backfill error`);
            results.errors++;
          }
        } else if (vehicle.discovery_url || vehicle.platform_url) {
          // Try re-extracting from listing URL
          const listingUrl = vehicle.discovery_url || vehicle.platform_url;
          if (listingUrl && !listingUrl.includes('/video')) {
            try {
              const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
                body: {
                  url: listingUrl,
                  max_vehicles: 1,
                  debug: false
                }
              });
              
              if (extractError) {
                console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Extraction failed`);
                results.errors++;
              } else {
                results.reExtracted++;
                console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Deleted ${importQueueIds.length}, re-extracted from listing`);
              }
            } catch (e) {
              console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Extraction error`);
              results.errors++;
            }
          }
        }
      } else {
        // Set first good image as primary if needed
        if (primaryIsImportQueue) {
          const newPrimary = goodImages[0];
          if (newPrimary) {
            // Clear existing primary
            await supabase
              .from('vehicle_images')
              .update({ is_primary: false })
              .eq('vehicle_id', vehicle.id)
              .eq('is_primary', true);
            
            // Set new primary
            await supabase
              .from('vehicle_images')
              .update({ is_primary: true })
              .eq('id', newPrimary.id);
            
            // Update vehicle primary_image_url
            await supabase
              .from('vehicles')
              .update({ primary_image_url: newPrimary.image_url })
              .eq('id', vehicle.id);
            
            results.fixedPrimary++;
            console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Deleted ${importQueueIds.length}, fixed primary image`);
          }
        } else {
          console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Deleted ${importQueueIds.length} import_queue images`);
        }
      }
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Processed: ${results.processed} vehicles`);
  console.log(`   Skipped: ${results.skipped} vehicles (no import_queue images)`);
  console.log(`   Deleted: ${results.deleted} import_queue images`);
  console.log(`   Re-extracted: ${results.reExtracted} vehicles`);
  console.log(`   Fixed primary: ${results.fixedPrimary} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  
  const remaining = uniqueVehicleIds.length - (START_INDEX + vehiclesToProcess.length);
  if (remaining > 0) {
    console.log(`\n💡 ${remaining} vehicles remaining. Run again with:`);
    console.log(`   node scripts/fix-all-import-queue-logos.js ${BATCH_SIZE} ${START_INDEX + BATCH_SIZE}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
  }
}

fixAllImportQueueLogos().catch(console.error);


#!/usr/bin/env node
/**
 * Force re-import images for auction vehicles by deleting existing images first
 * Then re-extracts full galleries with new extraction logic
 * Run: node scripts/force-reimport-auction-images.js [batch-size] [start-index]
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

const BATCH_SIZE = parseInt(process.argv[2]) || 5;
const START_INDEX = parseInt(process.argv[3]) || 0;

const AUCTION_SITES = [
  'carsandbids.com',
  'bringatrailer.com',
  'mecum.com',
  'barrett-jackson.com',
  'barrettjackson.com',
  'pcarmarket.com'
];

function isAuctionSite(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return AUCTION_SITES.some(site => lower.includes(site));
}

async function forceReimport() {
  console.log(`🔥 Force re-import for auction vehicles...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Find auction vehicles needing re-import
  console.log('   Finding auction vehicles...');
  
  const { data: allVehicles, error: findError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url')
    .not('discovery_url', 'is', null)
    .limit(10000);
  
  if (findError) {
    console.error('❌ Error:', findError);
    return;
  }
  
  const vehiclesNeedingReimport = [];
  
  for (const vehicle of allVehicles || []) {
    const discoveryUrl = vehicle.discovery_url || vehicle.platform_url;
    
    if (!discoveryUrl || !isAuctionSite(discoveryUrl)) continue;
    
    // Fix /video URLs
    let cleanUrl = discoveryUrl;
    if (cleanUrl.includes('/video') || cleanUrl.endsWith('/video')) {
      cleanUrl = cleanUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/');
    }
    
    // Check image count
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_primary, is_document')
      .eq('vehicle_id', vehicle.id);
    
    const allImages = images || [];
    const nonDocumentImages = allImages.filter(img => !img.is_document);
    const imageCount = nonDocumentImages.length;
    
    // Check primary image
    const primaryImage = allImages.find(img => img.is_primary);
    const hasBadPrimary = primaryImage && (
      primaryImage.is_document ||
      primaryImage.image_url?.includes('import_queue') ||
      primaryImage.image_url?.includes('organization-logos')
    );
    
    // Include if needs re-import
    if (cleanUrl !== discoveryUrl || imageCount === 0 || imageCount < 5 || hasBadPrimary) {
      vehiclesNeedingReimport.push({
        ...vehicle,
        cleanUrl,
        imageCount,
        hasBadPrimary,
        issue: cleanUrl !== discoveryUrl ? 'video_url' : 
               imageCount === 0 ? 'no_images' : 
               imageCount < 5 ? 'few_images' : 'bad_primary'
      });
    }
  }
  
  console.log(`📊 Found ${vehiclesNeedingReimport.length} auction vehicles needing re-import\n`);
  
  const vehiclesToProcess = vehiclesNeedingReimport.slice(START_INDEX, START_INDEX + BATCH_SIZE);
  console.log(`🔄 Processing ${vehiclesToProcess.length} vehicles (${START_INDEX} to ${START_INDEX + vehiclesToProcess.length - 1})...\n`);
  
  const results = {
    processed: 0,
    fixed: 0,
    deleted: 0,
    reExtracted: 0,
    errors: 0
  };
  
  for (const vehicle of vehiclesToProcess) {
    try {
      let listingUrl = vehicle.cleanUrl || vehicle.discovery_url || vehicle.platform_url;
      
      if (!listingUrl) {
        results.errors++;
        continue;
      }
      
      // Step 1: Fix /video URLs
      if (vehicle.discovery_url?.includes('/video') || vehicle.platform_url?.includes('/video')) {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            discovery_url: listingUrl,
            platform_url: listingUrl
          })
          .eq('id', vehicle.id);
        
        if (updateError) {
          console.error(`   ❌ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: URL update failed`);
          results.errors++;
          continue;
        }
        
        results.fixed++;
        console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Fixed /video URL`);
      }
      
      // Step 2: Delete existing images (force fresh extraction)
      const { data: existingImages } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicle.id);
      
      if (existingImages && existingImages.length > 0) {
        const { error: deleteError } = await supabase
          .from('vehicle_images')
          .delete()
          .eq('vehicle_id', vehicle.id);
        
        if (deleteError) {
          console.error(`   ❌ Delete images failed: ${deleteError.message}`);
          results.errors++;
          continue;
        }
        
        results.deleted += existingImages.length;
        console.log(`   🗑️  Deleted ${existingImages.length} existing images`);
      }
      
      // Step 3: Re-extract images using the right tool
      console.log(`   🔄 Re-extracting: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'} [${vehicle.issue}]`);
      console.log(`      ${listingUrl}`);
      
      let extractData = null;
      let extractError = null;
      
      // Use backfill-images directly for BaT if images exist in origin_metadata
      if (listingUrl.includes('bringatrailer.com')) {
        // Check if vehicle has image URLs in origin_metadata
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('origin_metadata')
          .eq('id', vehicle.id)
          .single();
        
        const imageUrls = vehicleData?.origin_metadata?.image_urls || [];
        if (imageUrls.length > 0) {
          console.log(`   📸 Using backfill-images directly (${imageUrls.length} URLs from origin_metadata)...`);
          const result = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicle.id,
              image_urls: imageUrls,
              source: 'bat_import',
              run_analysis: false,
              max_images: 0, // Upload all
              continue: true,
              sleep_ms: 150,
              max_runtime_ms: 60000
            }
          });
          extractData = result.data;
          extractError = result.error;
        } else {
          // Fallback to comprehensive-bat-extraction if no stored URLs
          console.log(`   📸 Using comprehensive-bat-extraction (no stored URLs found)...`);
          const result = await supabase.functions.invoke('comprehensive-bat-extraction', {
            body: {
              url: listingUrl,
              max_vehicles: 1
            }
          });
          extractData = result.data;
          extractError = result.error;
        }
      } else {
        // Use extract-premium-auction for other sites
        const result = await supabase.functions.invoke('extract-premium-auction', {
          body: {
            url: listingUrl,
            max_vehicles: 1,
            debug: false
          }
        });
        extractData = result.data;
        extractError = result.error;
      }
      
      if (extractError) {
        console.error(`   ❌ Extraction failed: ${extractError.message}`);
        results.errors++;
        continue;
      }
      
      // Debug: Check what images were extracted
      const extractedImages = extractData?.vehicles_extracted?.[0]?.images || [];
      const extractedImageCount = extractedImages.length;
      if (extractedImageCount > 0) {
        console.log(`   📸 Extraction returned ${extractedImageCount} images`);
        // Check if they're actual BaT URLs or storage URLs
        const batUrls = extractedImages.filter((url) => url.includes('bringatrailer.com'));
        const storageUrls = extractedImages.filter((url) => url.includes('supabase.co') || url.includes('import_queue'));
        if (batUrls.length > 0) {
          console.log(`      ✅ ${batUrls.length} BaT URLs found`);
          console.log(`      Sample: ${batUrls[0]?.substring(0, 80)}...`);
        }
        if (storageUrls.length > 0) {
          console.log(`      ⚠️  ${storageUrls.length} storage URLs (BAD - extraction should return external URLs)`);
          console.log(`      Sample: ${storageUrls[0]?.substring(0, 80)}...`);
        }
      } else {
        console.log(`   ⚠️  Extraction returned 0 images`);
      }
      
      // Step 4: Verify quality after extraction
      // Wait longer for backfill functions to complete (they upload images to storage)
      const waitTime = listingUrl.includes('bringatrailer.com') ? 10000 : 2000;
      console.log(`   ⏳ Waiting ${waitTime/1000}s for images to upload...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      const { data: newImages, error: imgCheckError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, is_primary, is_document, storage_path')
        .eq('vehicle_id', vehicle.id);
      
      if (imgCheckError) {
        console.error(`   ❌ Image check failed: ${imgCheckError.message}`);
        results.errors++;
        continue;
      }
      
      const allNewImages = newImages || [];
      const nonDocumentImages = allNewImages.filter(img => !img.is_document);
      const newImageCount = nonDocumentImages.length;
      const totalCount = allNewImages.length;
      
      // Quality checks
      let qualityIssues = [];
      
      // Check 1: Image count
      if (newImageCount === 0) {
        qualityIssues.push('NO_IMAGES');
      } else if (newImageCount < 5) {
        qualityIssues.push(`FEW_IMAGES(${newImageCount})`);
      }
      
      // Check 2: Low-res images
      const isLowRes = (url) => {
        if (!url || typeof url !== 'string') return false;
        return (
          /-\d+x\d+\.(jpg|jpeg|png|webp)$/i.test(url) ||
          /-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i.test(url) ||
          /-small\.(jpg|jpeg|png|webp)$/i.test(url) ||
          url.includes('?w=') || url.includes('?h=') || url.includes('?resize=')
        );
      };
      
      const lowResCount = nonDocumentImages.filter(img => isLowRes(img.image_url)).length;
      const lowResRatio = newImageCount > 0 ? lowResCount / newImageCount : 0;
      if (lowResRatio > 0.3) {
        qualityIssues.push(`LOW_RES(${Math.round(lowResRatio * 100)}%)`);
      }
      
      // Check 3: Primary image quality
      const primaryImage = allNewImages.find(img => img.is_primary);
      if (!primaryImage) {
        qualityIssues.push('NO_PRIMARY');
      } else if (primaryImage.is_document) {
        qualityIssues.push('PRIMARY_IS_DOCUMENT');
      } else if (primaryImage.image_url?.includes('import_queue') || 
                 primaryImage.image_url?.includes('organization-logos')) {
        qualityIssues.push('PRIMARY_IS_LOGO');
      } else if (isLowRes(primaryImage.image_url)) {
        qualityIssues.push('PRIMARY_IS_LOW_RES');
      }
      
      // Check 4: Documents mixed in
      const documentCount = allNewImages.filter(img => img.is_document).length;
      if (documentCount > 0 && documentCount > newImageCount * 0.5) {
        qualityIssues.push(`TOO_MANY_DOCS(${documentCount})`);
      }
      
      // Step 5: Fix primary image if needed
      const isLogo = (img) => {
        const url = img.image_url || '';
        const storagePath = img.storage_path || '';
        return url.includes('import_queue') ||
               url.includes('organization-logos') ||
               url.includes('organization_logos') ||
               storagePath.includes('import_queue') ||
               storagePath.includes('organization-logos') ||
               storagePath.includes('organization_logos') ||
               (url.includes('/logo') && (url.includes('/storage/') || url.includes('supabase.co')));
      };
      
      if (primaryImage && (
        primaryImage.is_document ||
        isLogo(primaryImage) ||
        isLowRes(primaryImage.image_url)
      )) {
        // Find best non-document, non-logo image
        const bestImage = nonDocumentImages.find(img => {
          return !isLogo(img) && !isLowRes(img.image_url);
        });
        
        if (bestImage) {
          console.log(`   🔧 Fixing primary: ${primaryImage.image_url?.substring(0, 60)}...`);
          console.log(`      → ${bestImage.image_url?.substring(0, 60)}...`);
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
            .eq('id', bestImage.id);
          
          // Update vehicle primary_image_url
          await supabase
            .from('vehicles')
            .update({ primary_image_url: bestImage.image_url })
            .eq('id', vehicle.id);
          
          console.log(`   ✅ Fixed primary image`);
          
          // Re-check primary
          const { data: updatedImages } = await supabase
            .from('vehicle_images')
            .select('id, image_url, is_primary')
            .eq('vehicle_id', vehicle.id)
            .eq('is_primary', true)
            .limit(1);
          
          const newPrimary = updatedImages?.[0];
          if (newPrimary) {
            qualityIssues = qualityIssues.filter(issue => 
              !issue.includes('PRIMARY_IS_LOGO') && 
              !issue.includes('PRIMARY_IS_DOCUMENT') &&
              !issue.includes('PRIMARY_IS_LOW_RES')
            );
          }
        } else {
          console.log(`   ⚠️  No suitable image found to replace primary`);
          console.log(`      Available: ${nonDocumentImages.length} non-document images`);
          if (nonDocumentImages.length > 0) {
            console.log(`      First image: ${nonDocumentImages[0].image_url?.substring(0, 80)}...`);
          }
        }
      } else if (!primaryImage) {
        console.log(`   ⚠️  No primary image set`);
      }
      
      // Report results
      if (qualityIssues.length === 0 && newImageCount >= 5) {
        const finalPrimary = allNewImages.find(img => img.is_primary);
        console.log(`   ✅ QUALITY CONFIRMED: ${newImageCount} images (${totalCount} total), ${documentCount} docs`);
        console.log(`      Primary: ${finalPrimary?.image_url?.substring(0, 80) || 'N/A'}...`);
        results.reExtracted++;
      } else {
        console.log(`   ⚠️  QUALITY ISSUES: ${newImageCount} images (${totalCount} total)`);
        qualityIssues.forEach(issue => console.log(`      - ${issue}`));
        const finalPrimary = allNewImages.find(img => img.is_primary);
        if (newImageCount > 0) {
          console.log(`      Primary: ${finalPrimary?.image_url?.substring(0, 80) || 'N/A'}...`);
        }
        // Still count as re-extracted if we got some images, but flag quality
        if (newImageCount > 0) {
          results.reExtracted++;
        } else {
          results.errors++;
        }
      }
      
      results.processed++;
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Processed: ${results.processed} vehicles`);
  console.log(`   Fixed URLs: ${results.fixed} vehicles`);
  console.log(`   Deleted images: ${results.deleted} images`);
  console.log(`   Re-extracted: ${results.reExtracted} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  
  const remaining = vehiclesNeedingReimport.length - (START_INDEX + vehiclesToProcess.length);
  if (remaining > 0) {
    console.log(`\n💡 ${remaining} vehicles remaining. Run again with:`);
    console.log(`   node scripts/force-reimport-auction-images.js ${BATCH_SIZE} ${START_INDEX + BATCH_SIZE}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
  }
}

forceReimport().catch(console.error);


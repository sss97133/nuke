#!/usr/bin/env node

/**
 * Clean Image Pollution - Immediate Gallery Cleanup
 * Removes polluted images from BaT galleries and other sources
 * Focuses on UI elements, navigation, logos, user profiles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

function isPollutedImageUrl(url) {
  if (!url) return true;

  const urlLower = url.toLowerCase();

  // BaT-specific pollution patterns
  const batPollution = [
    // UI elements and navigation
    'wp-content/themes',
    'wp-content/plugins',
    'wp-admin',
    'wp-includes',
    'header',
    'footer',
    'navigation',
    'nav-',
    'logo',
    'icon',
    'sprite',
    'badge',

    // Social media and user content
    'facebook',
    'twitter',
    'instagram',
    'linkedin',
    'youtube',
    'social',
    'avatar',
    'profile',
    'member',
    'user',
    'seller',
    'gravatar',

    // BaT website UI
    'bat-logo',
    'bringatrailer-',
    'site-logo',
    'menu',
    'search',
    'dropdown',
    'popup',
    'modal',
    'overlay',

    // Related content
    'related',
    'similar',
    'recommended',
    'more-from',
    'other-listings',
    'featured',
    'trending',

    // Small/icon images
    'thumbnail',
    'thumb',
    'preview',
    'icon',
    'favicon',

    // Advertisements
    'ad-',
    'ads/',
    'advertisement',
    'sponsor',
    'promo',
    'banner'
  ];

  // Check for pollution patterns
  for (const pattern of batPollution) {
    if (urlLower.includes(pattern)) return true;
  }

  // Check for very small images (likely icons/UI elements)
  const sizeMatch = url.match(/(\d+)x(\d+)/);
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    if (width < 100 || height < 100) return true;
  }

  // Check for common UI image sizes
  const commonUISizes = ['16x16', '32x32', '48x48', '64x64', '96x96', '120x120'];
  if (commonUISizes.some(size => url.includes(size))) return true;

  return false;
}

function isPollutedByContent(url) {
  // Additional content-based checks
  const contentPollution = [
    // File types that are likely not vehicle photos
    '.svg',
    '.gif',
    '.ico',

    // Common UI image names
    'loading',
    'spinner',
    'placeholder',
    'default',
    'no-image',
    'missing',
    'error',
    'blank',

    // Generic/template images
    'template',
    'sample',
    'demo',
    'example',
    'test',

    // Website branding
    'watermark',
    'copyright',
    '©',
    'brand',
    'trademark'
  ];

  const urlLower = url.toLowerCase();
  return contentPollution.some(pattern => urlLower.includes(pattern));
}

async function getVehiclesWithImages() {
  console.log('🔍 Getting vehicles with image galleries to clean...');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url')
    .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
    .order('created_at', { ascending: false })
    .limit(50); // Process in batches

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error);
    return [];
  }

  // Filter to BaT vehicles first (highest pollution risk)
  const batVehicles = vehicles.filter(v =>
    (v.discovery_url || v.bat_auction_url)?.includes('bringatrailer.com')
  );

  console.log(`📊 Found ${vehicles.length} total vehicles, ${batVehicles.length} BaT vehicles to clean first`);
  return batVehicles;
}

async function getVehicleImages(vehicleId) {
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, source_url, position, created_at')
    .eq('vehicle_id', vehicleId)
    .order('position');

  if (error) {
    console.warn(`⚠️ Error fetching images for vehicle ${vehicleId}:`, error.message);
    return [];
  }

  return images || [];
}

async function removePolluteImage(imageId, reason) {
  try {
    const { error } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('id', imageId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, reason };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function cleanVehicleImages(vehicle) {
  console.log(`\n🧹 Cleaning: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`🔗 Source: ${vehicle.discovery_url || vehicle.bat_auction_url}`);

  const images = await getVehicleImages(vehicle.id);

  if (images.length === 0) {
    console.log(`   ℹ️  No images found to clean`);
    return { cleaned: 0, kept: 0, total: 0 };
  }

  console.log(`   📷 Found ${images.length} images to analyze`);

  let cleanedCount = 0;
  let keptCount = 0;
  const removalReasons = [];

  for (const image of images) {
    let shouldRemove = false;
    let reason = '';

    // Check URL-based pollution
    if (isPollutedImageUrl(image.source_url)) {
      shouldRemove = true;
      reason = 'URL pattern pollution';
    }

    // Check content-based pollution
    if (!shouldRemove && isPollutedByContent(image.source_url)) {
      shouldRemove = true;
      reason = 'Content pollution';
    }

    if (shouldRemove) {
      const result = await removePolluteImage(image.id, reason);

      if (result.success) {
        cleanedCount++;
        removalReasons.push(reason);
        console.log(`   🗑️  Removed: ${image.source_url.substring(0, 60)}... (${reason})`);
      } else {
        console.log(`   ❌ Failed to remove: ${result.error}`);
      }
    } else {
      keptCount++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`   ✅ Cleaned ${cleanedCount} polluted images, kept ${keptCount} clean images`);

  return {
    cleaned: cleanedCount,
    kept: keptCount,
    total: images.length,
    reasons: removalReasons
  };
}

async function validateImageGallery(vehicleId) {
  // Re-fetch to validate cleaning worked
  const { count: remainingImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);

  return { remainingImages: remainingImages || 0 };
}

async function cleanImagePollution() {
  console.log('🧹 IMAGE POLLUTION CLEANUP - IMMEDIATE GALLERY CLEANING');
  console.log('='.repeat(80));

  const vehicles = await getVehiclesWithImages();

  if (vehicles.length === 0) {
    console.log('✅ No vehicles found needing image cleanup');
    return;
  }

  let totalCleaned = 0;
  let totalKept = 0;
  let totalProcessed = 0;
  const cleanupResults = [];

  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];

    console.log(`\n📋 VEHICLE ${i + 1}/${vehicles.length}`);
    console.log('-'.repeat(60));

    try {
      const result = await cleanVehicleImages(vehicle);

      totalCleaned += result.cleaned;
      totalKept += result.kept;
      totalProcessed += result.total;

      cleanupResults.push({
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        ...result
      });

      // Validate the cleanup
      const validation = await validateImageGallery(vehicle.id);
      console.log(`   📊 Gallery now has ${validation.remainingImages} clean images`);

      // Progress update every 10 vehicles
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${vehicles.length} vehicles processed`);
        console.log(`🧹 Total pollution removed: ${totalCleaned} images`);
      }

    } catch (error) {
      console.log(`   ❌ Error cleaning vehicle: ${error.message}`);
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 IMAGE CLEANUP COMPLETE');
  console.log('='.repeat(80));
  console.log(`🧹 Total Pollution Removed: ${totalCleaned} images`);
  console.log(`✅ Clean Images Kept: ${totalKept} images`);
  console.log(`📷 Total Images Processed: ${totalProcessed} images`);
  console.log(`📈 Cleanup Rate: ${totalProcessed > 0 ? (totalCleaned / totalProcessed * 100).toFixed(1) : 0}% pollution found`);

  if (totalCleaned > 0) {
    console.log('\n🗑️  TOP POLLUTION SOURCES REMOVED:');
    const reasonCounts = {};
    cleanupResults.forEach(result => {
      result.reasons?.forEach(reason => {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      });
    });

    Object.entries(reasonCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .forEach(([reason, count]) => {
        console.log(`  • ${reason}: ${count} images removed`);
      });
  }

  // Show vehicles with most cleanup needed
  if (cleanupResults.length > 0) {
    console.log('\n🚗 VEHICLES WITH MOST POLLUTION REMOVED:');
    cleanupResults
      .sort((a, b) => b.cleaned - a.cleaned)
      .slice(0, 5)
      .forEach(result => {
        console.log(`  • ${result.vehicle}: ${result.cleaned} polluted images removed`);
      });
  }

  return {
    vehiclesProcessed: vehicles.length,
    totalCleaned,
    totalKept,
    totalProcessed,
    cleanupRate: totalProcessed > 0 ? totalCleaned / totalProcessed : 0
  };
}

async function main() {
  console.log('🧹 IMMEDIATE IMAGE POLLUTION CLEANUP');
  console.log('Removing UI elements, navigation, logos, and user profiles from galleries');
  console.log('='.repeat(80));

  const results = await cleanImagePollution();

  if (results) {
    console.log('\n🎯 NEXT STEPS:');
    console.log('1. ✅ Polluted images removed from galleries');
    console.log('2. Run this again to clean more vehicles');
    console.log('3. Check galleries in UI - should be cleaner now');
    console.log('4. Set up automated pollution prevention for new extractions');

    if (results.totalCleaned > 50) {
      console.log('\n⚠️  HIGH POLLUTION DETECTED - Consider:');
      console.log('   • Updating extraction filters');
      console.log('   • Implementing better image validation');
      console.log('   • Adding AI image content checks');
    }
  }
}

main().catch(console.error);
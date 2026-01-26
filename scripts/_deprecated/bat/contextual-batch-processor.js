#!/usr/bin/env node

/**
 * CONTEXTUAL BATCH PROCESSOR
 * 
 * Intelligent image processor that:
 * 1. Groups images by vehicle for context efficiency
 * 2. Loads vehicle context once per vehicle (saves tokens)
 * 3. Creates targeted questionnaires per image type
 * 4. Tracks token usage and costs
 * 5. Can reprocess images when new documentation arrives
 * 6. Prioritizes images by importance
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration
const BATCH_SIZE = 3; // Process 3 images per vehicle at a time
const DELAY_MS = 3000; // 3 second delay between batches
const REPROCESS_MODE = process.argv.includes('--reprocess');
const VEHICLE_FILTER = process.argv.find(arg => arg.startsWith('--vehicle='))?.split('=')[1];

let stats = {
  vehiclesProcessed: 0,
  imagesProcessed: 0,
  imagesSuccess: 0,
  imagesFailed: 0,
  tokensUsed: 0,
  estimatedCost: 0,
  contextLoads: 0,
  startTime: Date.now()
};

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function estimateTokens(imageType, hasContext) {
  // Estimated tokens per analysis
  const baseTokens = {
    engine_bay: 800,
    interior: 700,
    undercarriage: 750,
    wheel_tire: 600,
    work_in_progress: 900,
    documentation: 1000,
    exterior: 650
  };
  
  const contextOverhead = hasContext ? 200 : 0;
  return (baseTokens[imageType] || 700) + contextOverhead;
}

async function getVehiclesWithUnprocessedImages() {
  console.log('\n📊 Finding vehicles with unprocessed images...');
  
  let query = supabase
    .from('vehicle_images')
    .select('vehicle_id, id, image_url, ai_scan_metadata')
    .order('created_at', { ascending: false });
  
  if (VEHICLE_FILTER) {
    query = query.eq('vehicle_id', VEHICLE_FILTER);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('❌ Error:', error);
    return [];
  }
  
  // Group by vehicle and filter unprocessed
  const vehicleGroups = {};
  
  data?.forEach(img => {
    const needsProcessing = REPROCESS_MODE || 
      !img.ai_scan_metadata || 
      !img.ai_scan_metadata.scanned_at ||
      !img.ai_scan_metadata.contextual_analysis;
    
    if (needsProcessing) {
      if (!vehicleGroups[img.vehicle_id]) {
        vehicleGroups[img.vehicle_id] = [];
      }
      vehicleGroups[img.vehicle_id].push(img);
    }
  });
  
  const vehicles = Object.entries(vehicleGroups).map(([vehicleId, images]) => ({
    vehicleId,
    images,
    imageCount: images.length
  }));
  
  // Sort by image count (process vehicles with more images first for efficiency)
  vehicles.sort((a, b) => b.imageCount - a.imageCount);
  
  const totalImages = vehicles.reduce((sum, v) => sum + v.imageCount, 0);
  
  console.log(`   Found ${vehicles.length} vehicles with ${totalImages} unprocessed images`);
  
  if (REPROCESS_MODE) {
    console.log(`   🔄 REPROCESS MODE - Will analyze all images with fresh context`);
  }
  
  return vehicles;
}

async function getVehicleContextSummary(vehicleId) {
  // Get basic vehicle info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, trim')
    .eq('id', vehicleId)
    .single();
  
  // Count context items
  const { count: timelineCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);
  
  const { count: receiptCount } = await supabase
    .from('receipts')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);
  
  return {
    vehicle: vehicle || {},
    timelineCount: timelineCount || 0,
    receiptCount: receiptCount || 0
  };
}

async function processImage(image, vehicleContext) {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-image-contextual', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        image_id: image.id,
        reprocess: REPROCESS_MODE
      }
    });
    
    if (error) {
      return {
        success: false,
        imageId: image.id,
        error: error.message
      };
    }
    
    // Estimate tokens used
    const tokensUsed = estimateTokens(data.image_type || 'exterior', true);
    stats.tokensUsed += tokensUsed;
    stats.estimatedCost += (tokensUsed / 1000) * 0.015; // $0.015 per 1K tokens for GPT-4o
    
    return {
      success: true,
      imageId: image.id,
      analysis: data.analysis,
      insights: data.insights,
      tags: data.tags,
      tokensUsed
    };
  } catch (e) {
    return {
      success: false,
      imageId: image.id,
      error: e.message
    };
  }
}

async function processVehicle(vehicle, vehicleNum, totalVehicles) {
  const { vehicleId, images, imageCount } = vehicle;
  
  console.log(`\n╔${'═'.repeat(78)}╗`);
  console.log(`║ Vehicle ${vehicleNum}/${totalVehicles}: ${vehicleId.substring(0, 8)}... (${imageCount} images)`);
  console.log(`╚${'═'.repeat(78)}╝`);
  
  // Get vehicle context summary
  const context = await getVehicleContextSummary(vehicleId);
  stats.contextLoads++;
  
  console.log(`\n🚗 ${context.vehicle.year || '?'} ${context.vehicle.make || '?'} ${context.vehicle.model || '?'}`);
  console.log(`   Timeline events: ${context.timelineCount}`);
  console.log(`   Receipts: ${context.receiptCount}`);
  console.log(`   Context richness: ${context.timelineCount + context.receiptCount > 10 ? 'HIGH' : context.timelineCount + context.receiptCount > 3 ? 'MEDIUM' : 'LOW'}`);
  
  // Process images in batches
  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }
  
  let vehicleSuccess = 0;
  let vehicleFailed = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    console.log(`\n   📦 Batch ${i + 1}/${batches.length} (${batch.length} images)`);
    console.log(`   ${'─'.repeat(76)}`);
    
    const results = await Promise.all(
      batch.map(async (img) => {
        const result = await processImage(img, context);
        const shortId = result.imageId.substring(0, 8);
        
        if (result.success) {
          console.log(`      ✓ ${shortId}... | ${result.tags} tags | ~${result.tokensUsed} tokens | ${result.insights?.maintenance_needed?.length || 0} insights`);
          vehicleSuccess++;
          stats.imagesSuccess++;
        } else {
          console.log(`      ✗ ${shortId}... | Error: ${result.error}`);
          vehicleFailed++;
          stats.imagesFailed++;
        }
        
        stats.imagesProcessed++;
        return result;
      })
    );
    
    // Show batch summary
    const batchSuccess = results.filter(r => r.success).length;
    const batchTokens = results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    
    console.log(`   ${'─'.repeat(76)}`);
    console.log(`      Success: ${batchSuccess}/${batch.length} | Tokens: ~${batchTokens} | Cost: ~$${((batchTokens / 1000) * 0.015).toFixed(3)}`);
    
    // Delay between batches
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  stats.vehiclesProcessed++;
  
  console.log(`\n   ✅ Vehicle complete: ${vehicleSuccess} success, ${vehicleFailed} failed`);
  
  return { vehicleSuccess, vehicleFailed };
}

async function generateReport() {
  const duration = Date.now() - stats.startTime;
  const imagesPerMinute = (stats.imagesProcessed / (duration / 60000)).toFixed(1);
  const avgTokensPerImage = Math.round(stats.tokensUsed / stats.imagesProcessed);
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('📊 CONTEXTUAL ANALYSIS COMPLETE');
  console.log('═'.repeat(80));
  console.log(`\n🚗 Vehicles:`);
  console.log(`   Total processed: ${stats.vehiclesProcessed}`);
  console.log(`   Context loads: ${stats.contextLoads} (efficient: ${stats.contextLoads === stats.vehiclesProcessed ? 'YES ✓' : 'NO ✗'})`);
  
  console.log(`\n📸 Images:`);
  console.log(`   Total processed: ${stats.imagesProcessed}`);
  console.log(`   Successful: ${stats.imagesSuccess} (${((stats.imagesSuccess/stats.imagesProcessed)*100).toFixed(1)}%)`);
  console.log(`   Failed: ${stats.imagesFailed}`);
  console.log(`   Rate: ${imagesPerMinute} images/minute`);
  
  console.log(`\n💰 Token Usage:`);
  console.log(`   Total tokens: ~${stats.tokensUsed.toLocaleString()}`);
  console.log(`   Avg per image: ~${avgTokensPerImage}`);
  console.log(`   Estimated cost: ~$${stats.estimatedCost.toFixed(2)}`);
  console.log(`   Cost per image: ~$${(stats.estimatedCost / stats.imagesProcessed).toFixed(3)}`);
  
  console.log(`\n⏱️  Performance:`);
  console.log(`   Duration: ${formatDuration(duration)}`);
  console.log(`   Avg time per vehicle: ${formatDuration(duration / stats.vehiclesProcessed)}`);
  console.log(`   Avg time per image: ${Math.round(duration / stats.imagesProcessed / 1000)}s`);
  
  console.log(`\n${'═'.repeat(80)}\n`);
  
  // Query database for final stats
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true });
  
  const { data: processedImages } = await supabase
    .from('vehicle_images')
    .select('ai_scan_metadata');
  
  const contextuallyProcessed = processedImages?.filter(
    img => img.ai_scan_metadata?.contextual_analysis
  ).length || 0;
  
  console.log(`📈 Database Status:`);
  console.log(`   Total images: ${totalImages}`);
  console.log(`   Contextually processed: ${contextuallyProcessed} (${((contextuallyProcessed/totalImages)*100).toFixed(1)}%)`);
  console.log(`   Remaining: ${totalImages - contextuallyProcessed}`);
  console.log(`\n`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              CONTEXTUAL BATCH PROCESSOR                                    ║');
  console.log('║                                                                            ║');
  console.log('║  Intelligent image analysis using full vehicle context                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Batch size: ${BATCH_SIZE} images per vehicle`);
  console.log(`   Delay: ${DELAY_MS}ms between batches`);
  console.log(`   Mode: ${REPROCESS_MODE ? 'REPROCESS ALL' : 'NEW ONLY'}`);
  if (VEHICLE_FILTER) {
    console.log(`   Filter: Vehicle ${VEHICLE_FILTER}`);
  }
  
  const vehicles = await getVehiclesWithUnprocessedImages();
  
  if (vehicles.length === 0) {
    console.log(`\n✅ No images to process!${REPROCESS_MODE ? ' (even in reprocess mode)' : ''}\n`);
    return;
  }
  
  console.log(`\n🎯 Processing Strategy:`);
  console.log(`   ${vehicles.length} vehicles to process`);
  console.log(`   ${vehicles.reduce((sum, v) => sum + v.imageCount, 0)} total images`);
  console.log(`   Context loaded once per vehicle (efficient!)`);
  console.log(`   Targeted questionnaires per image type`);
  
  console.log(`\n🚀 Starting processing...\n`);
  
  // Process each vehicle
  for (let i = 0; i < vehicles.length; i++) {
    await processVehicle(vehicles[i], i + 1, vehicles.length);
    
    // Delay between vehicles
    if (i < vehicles.length - 1) {
      console.log(`\n   ⏳ Brief pause before next vehicle...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Generate final report
  await generateReport();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});


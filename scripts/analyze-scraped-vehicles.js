#!/usr/bin/env node
/**
 * Run image analysis on all scraped vehicles
 * This creates the "incredible data" from raw images
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeScrapedVehicles() {
  console.log('🤖 Running AI Analysis on Scraped Vehicles\n');
  
  // Get images from scraped vehicles
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select(`
      id,
      image_url,
      vehicle_id,
      ai_scan_metadata,
      vehicles!inner(discovery_source, year, make, model)
    `)
    .eq('vehicles.discovery_source', 'craigslist_scrape')
    .order('created_at', { ascending: false })
    .limit(100);
  
  if (error) {
    console.error('❌ Error fetching images:', error.message);
    return;
  }
  
  const needsAnalysis = images.filter(img => !img.ai_scan_metadata);
  const alreadyAnalyzed = images.filter(img => img.ai_scan_metadata);
  
  console.log(`Total images: ${images.length}`);
  console.log(`Already analyzed: ${alreadyAnalyzed.length}`);
  console.log(`Needs analysis: ${needsAnalysis.length}\n`);
  
  if (needsAnalysis.length === 0) {
    console.log('✅ All images already analyzed!');
    return;
  }
  
  console.log(`Processing ${needsAnalysis.length} images...\n`);
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  for (const image of needsAnalysis) {
    processed++;
    const vehicleName = `${image.vehicles.year} ${image.vehicles.make} ${image.vehicles.model}`;
    
    console.log(`[${processed}/${needsAnalysis.length}] ${vehicleName}`);
    console.log(`   Image: ${image.id.substring(0, 8)}...`);
    
    try {
      // Call tier1 analysis (cheap, fast, organizes image)
      const { data, error: analysisError } = await supabase.functions.invoke('analyze-image-tier1', {
        body: {
          image_url: image.image_url,
          vehicle_id: image.vehicle_id,
          image_id: image.id
        }
      });
      
      if (analysisError) {
        console.log(`   ❌ Analysis failed: ${analysisError.message}`);
        failed++;
      } else {
        console.log(`   ✅ Analyzed - ${data?.angle || 'unknown angle'}, ${data?.category || 'unknown category'}`);
        succeeded++;
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
      failed++;
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ANALYSIS COMPLETE\n');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${((succeeded/processed)*100).toFixed(1)}%\n`);
}

analyzeScrapedVehicles().catch(console.error);


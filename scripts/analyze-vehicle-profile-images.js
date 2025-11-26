/**
 * Analyze images from a specific vehicle profile
 * Extracts angle, environment, context, and seller psychology indicators
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ Error: SUPABASE_ANON_KEY not found');
  process.exit(1);
}

const vehicleId = process.argv[2];

if (!vehicleId) {
  console.error('❌ Error: vehicle_id is required');
  console.error('   Usage: node scripts/analyze-vehicle-profile-images.js <vehicle_id>');
  console.error('   Example: node scripts/analyze-vehicle-profile-images.js e90512ed-9d9c-4467-932e-061fa871de83');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

async function getVehicleImages(vehicleId) {
  console.log(`📸 Fetching images for vehicle: ${vehicleId}\n`);
  
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, caption, created_at, taken_at')
    .eq('vehicle_id', vehicleId)
    .eq('is_document', false)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }

  return images || [];
}

async function analyzeImage(imageUrl, imageId, index, total) {
  console.log(`\n[${index + 1}/${total}] Analyzing image...`);
  console.log(`   ID: ${imageId}`);
  console.log(`   URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-image', {
      body: {
        image_url: imageUrl,
        prompt: `Extract vehicle image metadata. Return compact JSON:
{
  "angle":"exterior_front|exterior_rear|exterior_side|exterior_three_quarter|interior_front_seats|interior_rear_seats|interior_dashboard|interior_door|engine_bay|undercarriage|detail_shot|document|other",
  "environment":"garage|driveway|street|dealership|shop|outdoor_natural|staged_studio|other",
  "context":{
    "background_objects":["item1","item2"],
    "surrounding_area":"brief description",
    "time_of_day":"day|night|dusk|dawn|indoor",
    "weather_visible":true/false,
    "other_vehicles_visible":true/false
  },
  "presentation":{
    "is_positioned":true/false,
    "is_natural":true/false,
    "staging_indicators":["indicator1"],
    "photo_quality":"professional|amateur|cellphone|other"
  },
  "care_assessment":{
    "owner_cares":true/false,
    "evidence":["evidence1"],
    "condition_indicators":["clean","dirty","well_maintained","neglected"],
    "care_level":"high|medium|low|unknown"
  },
  "seller_psychology":{
    "is_staged":true/false,
    "intent":"selling|showcase|documentation|casual",
    "confidence_indicators":["indicator1"],
    "transparency_level":"high|medium|low"
  }
}
Minimize tokens, use compact JSON.`
      }
    });

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      return { success: false, error: error.message, imageId };
    }

    if (!data.success) {
      console.error(`   ❌ Failed: ${data.error}`);
      return { success: false, error: data.error, imageId };
    }

    const extracted = data.extracted_data;
    const metadata = data.metadata;

    console.log(`   ✅ Success! (${metadata.tokens.total} tokens, $${metadata.cost.total_cost})`);
    console.log(`   • Angle: ${extracted.angle || 'unknown'}`);
    console.log(`   • Environment: ${extracted.environment || 'unknown'}`);
    if (extracted.presentation) {
      console.log(`   • Positioned: ${extracted.presentation.is_positioned ? 'Yes' : 'No'}`);
      console.log(`   • Natural: ${extracted.presentation.is_natural ? 'Yes' : 'No'}`);
    }
    if (extracted.care_assessment) {
      console.log(`   • Owner Cares: ${extracted.care_assessment.owner_cares ? 'Yes' : 'No'} (${extracted.care_assessment.care_level})`);
    }
    if (extracted.seller_psychology) {
      console.log(`   • Staged: ${extracted.seller_psychology.is_staged ? 'Yes' : 'No'}`);
      console.log(`   • Intent: ${extracted.seller_psychology.intent || 'unknown'}`);
    }

    return {
      success: true,
      imageId,
      imageUrl,
      extracted_data: extracted,
      metadata: metadata
    };
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return { success: false, error: err.message, imageId };
  }
}

async function main() {
  console.log('🔍 Vehicle Profile Image Analysis\n');
  console.log('='.repeat(80));

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, make, model, year, vin')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error(`❌ Vehicle not found: ${vehicleId}`);
    process.exit(1);
  }

  console.log(`🚗 Vehicle: ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`);
  if (vehicle.vin) console.log(`   VIN: ${vehicle.vin}`);
  console.log('');

  // Get images
  const images = await getVehicleImages(vehicleId);
  
  if (images.length === 0) {
    console.log('❌ No images found for this vehicle');
    process.exit(1);
  }

  console.log(`📸 Found ${images.length} images\n`);
  console.log('='.repeat(80));

  // Analyze each image
  const results = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const result = await analyzeImage(image.image_url, image.id, i, images.length);
    results.push(result);
    
    // Small delay to avoid rate limits
    if (i < images.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 ANALYSIS SUMMARY\n');

  const successful = results.filter(r => r.success);
  console.log(`✅ Successful: ${successful.length}/${results.length}`);

  if (successful.length > 0) {
    // Angle distribution
    const angles = {};
    const environments = {};
    const careLevels = {};
    const stagedCount = { staged: 0, natural: 0 };
    const positionedCount = { positioned: 0, natural: 0 };

    successful.forEach(r => {
      const data = r.extracted_data;
      
      if (data.angle) angles[data.angle] = (angles[data.angle] || 0) + 1;
      if (data.environment) environments[data.environment] = (environments[data.environment] || 0) + 1;
      if (data.care_assessment?.care_level) {
        careLevels[data.care_assessment.care_level] = (careLevels[data.care_assessment.care_level] || 0) + 1;
      }
      if (data.seller_psychology?.is_staged) {
        stagedCount[data.seller_psychology.is_staged ? 'staged' : 'natural']++;
      }
      if (data.presentation?.is_positioned) {
        positionedCount[data.presentation.is_positioned ? 'positioned' : 'natural']++;
      }
    });

    console.log('\n📐 Angles:');
    Object.entries(angles).forEach(([angle, count]) => {
      console.log(`   • ${angle}: ${count}`);
    });

    console.log('\n🌍 Environments:');
    Object.entries(environments).forEach(([env, count]) => {
      console.log(`   • ${env}: ${count}`);
    });

    console.log('\n💚 Care Levels:');
    Object.entries(careLevels).forEach(([level, count]) => {
      console.log(`   • ${level}: ${count}`);
    });

    console.log('\n🎬 Staging:');
    console.log(`   • Staged: ${stagedCount.staged}`);
    console.log(`   • Natural: ${stagedCount.natural}`);

    console.log('\n📸 Positioning:');
    console.log(`   • Positioned: ${positionedCount.positioned}`);
    console.log(`   • Natural: ${positionedCount.natural}`);

    // Total cost
    const totalTokens = successful.reduce((sum, r) => sum + (r.metadata?.tokens?.total || 0), 0);
    const totalCost = successful.reduce((sum, r) => sum + (r.metadata?.cost?.total_cost || 0), 0);
    console.log(`\n💰 Total: ${totalTokens.toLocaleString()} tokens, $${totalCost.toFixed(6)}`);
  }

  // Save results
  const fs = await import('fs');
  const resultsFile = `vehicle-analysis-${vehicleId}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify({
    vehicle_id: vehicleId,
    vehicle_info: vehicle,
    timestamp: new Date().toISOString(),
    total_images: images.length,
    successful: successful.length,
    results: results
  }, null, 2));

  console.log(`\n💾 Full results saved to: ${resultsFile}`);
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * Re-extract VINs from all vehicle images in the database
 * 
 * This script:
 * 1. Gets all vehicles (optionally filter by those without VINs)
 * 2. Gets all images for those vehicles
 * 3. Uses OpenAI Vision to extract VINs from images
 * 4. Updates vehicle VINs if found with high confidence
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

if (!openaiKey) {
  console.error('❌ OPENAI_API_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Configuration
const MIN_CONFIDENCE = 70; // Only update VINs with confidence >= 70%
const ONLY_MISSING_VINS = true; // Only process vehicles without VINs
const MAX_IMAGES_PER_VEHICLE = 20; // Limit images per vehicle to avoid costs

/**
 * Extract VIN from image using OpenAI Vision
 */
async function extractVINFromImage(imageUrl) {
  try {
    // Convert image URL to base64 or use URL directly
    // For Supabase storage URLs, we can use them directly
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert at identifying and reading VIN (Vehicle Identification Number) tags and plates on vehicles.

VIN tags/plates are metal or plastic plates typically found:
- On the driver's side dashboard (visible through windshield)
- On the driver's side door jamb
- On the firewall/engine bay
- On the frame/chassis

A VIN is EXACTLY 17 characters, alphanumeric (no I, O, or Q), and follows ISO 3779 format.

Return a JSON object with:
{
  "is_vin_tag": boolean,
  "confidence": number (0-100),
  "extracted_data": {
    "vin": string | null (17-character VIN if found),
    "vin_location": string | null ("dashboard", "door_jamb", "firewall", "frame", "unknown"),
    "readability": string | null ("clear", "partial", "difficult", "illegible")
  }
}

Be very careful to extract the EXACT VIN - check each character carefully.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this vehicle image for a VIN tag/plate. Extract the complete 17-character VIN if found.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ⚠️ OpenAI API error: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return null;
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    if (result.is_vin_tag && result.extracted_data?.vin) {
      const vin = result.extracted_data.vin.toUpperCase().trim();
      
      // Validate VIN format
      if (vin.length === 17 && !/[IOQ]/.test(vin)) {
        return {
          vin: vin,
          confidence: result.confidence || 0,
          location: result.extracted_data.vin_location || 'unknown',
          readability: result.extracted_data.readability || 'unknown'
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`  ⚠️ Error extracting VIN:`, error.message);
    return null;
  }
}

/**
 * Process a single vehicle
 */
async function processVehicle(vehicle) {
  console.log(`\n📦 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);
  console.log(`   Current VIN: ${vehicle.vin || 'None'}`);

  // Get images for this vehicle
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_document')
    .eq('vehicle_id', vehicle.id)
    .eq('is_document', false) // Skip documents
    .order('created_at', { ascending: true })
    .limit(MAX_IMAGES_PER_VEHICLE);

  if (imagesError) {
    console.error(`  ❌ Error fetching images:`, imagesError.message);
    return { processed: false, found: false };
  }

  if (!images || images.length === 0) {
    console.log(`  ⚠️ No images found`);
    return { processed: false, found: false };
  }

  console.log(`   Found ${images.length} images, processing...`);

  // Try to extract VIN from each image
  let bestVIN = null;
  let bestConfidence = 0;
  let bestImage = null;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    console.log(`   [${i + 1}/${images.length}] Analyzing image ${image.id}...`);

    const result = await extractVINFromImage(image.image_url);

    if (result && result.confidence >= MIN_CONFIDENCE) {
      console.log(`      ✅ Found VIN: ${result.vin} (confidence: ${result.confidence}%, location: ${result.location})`);
      
      if (result.confidence > bestConfidence) {
        bestVIN = result.vin;
        bestConfidence = result.confidence;
        bestImage = image.id;
      }
    } else if (result) {
      console.log(`      ⚠️ VIN found but low confidence: ${result.confidence}%`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Update vehicle VIN if we found one
  if (bestVIN && bestConfidence >= MIN_CONFIDENCE) {
    // Only update if vehicle doesn't have a VIN, or if we found a different one
    if (!vehicle.vin || vehicle.vin.toUpperCase() !== bestVIN.toUpperCase()) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ vin: bestVIN })
        .eq('id', vehicle.id);

      if (updateError) {
        console.error(`  ❌ Error updating VIN:`, updateError.message);
        return { processed: true, found: true, updated: false };
      }

      console.log(`  ✅ Updated VIN: ${bestVIN} (confidence: ${bestConfidence}%)`);
      return { processed: true, found: true, updated: true, vin: bestVIN, confidence: bestConfidence };
    } else {
      console.log(`  ℹ️ VIN already matches: ${bestVIN}`);
      return { processed: true, found: true, updated: false };
    }
  } else {
    console.log(`  ❌ No VIN found with sufficient confidence`);
    return { processed: true, found: false };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Re-extracting VINs from vehicle images...\n');

  // Get all vehicles
  let vehicleQuery = supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .order('created_at', { ascending: false });

  // Optionally filter to only vehicles without VINs
  if (ONLY_MISSING_VINS) {
    vehicleQuery = vehicleQuery.or('vin.is.null,vin.eq.,vin.like.VIVA-%');
  }

  const { data: vehicles, error: vehiclesError } = await vehicleQuery;

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('ℹ️ No vehicles found');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles to process\n`);
  console.log(`Configuration:`);
  console.log(`  - Min confidence: ${MIN_CONFIDENCE}%`);
  console.log(`  - Only missing VINs: ${ONLY_MISSING_VINS}`);
  console.log(`  - Max images per vehicle: ${MAX_IMAGES_PER_VEHICLE}`);
  console.log(`\nStarting processing...\n`);

  const stats = {
    total: vehicles.length,
    processed: 0,
    found: 0,
    updated: 0,
    errors: 0
  };

  // Process vehicles one at a time to avoid rate limiting
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    console.log(`\n[${i + 1}/${vehicles.length}]`);

    try {
      const result = await processVehicle(vehicle);
      
      stats.processed++;
      if (result.found) stats.found++;
      if (result.updated) stats.updated++;
    } catch (error) {
      console.error(`  ❌ Error processing vehicle:`, error.message);
      stats.errors++;
    }
  }

  console.log(`\n\n✅ Processing complete!`);
  console.log(`\nStatistics:`);
  console.log(`  Total vehicles: ${stats.total}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  VINs found: ${stats.found}`);
  console.log(`  VINs updated: ${stats.updated}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(console.error);


/**
 * Batch Extract All Images
 * Processes all vehicle images through the extract-image edge function
 * Stores extractions indexed by model name for comparison
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  global: {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  }
});

// Rate limiting: process with delay to avoid hitting API limits
const DELAY_BETWEEN_IMAGES = 1000; // 1 second between images
const BATCH_SIZE = 10; // Process in batches

// Format extraction data for storage (indexed by model)
function formatExtractionForStorage(extractedData, metadata) {
  const angleLabels = {
    'exterior_front': 'Front View',
    'exterior_rear': 'Rear View',
    'exterior_side': 'Side View',
    'exterior_three_quarter': 'Three-Quarter View',
    'interior_front_seats': 'Interior - Front Seats',
    'interior_rear_seats': 'Interior - Rear Seats',
    'interior_dashboard': 'Interior - Dashboard',
    'interior_door': 'Interior - Door',
    'engine_bay': 'Engine Bay',
    'undercarriage': 'Undercarriage',
    'detail_shot': 'Detail Shot',
    'document': 'Document',
    'other': 'Other'
  };

  const modelName = metadata.model || 'gemini-1.5-flash';
  const extractedAt = new Date().toISOString();

  // Build context description
  const contextParts = [];
  if (extractedData.environment) {
    contextParts.push(`Environment: ${extractedData.environment}`);
  }
  if (extractedData.context?.surrounding_area) {
    contextParts.push(extractedData.context.surrounding_area);
  }
  if (extractedData.presentation?.photo_quality) {
    contextParts.push(`Photo quality: ${extractedData.presentation.photo_quality}`);
  }
  if (extractedData.care_assessment?.care_level) {
    contextParts.push(`Care level: ${extractedData.care_assessment.care_level}`);
  }
  if (extractedData.seller_psychology?.intent) {
    contextParts.push(`Intent: ${extractedData.seller_psychology.intent}`);
  }

  // Build description
  const descriptionParts = [];
  if (extractedData.angle) {
    descriptionParts.push(`Angle: ${angleLabels[extractedData.angle] || extractedData.angle}`);
  }
  if (extractedData.context?.background_objects?.length > 0) {
    descriptionParts.push(`Background: ${extractedData.context.background_objects.slice(0, 3).join(', ')}`);
  }
  if (extractedData.context?.time_of_day) {
    descriptionParts.push(`Time: ${extractedData.context.time_of_day}`);
  }
  if (extractedData.presentation?.is_positioned !== undefined) {
    descriptionParts.push(`Positioned: ${extractedData.presentation.is_positioned ? 'Yes' : 'No'}`);
  }
  if (extractedData.care_assessment?.owner_cares !== undefined) {
    descriptionParts.push(`Owner cares: ${extractedData.care_assessment.owner_cares ? 'Yes' : 'No'}`);
  }

  return {
    model: modelName,
    extracted_at: extractedAt,
    angle: extractedData.angle || null,
    primary_label: angleLabels[extractedData.angle] || extractedData.angle || 'Unknown',
    description: descriptionParts.join(' • ') || 'No description available',
    context: contextParts.join(' | ') || 'No context available',
    // Full extraction data
    extraction_data: extractedData,
    // Metadata about this extraction
    metadata: {
      tokens: metadata.tokens,
      cost: metadata.cost,
      efficiency: metadata.efficiency,
      model_tier: metadata.model_tier || 'free',
      finish_reason: metadata.finish_reason
    },
    // Context-aware extraction
    context_extraction: {
      angle: extractedData.angle,
      environment: extractedData.environment,
      context: extractedData.context,
      presentation: extractedData.presentation,
      care_assessment: extractedData.care_assessment,
      seller_psychology: extractedData.seller_psychology
    }
  };
}

// Save extraction to database (indexed by model)
async function saveExtraction(imageId, extraction, metadata) {
  try {
    // Get current metadata
    const { data: currentImage, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', imageId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
      throw fetchError;
    }

    const currentMetadata = currentImage?.ai_scan_metadata || {};
    const modelName = metadata.model || 'gemini-1.5-flash';

    // Initialize extractions object if it doesn't exist
    if (!currentMetadata.extractions) {
      currentMetadata.extractions = {};
    }

    // Store extraction indexed by model name
    currentMetadata.extractions[modelName] = formatExtractionForStorage(extraction, metadata);

    // Update primary/latest extraction for backward compatibility
    currentMetadata.appraiser = currentMetadata.extractions[modelName];
    currentMetadata.context_extraction = currentMetadata.extractions[modelName].context_extraction;

    // Store list of models that have extracted this image
    if (!currentMetadata.extraction_models) {
      currentMetadata.extraction_models = [];
    }
    if (!currentMetadata.extraction_models.includes(modelName)) {
      currentMetadata.extraction_models.push(modelName);
    }

    // Update timestamp
    currentMetadata.last_extracted_at = new Date().toISOString();

    // Save to database
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        ai_scan_metadata: currentMetadata,
        ai_last_scanned: new Date().toISOString()
      })
      .eq('id', imageId);

    if (updateError) {
      throw updateError;
    }

    return true;
  } catch (error) {
    console.error(`   ❌ Save error: ${error.message}`);
    return false;
  }
}

// Extract data from a single image
async function extractImageData(imageUrl, imageId) {
  try {
    // Use direct HTTP fetch instead of supabase.functions.invoke for better error handling
    const functionUrl = `${SUPABASE_URL}/functions/v1/extract-image`;
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: `Extract vehicle image metadata. Return compact JSON:
{
  "angle":"exterior_front|exterior_rear|exterior_side|exterior_three_quarter|interior_front_seats|interior_rear_seats|interior_dashboard|interior_door|engine_bay|undercarriage|detail_shot|document|other",
  "environment":"garage|driveway|street|dealership|shop|outdoor_natural|staged_studio|other",
  "context":{
    "background_objects":["item1"],
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
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        status: response.status
      };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Unknown error from edge function' };
    }

    return {
      success: true,
      extracted_data: data.extracted_data,
      metadata: data.metadata
    };
  } catch (error) {
    return { success: false, error: error.message, errorStack: error.stack };
  }
}

// Process all images
async function processAllImages() {
  console.log('📸 Fetching all vehicle images...\n');

  // Get all images (excluding documents)
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, created_at')
    .eq('is_document', false)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching images:', error);
    process.exit(1);
  }

  if (!images || images.length === 0) {
    console.log('⚠️  No images found');
    process.exit(0);
  }

  console.log(`📊 Found ${images.length} images to process\n`);
  console.log(`⏱️  Estimated time: ${Math.ceil(images.length * DELAY_BETWEEN_IMAGES / 1000 / 60)} minutes\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  // Process in batches
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    
    console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(images.length / BATCH_SIZE)} (${batch.length} images)`);

    for (const image of batch) {
      processed++;
      const progress = `[${processed}/${images.length}]`;

      // Check if already extracted with current model
      const { data: currentImage } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('id', image.id)
        .single();

      const currentMetadata = currentImage?.ai_scan_metadata || {};
      const modelName = 'gemini-1.5-flash'; // Current model we're using
      
      // Skip if already extracted with this model (unless --force flag)
      if (currentMetadata.extractions?.[modelName] && !process.argv.includes('--force')) {
        console.log(`${progress} ⏭️  Skipped (already extracted with ${modelName}): ${image.id.substring(0, 8)}...`);
        skipped++;
        continue;
      }

      console.log(`${progress} 🔍 Extracting: ${image.id.substring(0, 8)}...`);

      const result = await extractImageData(image.image_url, image.id);

      if (!result.success) {
        const errorMsg = result.error || 'Unknown error';
        console.log(`   ❌ Failed: ${errorMsg}`);
        if (result.errorObj) {
          console.log(`   Details: ${JSON.stringify(result.errorObj).substring(0, 200)}`);
        }
        failed++;
        errors.push({ imageId: image.id, error: errorMsg, details: result });
        
        // If we're getting consistent errors, stop and investigate
        if (failed > 5 && successful === 0) {
          console.log('\n⚠️  Multiple consecutive failures detected. Stopping to investigate.');
          console.log('💡 Check edge function logs: supabase functions logs extract-image');
          break;
        }
        continue;
      }

      // Save to database
      const saved = await saveExtraction(
        image.id,
        result.extracted_data,
        result.metadata
      );

      if (saved) {
        console.log(`   ✅ Saved: ${result.extracted_data.angle || 'unknown'} (${result.metadata.model})`);
        successful++;
      } else {
        console.log(`   ❌ Save failed`);
        failed++;
      }

      // Rate limiting delay
      if (processed < images.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_IMAGES));
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 EXTRACTION SUMMARY\n');
  console.log(`✅ Successful: ${successful}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📸 Total processed: ${processed}`);
  console.log(`📸 Total images: ${images.length}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.slice(0, 10).forEach(({ imageId, error }) => {
      console.log(`   ${imageId.substring(0, 8)}...: ${error}`);
    });
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('\n💡 Extractions are indexed by model name in ai_scan_metadata.extractions');
  console.log('💡 Use --force to re-extract images that already have extractions');
}

// Run
processAllImages().catch(console.error);


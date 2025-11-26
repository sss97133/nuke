/**
 * Save extraction results from analyze-vehicle-profile-images to database
 * Updates ai_scan_metadata in vehicle_images table with extraction data
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const resultsFile = process.argv[2] || 'vehicle-analysis-e90512ed-9d9c-4467-932e-061fa871de83.json';

if (!fs.existsSync(resultsFile)) {
  console.error(`❌ Error: Results file not found: ${resultsFile}`);
  console.error('   Usage: node scripts/save-extraction-results-to-db.js [results_file.json]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Map our extraction format to the UI's expected format
function formatForUI(extracted, metadata) {
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

  // Build context description from extracted data
  const contextParts = [];
  if (extracted.environment) {
    contextParts.push(`Environment: ${extracted.environment}`);
  }
  if (extracted.context?.surrounding_area) {
    contextParts.push(extracted.context.surrounding_area);
  }
  if (extracted.presentation?.photo_quality) {
    contextParts.push(`Photo quality: ${extracted.presentation.photo_quality}`);
  }
  if (extracted.care_assessment?.care_level) {
    contextParts.push(`Care level: ${extracted.care_assessment.care_level}`);
  }
  if (extracted.seller_psychology?.intent) {
    contextParts.push(`Intent: ${extracted.seller_psychology.intent}`);
  }

  // Build description
  const descriptionParts = [];
  if (extracted.angle) {
    descriptionParts.push(`Angle: ${angleLabels[extracted.angle] || extracted.angle}`);
  }
  if (extracted.context?.background_objects?.length > 0) {
    descriptionParts.push(`Background: ${extracted.context.background_objects.slice(0, 3).join(', ')}`);
  }
  if (extracted.context?.time_of_day) {
    descriptionParts.push(`Time: ${extracted.context.time_of_day}`);
  }
  if (extracted.presentation?.is_positioned !== undefined) {
    descriptionParts.push(`Positioned: ${extracted.presentation.is_positioned ? 'Yes' : 'No'}`);
  }
  if (extracted.care_assessment?.owner_cares !== undefined) {
    descriptionParts.push(`Owner cares: ${extracted.care_assessment.owner_cares ? 'Yes' : 'No'}`);
  }

  return {
    appraiser: {
      angle: extracted.angle || null,
      primary_label: angleLabels[extracted.angle] || extracted.angle || 'Unknown',
      description: descriptionParts.join(' • ') || 'No description available',
      context: contextParts.join(' | ') || 'No context available',
      model: metadata.model || 'gemini-2.0-flash',
      analyzed_at: new Date().toISOString(),
      // Store full extraction data for future use
      extraction_data: extracted,
      metadata: {
        tokens: metadata.tokens,
        cost: metadata.cost,
        efficiency: metadata.efficiency
      }
    },
    // Store our context-aware extraction data
    context_extraction: {
      angle: extracted.angle,
      environment: extracted.environment,
      context: extracted.context,
      presentation: extracted.presentation,
      care_assessment: extracted.care_assessment,
      seller_psychology: extracted.seller_psychology,
      extracted_at: new Date().toISOString(),
      model: metadata.model
    }
  };
}

async function saveResults() {
  console.log(`📥 Loading results from: ${resultsFile}\n`);

  const resultsData = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  
  console.log(`📊 Found ${resultsData.results.length} results to save`);
  console.log(`🚗 Vehicle: ${resultsData.results.length} images\n`);

  const successful = resultsData.results.filter(r => r.success);
  console.log(`✅ ${successful.length} successful extractions to save\n`);

  let saved = 0;
  let failed = 0;

  for (const result of successful) {
    if (!result.imageId) {
      console.log(`⚠️  Skipping result without imageId`);
      continue;
    }

    try {
      const formattedData = formatForUI(result.extracted_data, result.metadata);

      // Also try to update angle classification table if it exists
      // This ensures compatibility with existing UI code
      try {
        const { error: angleError } = await supabase
          .from('ai_angle_classifications_audit')
          .upsert({
            image_id: result.imageId,
            primary_label: formattedData.appraiser.primary_label,
            angle: formattedData.appraiser.angle,
            confidence: 95, // High confidence from Gemini
            model: formattedData.appraiser.model,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'image_id'
          });
        
        if (angleError && !angleError.message.includes('does not exist')) {
          console.log(`   ⚠️  Could not update angle table (may not exist): ${angleError.message}`);
        }
      } catch (e) {
        // Table might not exist - that's ok
      }

      const { error } = await supabase
        .from('vehicle_images')
        .update({
          ai_scan_metadata: formattedData,
          ai_last_scanned: new Date().toISOString()
        })
        .eq('id', result.imageId);

      if (error) {
        console.error(`❌ Failed to save image ${result.imageId}: ${error.message}`);
        failed++;
      } else {
        console.log(`✅ Saved: ${result.extracted_data.angle} - ${result.imageId.substring(0, 8)}...`);
        saved++;
        
        // Emit event to trigger UI refresh (if frontend is open)
        // Note: This only works if the script runs in the browser context
        // For server-side scripts, Supabase realtime will handle the update automatically
      }
    } catch (err) {
      console.error(`❌ Error processing image ${result.imageId}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 SAVE SUMMARY\n');
  console.log(`✅ Saved: ${saved}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📸 Total: ${successful.length}`);
  console.log('\n💡 The extracted data is now visible in the image viewer!');
}

saveResults().catch(console.error);


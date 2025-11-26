/**
 * Compare Extractions from Different Models
 * Shows differences between extractions from different AI models
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const imageId = process.argv[2];
const model1 = process.argv[3] || 'gemini-1.5-flash';
const model2 = process.argv[4] || 'gemini-2.0-flash';

if (!imageId) {
  console.error('❌ Error: image_id is required');
  console.error('   Usage: node scripts/compare-extractions.js <image_id> [model1] [model2]');
  console.error('   Example: node scripts/compare-extractions.js abc123 gemini-1.5-flash gemini-2.0-flash');
  process.exit(1);
}

async function compareExtractions() {
  console.log(`🔍 Comparing extractions for image: ${imageId}\n`);
  console.log(`   Model 1: ${model1}`);
  console.log(`   Model 2: ${model2}\n`);

  const { data: image, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('id', imageId)
    .single();

  if (error) {
    console.error('❌ Error fetching image:', error.message);
    process.exit(1);
  }

  if (!image) {
    console.error('❌ Image not found');
    process.exit(1);
  }

  const metadata = image.ai_scan_metadata || {};
  const extractions = metadata.extractions || {};

  const ext1 = extractions[model1];
  const ext2 = extractions[model2];

  if (!ext1) {
    console.error(`❌ No extraction found for model: ${model1}`);
    process.exit(1);
  }

  if (!ext2) {
    console.error(`❌ No extraction found for model: ${model2}`);
    console.error(`\n💡 Available models: ${metadata.extraction_models?.join(', ') || 'none'}`);
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('📊 COMPARISON RESULTS\n');

  // Compare angle
  console.log('🎯 ANGLE:');
  console.log(`   ${model1}: ${ext1.angle || 'N/A'} (${ext1.primary_label || 'N/A'})`);
  console.log(`   ${model2}: ${ext2.angle || 'N/A'} (${ext2.primary_label || 'N/A'})`);
  if (ext1.angle !== ext2.angle) {
    console.log(`   ⚠️  DIFFERENT`);
  } else {
    console.log(`   ✅ MATCH`);
  }
  console.log('');

  // Compare environment
  console.log('🌍 ENVIRONMENT:');
  const env1 = ext1.context_extraction?.environment || ext1.extraction_data?.environment;
  const env2 = ext2.context_extraction?.environment || ext2.extraction_data?.environment;
  console.log(`   ${model1}: ${env1 || 'N/A'}`);
  console.log(`   ${model2}: ${env2 || 'N/A'}`);
  if (env1 !== env2) {
    console.log(`   ⚠️  DIFFERENT`);
  } else {
    console.log(`   ✅ MATCH`);
  }
  console.log('');

  // Compare care level
  console.log('💚 CARE LEVEL:');
  const care1 = ext1.context_extraction?.care_assessment?.care_level || ext1.extraction_data?.care_assessment?.care_level;
  const care2 = ext2.context_extraction?.care_assessment?.care_level || ext2.extraction_data?.care_assessment?.care_level;
  console.log(`   ${model1}: ${care1 || 'N/A'}`);
  console.log(`   ${model2}: ${care2 || 'N/A'}`);
  if (care1 !== care2) {
    console.log(`   ⚠️  DIFFERENT`);
  } else {
    console.log(`   ✅ MATCH`);
  }
  console.log('');

  // Compare seller intent
  console.log('🧠 SELLER INTENT:');
  const intent1 = ext1.context_extraction?.seller_psychology?.intent || ext1.extraction_data?.seller_psychology?.intent;
  const intent2 = ext2.context_extraction?.seller_psychology?.intent || ext2.extraction_data?.seller_psychology?.intent;
  console.log(`   ${model1}: ${intent1 || 'N/A'}`);
  console.log(`   ${model2}: ${intent2 || 'N/A'}`);
  if (intent1 !== intent2) {
    console.log(`   ⚠️  DIFFERENT`);
  } else {
    console.log(`   ✅ MATCH`);
  }
  console.log('');

  // Compare tokens/cost
  console.log('💰 COST & EFFICIENCY:');
  const tokens1 = ext1.metadata?.tokens?.total || 0;
  const tokens2 = ext2.metadata?.tokens?.total || 0;
  const cost1 = ext1.metadata?.cost?.total_cost || 0;
  const cost2 = ext2.metadata?.cost?.total_cost || 0;
  console.log(`   ${model1}: ${tokens1} tokens, $${cost1.toFixed(6)}`);
  console.log(`   ${model2}: ${tokens2} tokens, $${cost2.toFixed(6)}`);
  if (tokens1 !== tokens2) {
    const diff = ((tokens2 - tokens1) / tokens1 * 100).toFixed(1);
    console.log(`   📊 Token difference: ${diff > 0 ? '+' : ''}${diff}%`);
  }
  console.log('');

  // Full extraction data comparison
  console.log('📋 FULL EXTRACTION DATA:');
  console.log(`\n${model1}:`);
  console.log(JSON.stringify(ext1.extraction_data || ext1.context_extraction, null, 2));
  console.log(`\n${model2}:`);
  console.log(JSON.stringify(ext2.extraction_data || ext2.context_extraction, null, 2));
}

compareExtractions().catch(console.error);


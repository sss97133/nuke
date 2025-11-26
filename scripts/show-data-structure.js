/**
 * Show how extraction data is structured in the backend
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

async function showStructure() {
  console.log('📊 EXTRACTION DATA STRUCTURE IN BACKEND\n');
  console.log('='.repeat(80));
  
  // Get a sample image with extraction data
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata, ai_last_scanned')
    .eq('vehicle_id', 'e90512ed-9d9c-4467-932e-061fa871de83')
    .not('ai_scan_metadata', 'is', null)
    .limit(1)
    .single();

  if (error || !images) {
    console.error('❌ Error:', error?.message);
    return;
  }

  console.log('\n📍 DATABASE TABLE: vehicle_images');
  console.log('\n📋 COLUMN: ai_scan_metadata (JSONB)');
  console.log('\n💾 FULL STRUCTURE:\n');
  console.log(JSON.stringify(images.ai_scan_metadata, null, 2));
  
  console.log('\n' + '='.repeat(80));
  console.log('\n📐 STRUCTURE BREAKDOWN:\n');
  
  const metadata = images.ai_scan_metadata;
  
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ ai_scan_metadata (JSONB column)                             │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log('│                                                             │');
  console.log('│ {                                                           │');
  
  if (metadata.appraiser) {
    console.log('│   "appraiser": {                                           │');
    console.log('│     "angle": string,                                       │');
    console.log('│     "primary_label": string,                               │');
    console.log('│     "description": string,                                 │');
    console.log('│     "context": string,                                     │');
    console.log('│     "model": string,                                       │');
    console.log('│     "analyzed_at": ISO8601 timestamp,                      │');
    console.log('│     "extraction_data": { ... },                            │');
    console.log('│     "metadata": { tokens, cost, efficiency }               │');
    console.log('│   },                                                       │');
  }
  
  if (metadata.context_extraction) {
    console.log('│   "context_extraction": {                                  │');
    console.log('│     "angle": string,                                       │');
    console.log('│     "environment": string,                                 │');
    console.log('│     "context": {                                           │');
    console.log('│       "background_objects": string[],                      │');
    console.log('│       "surrounding_area": string,                          │');
    console.log('│       "time_of_day": string,                               │');
    console.log('│       "weather_visible": boolean,                          │');
    console.log('│       "other_vehicles_visible": boolean                    │');
    console.log('│     },                                                     │');
    console.log('│     "presentation": {                                      │');
    console.log('│       "is_positioned": boolean,                            │');
    console.log('│       "is_natural": boolean,                               │');
    console.log('│       "staging_indicators": string[],                      │');
    console.log('│       "photo_quality": string                              │');
    console.log('│     },                                                     │');
    console.log('│     "care_assessment": {                                   │');
    console.log('│       "owner_cares": boolean,                              │');
    console.log('│       "evidence": string[],                                │');
    console.log('│       "condition_indicators": string[],                    │');
    console.log('│       "care_level": "high" | "medium" | "low" | "unknown" │');
    console.log('│     },                                                     │');
    console.log('│     "seller_psychology": {                                 │');
    console.log('│       "is_staged": boolean,                                │');
    console.log('│       "intent": string,                                    │');
    console.log('│       "confidence_indicators": string[],                   │');
    console.log('│       "transparency_level": string                         │');
    console.log('│     },                                                     │');
    console.log('│     "extracted_at": ISO8601 timestamp,                     │');
    console.log('│     "model": string                                        │');
    console.log('│   }                                                        │');
  }
  
  console.log('│ }                                                           │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  
  console.log('\n' + '='.repeat(80));
  console.log('\n🔍 HOW TO QUERY THIS DATA:\n');
  
  console.log('-- Get angle for an image:');
  console.log('SELECT ai_scan_metadata->>\'appraiser\'->>\'angle\' as angle');
  console.log('FROM vehicle_images WHERE id = ?;\n');
  
  console.log('-- Get care assessment:');
  console.log('SELECT ai_scan_metadata->>\'context_extraction\'->\'care_assessment\'->>\'care_level\' as care_level');
  console.log('FROM vehicle_images WHERE id = ?;\n');
  
  console.log('-- Find all images with low care level:');
  console.log('SELECT id, image_url');
  console.log('FROM vehicle_images');
  console.log('WHERE ai_scan_metadata->>\'context_extraction\'->\'care_assessment\'->>\'care_level\' = \'low\';\n');
  
  console.log('-- Get all angles for a vehicle:');
  console.log('SELECT id, ai_scan_metadata->>\'appraiser\'->>\'primary_label\' as angle');
  console.log('FROM vehicle_images');
  console.log('WHERE vehicle_id = ? AND ai_scan_metadata->>\'appraiser\' IS NOT NULL;\n');
  
  console.log('='.repeat(80));
  console.log('\n📊 ACTUAL EXAMPLE DATA:\n');
  
  if (metadata.context_extraction) {
    const ext = metadata.context_extraction;
    console.log(`Angle: ${ext.angle || 'N/A'}`);
    console.log(`Environment: ${ext.environment || 'N/A'}`);
    console.log(`Care Level: ${ext.care_assessment?.care_level || 'N/A'}`);
    console.log(`Owner Cares: ${ext.care_assessment?.owner_cares || 'N/A'}`);
    console.log(`Staged: ${ext.seller_psychology?.is_staged || 'N/A'}`);
    console.log(`Intent: ${ext.seller_psychology?.intent || 'N/A'}`);
  }
  
  console.log('\n' + '='.repeat(80));
}

showStructure().catch(console.error);


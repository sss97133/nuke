#!/usr/bin/env node
/**
 * BULLETPROOF SPID SCANNER
 * Scans all interior images for a vehicle to find SPID sheets
 * Uses cascading API fallback (OpenAI → Anthropic → Google)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scanVehicleForSPID(vehicleId) {
  console.log(`\n🔍 Scanning vehicle ${vehicleId} for SPID sheets...\n`);

  // Get all interior images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, category, ai_scan_metadata')
    .eq('vehicle_id', vehicleId)
    .eq('category', 'interior')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return;
  }

  console.log(`📸 Found ${images.length} interior images to scan\n`);

  let spidFound = false;
  let scannedCount = 0;

  for (const image of images) {
    scannedCount++;
    console.log(`[${scannedCount}/${images.length}] Scanning image ${image.id.substring(0, 8)}...`);

    try {
      // Call detect-spid-sheet edge function
      const { data: spidResult, error: spidError } = await supabase.functions.invoke('detect-spid-sheet', {
        body: {
          imageId: image.id,
          imageUrl: image.image_url
        }
      });

      if (spidError) {
        console.log(`  ⚠️  Error: ${spidError.message}`);
        continue;
      }

      if (spidResult?.is_spid_sheet && spidResult.confidence >= 70) {
        console.log(`  ✅ SPID SHEET FOUND! Confidence: ${spidResult.confidence}%`);
        console.log(`  📋 Provider: ${spidResult.provider || 'unknown'}`);
        console.log(`  📊 Data extracted:`);
        console.log(`     VIN: ${spidResult.extracted_data.vin || 'N/A'}`);
        console.log(`     Model Code: ${spidResult.extracted_data.model_code || 'N/A'}`);
        console.log(`     Paint Code: ${spidResult.extracted_data.paint_code_exterior || 'N/A'}`);
        console.log(`     RPO Codes: ${spidResult.extracted_data.rpo_codes?.join(', ') || 'N/A'}`);
        console.log(`     Engine: ${spidResult.extracted_data.engine_code || 'N/A'}`);
        console.log(`     Transmission: ${spidResult.extracted_data.transmission_code || 'N/A'}`);
        
        spidFound = true;

        // Process with forensic system
        console.log(`\n  🔬 Processing SPID data forensically...`);
        
        const { error: forensicError } = await supabase.rpc('process_spid_data_forensically', {
          p_vehicle_id: vehicleId,
          p_spid_data: spidResult.extracted_data,
          p_image_id: image.id,
          p_extraction_confidence: spidResult.confidence
        });

        if (forensicError) {
          console.log(`  ⚠️  Forensic processing error: ${forensicError.message}`);
        } else {
          console.log(`  ✅ Evidence collected and stored`);
        }

        // Don't scan more images once SPID is found
        break;
      } else {
        console.log(`  ⏭️  Not a SPID sheet (confidence: ${spidResult?.confidence || 0}%)`);
      }

    } catch (err) {
      console.log(`  ❌ Scan failed: ${err.message}`);
    }

    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!spidFound) {
    console.log(`\n⚠️  No SPID sheet found in ${scannedCount} interior images`);
  } else {
    console.log(`\n✅ SPID sheet extraction complete!`);
    
    // Show updated audit report
    console.log(`\n📊 Updated Audit Report:\n`);
    const { data: audit } = await supabase
      .from('data_truth_audit_report')
      .select('vehicle_identity, completeness_pct, evidence_count, has_vin_decode')
      .eq('vehicle_id', vehicleId)
      .single();

    if (audit) {
      console.log(`   Identity: ${audit.vehicle_identity}`);
      console.log(`   Completeness: ${audit.completeness_pct}%`);
      console.log(`   Evidence Count: ${audit.evidence_count}`);
      console.log(`   VIN Decoded: ${audit.has_vin_decode ? 'YES' : 'NO'}`);
    }
  }
}

// Run scanner
const vehicleId = process.argv[2] || '80e04dd6-983e-4c78-ba15-c0599e50ecd9';
scanVehicleForSPID(vehicleId).catch(console.error);


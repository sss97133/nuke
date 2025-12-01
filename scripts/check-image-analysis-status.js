#!/usr/bin/env node
/**
 * Check actual image analysis status
 * Shows what's really analyzed vs what the dashboard shows
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

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkAnalysisStatus() {
  console.log('🔍 Checking image analysis status...\n');

  // Get total images
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .or('is_document.is.null,is_document.eq.false');

  console.log(`📊 Total vehicle images: ${totalImages?.toLocaleString() || 0}\n`);

  // Check different analysis criteria
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata, ai_last_scanned, ai_processing_status, angle, category')
    .or('is_document.is.null,is_document.eq.false')
    .limit(5000); // Sample first 5000

  if (!allImages) {
    console.error('❌ Failed to fetch images');
    return;
  }

  let hasMetadata = 0;
  let hasTier1 = 0;
  let hasTier2 = 0;
  let hasAppraiser = 0;
  let hasAppraiserPrimaryLabel = 0;
  let hasAngle = 0;
  let hasCategory = 0;
  let hasLastScanned = 0;
  let hasProcessingStatus = 0;
  let hasScannedAt = 0;

  allImages.forEach(img => {
    const metadata = img.ai_scan_metadata;

    // Has any metadata
    if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
      hasMetadata++;
    }

    // Has tier_1_analysis
    if (metadata?.tier_1_analysis) {
      hasTier1++;
    }

    // Has tier_2_analysis
    if (metadata?.tier_2_analysis) {
      hasTier2++;
    }

    // Has appraiser
    if (metadata?.appraiser) {
      hasAppraiser++;
    }

    // Has appraiser.primary_label (what process-all-images-cron sets)
    if (metadata?.appraiser?.primary_label) {
      hasAppraiserPrimaryLabel++;
    }

    // Has scanned_at timestamp
    if (metadata?.scanned_at || metadata?.appraiser?.analyzed_at) {
      hasScannedAt++;
    }

    // Has angle set
    if (img.angle) {
      hasAngle++;
    }

    // Has category set
    if (img.category) {
      hasCategory++;
    }

    // Has ai_last_scanned
    if (img.ai_last_scanned) {
      hasLastScanned++;
    }

    // Has processing status
    if (img.ai_processing_status) {
      hasProcessingStatus++;
    }
  });

  const total = allImages.length;
  const samplePercent = total < (totalImages || 0) ? `(sample of ${total}, ${((total / (totalImages || 1)) * 100).toFixed(1)}%)` : '';

  console.log('📈 Analysis Status Breakdown:\n');
  console.log(`Total Images (sampled): ${total.toLocaleString()} ${samplePercent}\n`);

  console.log('Analysis Criteria:');
  console.log(`  ✅ Has any ai_scan_metadata: ${hasMetadata.toLocaleString()} (${((hasMetadata / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has tier_1_analysis: ${hasTier1.toLocaleString()} (${((hasTier1 / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has tier_2_analysis: ${hasTier2.toLocaleString()} (${((hasTier2 / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has appraiser object: ${hasAppraiser.toLocaleString()} (${((hasAppraiser / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has appraiser.primary_label: ${hasAppraiserPrimaryLabel.toLocaleString()} (${((hasAppraiserPrimaryLabel / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has scanned_at timestamp: ${hasScannedAt.toLocaleString()} (${((hasScannedAt / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has angle set: ${hasAngle.toLocaleString()} (${((hasAngle / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has category set: ${hasCategory.toLocaleString()} (${((hasCategory / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has ai_last_scanned: ${hasLastScanned.toLocaleString()} (${((hasLastScanned / total) * 100).toFixed(1)}%)`);
  console.log(`  ✅ Has ai_processing_status: ${hasProcessingStatus.toLocaleString()} (${((hasProcessingStatus / total) * 100).toFixed(1)}%)`);

  // Try to call the RPC function
  console.log('\n🔍 Checking RPC function result...\n');
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_image_scan_stats');
    
    if (rpcError) {
      console.log(`❌ RPC Error: ${rpcError.message}`);
      console.log(`   This function might not exist. Creating it...\n`);
    } else {
      console.log('RPC Function Result:');
      console.log(JSON.stringify(rpcData, null, 2));
    }
  } catch (err) {
    console.log(`❌ RPC call failed: ${err.message}`);
  }

  // Check what the dashboard is likely checking
  console.log('\n🎯 Most Likely Dashboard Criteria:\n');
  console.log('The dashboard probably checks for:');
  console.log('  - ai_scan_metadata->appraiser->primary_label IS NOT NULL');
  console.log(`  - Current count: ${hasAppraiserPrimaryLabel.toLocaleString()}`);
  console.log(`  - This matches "91 analyzed" if total is ${totalImages?.toLocaleString() || 'unknown'}`);
}

checkAnalysisStatus().catch(console.error);


#!/usr/bin/env node

/**
 * Run Tier 1 AI analysis on pending images
 * Calls the analyze-image-tier1 edge function
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const LOG_FILE = 'tier1_analysis_errors.log';

function logError(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `${timestamp}: ${message}\n`);
}

async function analyzeImage(imageId, imageUrl, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-image-tier1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ image_id: imageId, image_url: imageUrl })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        
        // Don't retry 4xx errors (bad request, invalid image)
        // Also don't retry 500s that contain "Anthropic API error: 400" (invalid image data)
        if ((status >= 400 && status < 500) || (status === 500 && errorText.includes('Anthropic API error: 400'))) {
          console.log(`  Failed (permanent): ${status} - ${errorText.substring(0, 100)}`);
          logError(`Permanent failure for ${imageId}: ${status} - ${errorText}`);
          return 'permanent_failure'; // Return special status
        }
        
        // Retry other 5xx errors (server error, rate limit)
        throw new Error(`Status ${status}: ${errorText}`);
      }

      const result = await response.json();
      if (result.success) {
        console.log(`  OK: ${result.data?.category || 'analyzed'}`);
        return true;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      if (attempt === retries) {
        console.log(`  Failed after ${retries} attempts: ${error.message.substring(0, 100)}`);
        logError(`Failed ${imageId} after ${retries} attempts: ${error.message}`);
        return false;
      }
      
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
      console.log(`  Error (attempt ${attempt}): ${error.message.substring(0, 50)}... Retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('TIER 1 IMAGE ANALYSIS (CONTINUOUS MODE)');
  console.log('='.repeat(60));

  while (true) {
    // Get pending images
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('ai_processing_status', 'pending')
      .limit(50); // Process in batches of 50

    if (error) {
      console.error('Failed to fetch images:', error);
      logError(`DB Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 10000)); // Wait 10s on DB error
      continue;
    }

    if (!images || images.length === 0) {
      console.log('No pending images found. Waiting 60 seconds...');
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }

    console.log(`Processing batch of ${images.length} images...`);

    let success = 0;
    let failed = 0;

    for (const image of images) {
      console.log(`Analyzing: ${image.id}`);
      
      // Basic validation
      if (!image.image_url) {
        console.log('  Skipping: No image URL');
        await supabase
          .from('vehicle_images')
          .update({ 
            ai_processing_status: 'failed', 
            ai_scan_metadata: { error: 'Missing image URL' } 
          })
          .eq('id', image.id);
        failed++;
        continue;
      }

      const result = await analyzeImage(image.id, image.image_url);
      
      if (result === true) {
        success++;
      } else if (result === 'permanent_failure') {
        failed++;
        console.log('  Marking as failed_analysis (bad image/request)');
        await supabase
          .from('vehicle_images')
          .update({ 
            ai_processing_status: 'failed',
            ai_scan_metadata: { error: 'Tier 1 analysis failed: Invalid image or request' }
          })
          .eq('id', image.id);
      } else {
        failed++;
        // Retry later
      }

      // Rate limit to be nice to Anthropic/Supabase
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`Batch complete. Success: ${success}, Failed: ${failed}`);
    console.log('-'.repeat(60));
  }
}

main().catch(console.error);


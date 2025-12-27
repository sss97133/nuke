#!/usr/bin/env tsx
/**
 * Trickle Backfill Images
 * 
 * Backfills images for vehicles that have image URLs stored in origin_metadata
 * but no actual images in vehicle_images table.
 * 
 * Usage:
 *   npm run trickle-backfill-images
 *   npm run trickle-backfill-images -- --limit 500 --batch-size 20
 *   npm run trickle-backfill-images -- --organization-id <org-id>
 *   npm run trickle-backfill-images -- --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Options {
  batchSize?: number;
  limit?: number;
  organizationId?: string;
  maxImagesPerVehicle?: number;
  dryRun?: boolean;
}

async function trickleBackfillImages(options: Options = {}) {
  const {
    batchSize = 10,
    limit = 100,
    organizationId,
    maxImagesPerVehicle = 20,
    dryRun = false,
  } = options;

  console.log('🖼️  Trickle Backfill Images\n');
  console.log('Options:');
  console.log(`  - Batch size: ${batchSize}`);
  console.log(`  - Limit: ${limit}`);
  console.log(`  - Organization ID: ${organizationId || 'all'}`);
  console.log(`  - Max images per vehicle: ${maxImagesPerVehicle}`);
  console.log(`  - Dry run: ${dryRun ? 'YES' : 'NO'}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/trickle-backfill-images`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        batch_size: batchSize,
        limit,
        organization_id: organizationId,
        max_images_per_vehicle: maxImagesPerVehicle,
        dry_run: dryRun,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    console.log('✅ Trickle Backfill Complete!\n');
    console.log('Summary:');
    console.log(`  - Processed: ${result.processed}`);
    console.log(`  - Successful: ${result.successful}`);
    console.log(`  - Failed: ${result.failed}`);
    console.log(`  - Total images inserted: ${result.total_images_inserted}\n`);

    if (result.results && result.results.length > 0) {
      console.log('Results (first 10):');
      result.results.slice(0, 10).forEach((r: any, idx: number) => {
        const status = r.status === 'success' ? '✅' : r.status === 'dry_run' ? '🔍' : '❌';
        console.log(`  ${status} ${r.vehicle_name || r.vehicle_id}`);
        if (r.status === 'success') {
          console.log(`     Images: ${r.images_inserted || 0}/${r.image_urls_count || 0}`);
        }
      });
      if (result.results.length > 10) {
        console.log(`  ... and ${result.results.length - 10} more\n`);
      } else {
        console.log('');
      }
    }

    return result;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Options = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--batch-size' && args[i + 1]) {
    options.batchSize = parseInt(args[++i], 10);
  } else if (arg === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[++i], 10);
  } else if (arg === '--organization-id' && args[i + 1]) {
    options.organizationId = args[++i];
  } else if (arg === '--max-images' && args[i + 1]) {
    options.maxImagesPerVehicle = parseInt(args[++i], 10);
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
}

trickleBackfillImages(options).catch(console.error);


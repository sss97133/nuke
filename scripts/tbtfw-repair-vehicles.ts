#!/usr/bin/env tsx
/**
 * Re-process TBTFW vehicles to extract missing prices and VINs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function repairVehicles() {
  console.log('🔍 Finding TBTFW vehicles missing prices or VINs...\n');

  // Find TBTFW vehicles missing prices or VINs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, listing_url, vin, asking_price, year, make, model')
    .or('platform_source.eq.TBTFW,listing_source.eq.tbtfw.com')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No TBTFW vehicles found.');
    return;
  }

  const missingPrice = vehicles.filter(v => !v.asking_price);
  const missingVin = vehicles.filter(v => !v.vin);

  console.log(`📊 Total TBTFW vehicles: ${vehicles.length}`);
  console.log(`   Missing price: ${missingPrice.length}`);
  console.log(`   Missing VIN: ${missingVin.length}\n`);

  if (missingPrice.length === 0 && missingVin.length === 0) {
    console.log('✅ All vehicles have prices and VINs!');
    return;
  }

  // Invoke the repair function for each vehicle
  const repairUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/tbtfw-process-queue`;
  const sourceId = '56b9ad6b-80e1-4adb-8be2-2c2e36cb2374';
  const orgId = 'abe35956-b6bd-431a-8723-8c4e1bfbf69e';

  // Get the invoke key from Supabase
  const invokeKey = SUPABASE_SERVICE_ROLE_KEY;

  const toRepair = Array.from(new Set([
    ...missingPrice.map(v => v.listing_url),
    ...missingVin.map(v => v.listing_url),
  ])).filter(Boolean);

  console.log(`🔄 Re-processing ${toRepair.length} vehicles...\n`);

  // Update existing items to pending status, or insert new ones
  for (const url of toRepair) {
    const { data: existing } = await supabase
      .from('import_queue')
      .select('id')
      .eq('listing_url', url)
      .maybeSingle();

    if (existing) {
      // Update existing item to pending
      await supabase
        .from('import_queue')
        .update({
          status: 'pending',
          priority: 10,
          error_message: null,
          locked_at: null,
          locked_by: null,
          raw_data: { repair: true, repaired_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Insert new item
      await supabase
        .from('import_queue')
        .insert({
          source_id: sourceId,
          listing_url: url,
          listing_year: null,
          listing_make: null,
          listing_model: null,
          listing_title: null,
          thumbnail_url: null,
          status: 'pending',
          priority: 10,
          raw_data: { repair: true, repaired_at: new Date().toISOString() },
        });
    }
  }

  console.log(`✅ Queued ${toRepair.length} items for re-processing\n`);

  // Now process them in batches
  console.log('🚀 Processing queue...\n');
  for (let i = 0; i < 5; i++) {
    const response = await fetch(repairUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${invokeKey}`,
      },
      body: JSON.stringify({
        source_id: sourceId,
        organization_id: orgId,
        batch_size: 10,
        max_images: 50,
        max_age_minutes: 60,
      }),
    });

    const result = await response.json();
    console.log(`Batch ${i + 1}:`, {
      picked: result.picked,
      completed: result.completed,
      failed: result.failed,
    });

    if (result.picked === 0) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n✅ Done!');
}

repairVehicles().catch(console.error);


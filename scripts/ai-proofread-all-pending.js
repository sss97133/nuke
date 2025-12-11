#!/usr/bin/env node

/**
 * AI Proofreader for All Pending Vehicles
 * 
 * Processes ALL pending vehicles through the AI proofreader to:
 * - Backfill missing data (VIN, description, mileage, price, etc.)
 * - Improve data quality
 * - Extract additional information from discovery URLs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function proofreadBatch(batchSize, offset = 0) {
  console.log(`\n📋 Processing batch: ${batchSize} vehicles starting from ${offset}...`);

  // Get pending vehicles
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, status')
    .eq('status', 'pending')
    .is('is_public', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + batchSize - 1);

  if (fetchError) {
    console.error('❌ Failed to fetch vehicles:', fetchError.message);
    return { processed: 0, updated: 0, failed: 0 };
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No more pending vehicles to process');
    return { processed: 0, updated: 0, failed: 0 };
  }

  console.log(`Found ${vehicles.length} vehicles to proofread`);

  // Process through AI proofreader
  const vehicleIds = vehicles.map(v => v.id);
  
  try {
    const { data: result, error: invokeError } = await supabase.functions.invoke('ai-proofread-pending', {
      body: {
        vehicle_ids: vehicleIds,
        batch_size: batchSize
      },
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });

    if (invokeError) {
      console.error('❌ AI proofreader error:', invokeError.message);
      console.error('❌ Full error:', JSON.stringify(invokeError, null, 2));
      // Try to get more details
      if (invokeError.message?.includes('non-2xx')) {
        console.error('💡 Tip: Check Edge Function logs for ai-proofread-pending - might be missing OPENAI_API_KEY');
      }
      return { processed: vehicles.length, updated: 0, failed: vehicles.length };
    }

    if (!result || !result.success) {
      console.error('❌ AI proofreader returned error:', result?.error || 'Unknown error');
      return { processed: vehicles.length, updated: 0, failed: vehicles.length };
    }

    console.log(`✅ Batch complete:`, {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      backfilled: result.backfilled,
      vehicles_updated: result.vehicles_updated?.length || 0
    });
    return {
      processed: result.processed || vehicles.length,
      updated: result.backfilled || result.succeeded || 0,
      failed: result.failed || 0
    };
  } catch (error) {
    console.error('❌ Exception calling AI proofreader:', error.message);
    console.error('❌ Stack:', error.stack);
    return { processed: vehicles.length, updated: 0, failed: vehicles.length };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 20;
  const maxVehicles = parseInt(process.argv[3]) || null; // null = process all

  console.log('🤖 AI Proofreader for All Pending Vehicles\n');
  console.log(`   Batch size: ${batchSize}`);
  if (maxVehicles) {
    console.log(`   Max vehicles: ${maxVehicles}`);
  } else {
    console.log(`   Processing ALL pending vehicles`);
  }

  // Get total count
  const { count: totalCount, error: countError } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('is_public', false);

  if (countError) {
    console.error('❌ Failed to get count:', countError.message);
    process.exit(1);
  }

  console.log(`\n📊 Total pending vehicles: ${totalCount}\n`);

  const totalToProcess = maxVehicles ? Math.min(maxVehicles, totalCount) : totalCount;
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  while (offset < totalToProcess) {
    const currentBatchSize = Math.min(batchSize, totalToProcess - offset);
    const result = await proofreadBatch(currentBatchSize, offset);
    
    totalProcessed += result.processed;
    totalUpdated += result.updated;
    totalFailed += result.failed;
    offset += currentBatchSize;

    console.log(`\n📈 Progress: ${offset}/${totalToProcess} (${((offset / totalToProcess) * 100).toFixed(1)}%)`);
    console.log(`   Total: ${totalProcessed} processed, ${totalUpdated} updated, ${totalFailed} failed`);

    // Delay between batches to avoid rate limits
    if (offset < totalToProcess) {
      console.log(`\n😴 Waiting 5 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log(`\n✅ AI Proofreading Complete!`);
  console.log(`   Total Processed: ${totalProcessed}`);
  console.log(`   Total Updated: ${totalUpdated}`);
  console.log(`   Total Failed: ${totalFailed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


#!/usr/bin/env node
/**
 * Batch re-extract BaT vehicles that are missing images
 * Processes in batches to avoid rate limits
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BATCH_SIZE = 5; // Process 5 at a time
const DELAY_MS = 3000; // 3 second delay between batches

async function extractVehicle(url) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        force_re_extract: true,
        download_images: true
      })
    });
    
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.substring(0, 200)}` };
    }
    
    const data = await response.json();
    return { 
      success: data.success || false, 
      images: data.images_extracted || 0,
      updated: data.vehicles_updated || 0
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Get list from command line or query database
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
  const startFrom = args.includes('--start') ? parseInt(args[args.indexOf('--start') + 1]) : 0;
  
  console.log('BaT Vehicle Re-Extraction Script');
  console.log('=====================================');
  
  // Read vehicles list from stdin or use sample
  let vehicles = [];
  
  // Check for --file argument
  const fileArgIdx = args.indexOf('--file');
  if (fileArgIdx !== -1 && args[fileArgIdx + 1]) {
    const filePath = args[fileArgIdx + 1];
    const fs = await import('fs');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      vehicles = JSON.parse(content);
      console.log(`Loaded ${vehicles.length} vehicles from ${filePath}`);
    } catch (e) {
      console.error(`Failed to load file ${filePath}: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Sample URLs for testing
    vehicles = [
      { discovery_url: 'https://bringatrailer.com/listing/2008-porsche-911-gt2-36/' },
      { discovery_url: 'https://bringatrailer.com/listing/2015-bmw-m4-convertible-14/' },
      { discovery_url: 'https://bringatrailer.com/listing/2004-subaru-forester-13/' }
    ];
    console.log('Using sample URLs for testing (use --file <path> for full list)...');
  }
  
  // Apply limits
  if (startFrom > 0) {
    vehicles = vehicles.slice(startFrom);
  }
  if (limit) {
    vehicles = vehicles.slice(0, limit);
  }
  
  console.log(`Processing ${vehicles.length} vehicles`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Delay: ${DELAY_MS}ms between batches\n`);
  
  let processed = 0;
  let successful = 0;
  let totalImages = 0;
  let errors = [];
  
  // Process in batches
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehicles.length / BATCH_SIZE);
    
    console.log(`\nBatch ${batchNum}/${totalBatches}`);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (v) => {
        const result = await extractVehicle(v.discovery_url);
        return { url: v.discovery_url, ...result };
      })
    );
    
    // Log results
    for (const r of results) {
      processed++;
      const shortUrl = r.url.replace('https://bringatrailer.com/listing/', '').slice(0, 40);
      
      if (r.success) {
        successful++;
        totalImages += r.images || 0;
        console.log(`  OK: ${shortUrl} - ${r.images || 0} images`);
      } else {
        console.log(`  FAIL: ${shortUrl} - ${r.error || 'unknown error'}`);
        errors.push({ url: r.url, error: r.error });
      }
    }
    
    // Progress update
    const pct = ((processed / vehicles.length) * 100).toFixed(1);
    console.log(`  Progress: ${processed}/${vehicles.length} (${pct}%) | Success: ${successful} | Images: ${totalImages}`);
    
    // Delay between batches
    if (i + BATCH_SIZE < vehicles.length) {
      await sleep(DELAY_MS);
    }
  }
  
  // Final summary
  console.log('\n=====================================');
  console.log('FINAL SUMMARY');
  console.log('=====================================');
  console.log(`Total processed: ${processed}`);
  console.log(`Successful: ${successful} (${((successful/processed)*100).toFixed(1)}%)`);
  console.log(`Failed: ${errors.length}`);
  console.log(`Total images extracted: ${totalImages}`);
  
  if (errors.length > 0 && errors.length <= 10) {
    console.log('\nFailed URLs:');
    errors.forEach(e => console.log(`  - ${e.url}: ${e.error}`));
  } else if (errors.length > 10) {
    console.log(`\n${errors.length} URLs failed (too many to list)`);
  }
}

main().catch(console.error);

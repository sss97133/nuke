/**
 * Backfill all C&B vehicles - call extraction function on each one
 *
 * Run with: npx tsx scripts/backfill-all-cab-vehicles.ts
 *
 * Progress is saved to backfill-cab-progress.json so you can resume if interrupted
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-cars-and-bids-core`;

const PROGRESS_FILE = 'backfill-cab-progress.json';
const DELAY_BETWEEN_REQUESTS = 5000; // 5 seconds between requests
const MAX_CONCURRENT = 1; // Sequential to avoid rate limits

interface Progress {
  completed: string[];
  failed: string[];
  lastProcessedAt: string;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch {
      // Ignore
    }
  }
  return { completed: [], failed: [], lastProcessedAt: '' };
}

function saveProgress(progress: Progress) {
  progress.lastProcessedAt = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function extractVehicle(vehicleId: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, vehicle_id: vehicleId }),
    });

    const result = await response.json();
    return result.success === true;
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  C&B BACKFILL - Extract all vehicles');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load progress
  const progress = loadProgress();
  const completedSet = new Set(progress.completed);
  const failedSet = new Set(progress.failed);

  console.log(`Previously completed: ${progress.completed.length}`);
  console.log(`Previously failed: ${progress.failed.length}`);

  // Get all C&B vehicles
  console.log('\nFetching C&B vehicles...');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url, year, make, model')
    .ilike('discovery_url', '%carsandbids%')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching vehicles:', error.message);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No C&B vehicles found');
    return;
  }

  console.log(`Total C&B vehicles: ${vehicles.length}`);

  // Filter to only those not yet processed
  const toProcess = vehicles.filter(v => !completedSet.has(v.id) && !failedSet.has(v.id));
  console.log(`Remaining to process: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log('All vehicles already processed!');
    return;
  }

  // Process each vehicle
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const vehicle = toProcess[i];
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = successCount > 0 ? (elapsed / successCount).toFixed(1) : '?';
    const remaining = toProcess.length - i;
    const eta = successCount > 0 ? Math.round((remaining * elapsed) / successCount / 60) : '?';

    console.log(`[${i + 1}/${toProcess.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`  URL: ${vehicle.discovery_url}`);
    console.log(`  Progress: ${successCount} done, ${failCount} failed | ${rate}s/vehicle | ETA: ${eta} min`);

    const success = await extractVehicle(vehicle.id, vehicle.discovery_url);

    if (success) {
      successCount++;
      progress.completed.push(vehicle.id);
      console.log('  ✅ Success\n');
    } else {
      failCount++;
      progress.failed.push(vehicle.id);
      console.log('  ❌ Failed\n');
    }

    // Save progress every vehicle
    saveProgress(progress);

    // Delay before next request
    if (i < toProcess.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }

  const totalElapsed = Math.round((Date.now() - startTime) / 1000 / 60);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total processed: ${successCount + failCount}`);
  console.log(`  Successful: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Time: ${totalElapsed} minutes`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

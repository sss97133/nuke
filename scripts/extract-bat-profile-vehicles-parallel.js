#!/usr/bin/env node

/**
 * Extract vehicles from all BaT user profiles - PARALLEL VERSION
 * 
 * This script spawns multiple worker processes to extract vehicles
 * from BaT profiles in parallel for maximum speed.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Configuration
const NUM_WORKERS = 10; // Spawn 10 parallel workers
const BATCH_SIZE = 50; // Each worker processes batches of 50

/**
 * Worker function - processes a chunk of usernames
 */
async function runWorker(workerId, usernames) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting worker ${workerId} with ${usernames.length} usernames...`);

    const scriptPath = join(__dirname, 'extract-all-bat-profile-vehicles-worker.js');
    
    // Create worker script that processes only the assigned usernames
    const workerScript = `
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const usernames = ${JSON.stringify(usernames)};
const workerId = ${workerId};

async function extractProfileVehicles(username) {
  try {
    const { data, error } = await supabase.functions.invoke('extract-bat-profile-vehicles', {
      body: { username, extract_vehicles: true },
    });
    if (error) throw error;
    return data;
  } catch (err) {
    return { error: err.message, username };
  }
}

async function main() {
  console.log(\`[Worker \${workerId}] Processing \${usernames.length} usernames...\`);
  
  const results = await Promise.all(usernames.map(async (username) => {
    const result = await extractProfileVehicles(username);
    if (result.error) {
      return { username, success: false, error: result.error };
    }
    const summary = {
      username,
      success: true,
      listings_found: result.listings_found || 0,
      vehicles_linked: result.vehicles_linked || 0,
      vehicles_created: result.vehicles_created || 0,
    };
    console.log(\`[Worker \${workerId}] \${username}: \${summary.listings_found} listings, \${summary.vehicles_linked} vehicles\`);
    return summary;
  }));

  const success = results.filter(r => r.success).length;
  const totalListings = results.reduce((sum, r) => sum + (r.listings_found || 0), 0);
  const totalVehicles = results.reduce((sum, r) => sum + (r.vehicles_linked || 0) + (r.vehicles_created || 0), 0);
  
  console.log(\`[Worker \${workerId}] ✓ Done: \${success}/\${usernames.length} success, \${totalListings} listings, \${totalVehicles} vehicles\`);
}

main().catch(console.error);
`;

    // Write worker script to temp file
    const fs = await import('fs');
    const tempScript = join(__dirname, `worker-${workerId}.mjs`);
    fs.writeFileSync(tempScript, workerScript);

    // Spawn worker process
    const worker = spawn('node', [tempScript], {
      stdio: 'inherit',
      shell: false,
    });

    worker.on('close', (code) => {
      // Clean up temp file
      fs.unlinkSync(tempScript).catch(() => {});
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worker ${workerId} exited with code ${code}`));
      }
    });

    worker.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting PARALLEL BaT profile vehicle extraction...\n');
  console.log(`📊 Spawning ${NUM_WORKERS} parallel workers\n`);

  // Fetch all BaT usernames
  console.log('📋 Fetching BaT usernames from database...');
  const { data: users, error } = await supabase
    .from('bat_users')
    .select('bat_username')
    .not('bat_username', 'is', null)
    .neq('bat_username', '')
    .neq('bat_username', 'account')
    .neq('bat_username', 'all')
    .order('bat_username');

  if (error) {
    console.error('❌ Error fetching usernames:', error);
    process.exit(1);
  }

  const usernames = [...new Set(users.map(u => u.bat_username))];
  console.log(`✓ Found ${usernames.length} unique BaT usernames\n`);

  // Split usernames into chunks for each worker
  const chunkSize = Math.ceil(usernames.length / NUM_WORKERS);
  const chunks = [];
  for (let i = 0; i < usernames.length; i += chunkSize) {
    chunks.push(usernames.slice(i, i + chunkSize));
  }

  console.log(`📦 Split into ${chunks.length} chunks:`);
  chunks.forEach((chunk, i) => {
    console.log(`  Worker ${i + 1}: ${chunk.length} usernames`);
  });
  console.log('');

  // Spawn all workers in parallel
  const startTime = Date.now();
  const workers = chunks.map((chunk, i) => runWorker(i + 1, chunk));

  try {
    await Promise.all(workers);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ All workers completed in ${duration} seconds!\n`);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);


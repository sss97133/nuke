#!/usr/bin/env node

/**
 * Simple parallel extraction - spawns multiple instances
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const NUM_WORKERS = 20; // Spawn 20 parallel workers!

async function main() {
  console.log(`🚀 Spawning ${NUM_WORKERS} parallel extraction workers...\n`);

  // Fetch all usernames
  const { data: users } = await supabase
    .from('bat_users')
    .select('bat_username')
    .not('bat_username', 'is', null)
    .neq('bat_username', '')
    .neq('bat_username', 'account')
    .neq('bat_username', 'all')
    .order('bat_username');

  const usernames = [...new Set(users.map(u => u.bat_username))];
  const chunkSize = Math.ceil(usernames.length / NUM_WORKERS);
  
  console.log(`📊 Processing ${usernames.length} usernames in ${NUM_WORKERS} parallel workers\n`);

  // Spawn workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const chunk = usernames.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;

    const workerScript = join(__dirname, 'extract-all-bat-profile-vehicles.js');
    const logFile = `/tmp/bat-worker-${i + 1}.log`;
    
    console.log(`  Starting worker ${i + 1} (${chunk.length} usernames) -> ${logFile}`);
    
    // Modify the script to only process this chunk by setting environment variable
    const worker = spawn('node', [workerScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WORKER_ID: String(i + 1),
        WORKER_CHUNK: JSON.stringify(chunk),
      },
    });

    worker.stdout.pipe(createWriteStream(logFile));
    worker.stderr.pipe(createWriteStream(logFile));
  }

  console.log(`\n✅ All ${NUM_WORKERS} workers started! Monitor logs in /tmp/bat-worker-*.log\n`);
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * Import Pending BaT Auctions - Direct SQL Approach
 * 
 * Uses SQL to fetch pending items (bypassing RLS issues) and processes them
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
function loadEnv() {
  const paths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

async function postJson(url: string, bearer: string, body: any): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const BATCH_SIZE = 100;
  const importBatListingUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-bat-listing`;
  
  console.log('Fetching pending BaT listings via SQL...');
  
  // Use REST API to execute SQL query (bypasses RLS)
  const sqlQuery = `
    SELECT 
      id,
      listing_url
    FROM import_queue
    WHERE status = 'pending'
      AND listing_url LIKE '%bringatrailer.com/listing/%'
      AND (attempts IS NULL OR attempts < COALESCE(max_attempts, 3))
    ORDER BY created_at DESC
    LIMIT ${BATCH_SIZE}
  `;
  
  const sqlUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;
  const sqlResp = await fetch(sqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ query: sqlQuery }),
  });
  
  // Actually, let's use the Supabase REST API properly
  // Just use the PostgREST endpoint directly
  const restUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/import_queue?status=eq.pending&listing_url=like.*bringatrailer.com/listing/*&select=id,listing_url&order=created_at.desc&limit=${BATCH_SIZE}`;
  
  const restResp = await fetch(restUrl, {
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
  });
  
  if (!restResp.ok) {
    const text = await restResp.text();
    throw new Error(`Failed to fetch pending items: ${restResp.status} ${text}`);
  }
  
  const pending = await restResp.json();
  
  if (!pending || pending.length === 0) {
    console.log('No pending listings found');
    return;
  }
  
  console.log(`Found ${pending.length} pending listings`);
  console.log('Starting import...\n');
  
  let ok = 0;
  let fail = 0;
  
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const url = item.listing_url;
    
    console.log(`[${i + 1}/${pending.length}] ${url}`);
    
    try {
      const r = await postJson(importBatListingUrl, SERVICE_ROLE_KEY, { 
        url, 
        skip_images: false 
      });
      
      if (!r?.success) {
        throw new Error(r?.error || 'Import failed');
      }
      
      // Mark queue item as complete using REST API
      const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/import_queue?id=eq.${item.id}`;
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          status: 'complete',
          vehicle_id: r.vehicleId || r.vehicle_id || null,
          processed_at: new Date().toISOString(),
        }),
      });
      
      ok++;
      console.log(`  ✓ Success (vehicle: ${r.vehicleId || r.vehicle_id})`);
      
    } catch (err: any) {
      fail++;
      console.log(`  ✗ Failed: ${err.message}`);
      
      // Mark as failed
      const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/import_queue?id=eq.${item.id}`;
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          status: 'failed',
          error_message: err.message,
          processed_at: new Date().toISOString(),
        }),
      });
    }
    
    // Rate limit
    await sleep(500);
    
    // Progress report
    if ((i + 1) % 10 === 0) {
      console.log(`\n=== Progress: ${ok} ok, ${fail} failed ===\n`);
    }
  }
  
  console.log('\n=== COMPLETE ===');
  console.log(`Total: ${pending.length}`);
  console.log(`Success: ${ok}`);
  console.log(`Failed: ${fail}`);
}

main().catch(console.error);


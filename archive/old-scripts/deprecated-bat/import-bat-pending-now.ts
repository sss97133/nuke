#!/usr/bin/env node
/**
 * Import Pending BaT Auctions NOW
 * 
 * Processes all pending BaT listings from import_queue using import-bat-listing Edge Function.
 * This creates proper external_listings with active status for the marketplace.
 */

import { createClient } from '@supabase/supabase-js';
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const SOURCE_ID = 'db9ff20a-15b6-41f1-ae09-dd31975a77c0';
  const BATCH_SIZE = 100;
  
  console.log('Fetching pending BaT listings from import_queue...');
  
  // Get pending listings
  const { data: pending, error } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .eq('source_id', SOURCE_ID)
    .eq('status', 'pending')
    .like('listing_url', '%bringatrailer.com/listing/%')
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE);
  
  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }
  
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
      // Call import-bat-listing Edge Function
      const { data, error: invokeError } = await supabase.functions.invoke('import-bat-listing', {
        body: { url, skip_images: false }
      });
      
      if (invokeError) {
        throw new Error(invokeError.message || 'Function invocation failed');
      }
      
      if (!data || !data.success) {
        throw new Error(data?.error || 'Import failed');
      }
      
      // Mark queue item as complete
      await supabase
        .from('import_queue')
        .update({
          status: 'complete',
          vehicle_id: data.vehicleId || data.vehicle_id || null,
          processed_at: new Date().toISOString()
        })
        .eq('id', item.id);
      
      ok++;
      console.log(`  ✓ Success (vehicle: ${data.vehicleId || data.vehicle_id})`);
      
    } catch (err: any) {
      fail++;
      console.log(`  ✗ Failed: ${err.message}`);
      
      // Mark as failed in queue
      await supabase
        .from('import_queue')
        .update({
          status: 'failed',
          error_message: err.message,
          processed_at: new Date().toISOString()
        })
        .eq('id', item.id);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
    
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


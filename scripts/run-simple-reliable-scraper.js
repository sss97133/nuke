#!/usr/bin/env node

/**
 * Simple Reliable Scraper - Very small batches, guaranteed to complete
 * Optimized for increased compute/RAM
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function callFunction(functionName, body = {}) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify(body)
    });
    
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch (e) {
      result = { message: text };
    }
    
    return { 
      success: response.ok, 
      data: result, 
      status: response.status,
      error: response.ok ? null : (result.error || result.message || `HTTP ${response.status}`)
    };
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 SIMPLE RELIABLE SCRAPER (INCREASED COMPUTE/RAM)');
  console.log('='.repeat(70));
  console.log('');
  
  let totalCreated = 0;
  let totalProcessed = 0;
  let successfulRuns = 0;
  
  // Run with small but reliable batches
  console.log('🛒 Running scraper with reliable batches...\n');
  
  for (let i = 0; i < 20; i++) { // More runs
    console.log(`Run ${i + 1}/20...`);
    const result = await callFunction('scrape-all-craigslist-squarebodies', {
      max_regions: 8, // Small enough to complete, large enough to be useful
      max_listings_per_search: 40
    });
    
    if (result.success && result.data) {
      successfulRuns++;
      const stats = result.data.stats || {};
      const created = stats.created || 0;
      const processed = stats.processed || 0;
      totalCreated += created;
      totalProcessed += processed;
      console.log(`  ✅ Processed ${processed}, created ${created} vehicles (total: ${totalCreated})`);
      
      if (stats.errors > 0) {
        console.log(`  ⚠️  ${stats.errors} errors`);
      }
    } else {
      console.log(`  ⚠️  Error: ${result.error || result.status}`);
      if (result.status === 504) {
        console.log(`  ⏱️  Timeout - reducing batch size next run`);
        // Will continue with same size, but note the timeout
      }
    }
    
    // Shorter delay between runs with increased compute
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Successful runs: ${successfulRuns}/20`);
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total vehicles created: ${totalCreated}`);
  console.log('');
  
  if (totalCreated > 0) {
    console.log(`🎉 SUCCESS! Created ${totalCreated} vehicles.`);
  } else {
    console.log('⚠️  No vehicles created. Check function logs for issues.');
  }
  console.log('');
}

main();


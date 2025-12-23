#!/usr/bin/env node

/**
 * Direct Scraper Runner - Small batches to avoid timeouts
 * Focus on getting vehicles created TODAY
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
  console.log('🚀 DIRECT SCRAPER - OPTIMIZED FOR INCREASED COMPUTE/RAM');
  console.log('='.repeat(70));
  console.log('');
  
  let totalCreated = 0;
  let totalProcessed = 0;
  
  // Run direct scraper multiple times with larger batches (increased compute/RAM)
  console.log('🛒 Running direct scraper with optimized batches (increased compute/RAM)...\n');
  
  for (let i = 0; i < 15; i++) { // More runs with increased resources
    console.log(`Run ${i + 1}/15...`);
    const result = await callFunction('scrape-all-craigslist-squarebodies', {
      max_regions: 15, // Increased for more compute/RAM
      max_listings_per_search: 50, // Increased for more compute/RAM
      chain_depth: 2 // Self-invoke to process more
    });
    
    if (result.success && result.data) {
      const stats = result.data.stats || {};
      const created = stats.created || 0;
      const processed = stats.processed || 0;
      totalCreated += created;
      totalProcessed += processed;
      console.log(`  ✅ Processed ${processed}, created ${created} vehicles (total created: ${totalCreated})`);
      
      if (stats.errors > 0) {
        console.log(`  ⚠️  ${stats.errors} errors`);
      }
    } else {
      console.log(`  ⚠️  Error: ${result.error || result.status}`);
      if (result.status === 504) {
        console.log(`  ⏱️  Timeout - waiting longer before next attempt...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
    }
    
    await new Promise(r => setTimeout(r, 5000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total vehicles created: ${totalCreated}`);
  console.log('');
  
  if (totalCreated > 0) {
    console.log('🎉 SUCCESS! Vehicles were created.');
  } else {
    console.log('⚠️  No vehicles created. Functions may be timing out.');
    console.log('   Try running again in a few minutes.');
  }
  console.log('');
}

main();


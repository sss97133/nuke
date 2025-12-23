#!/usr/bin/env node

/**
 * Complete Scraper Runner - Runs all scrapers and processes queues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      result = { message: text, raw: true };
    }
    
    return { success: response.ok, data: result, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 COMPLETE SCRAPER AND QUEUE PROCESSOR');
  console.log('='.repeat(70));
  console.log('');
  
  // Step 1: Run discover scraper (finds listings)
  console.log('📋 Step 1: Discovering new listings...');
  const discoverResult = await callFunction('discover-cl-squarebodies', {
    max_regions: 20,
    max_listings_per_search: 50
  });
  
  if (discoverResult.success) {
    console.log('   ✅ Discovery completed');
  } else {
    console.log('   ⚠️  Discovery error:', discoverResult.error || discoverResult.data?.error);
  }
  
  console.log('\n⏳ Waiting 5 seconds for queue to populate...\n');
  await new Promise(r => setTimeout(r, 5000));
  
  // Step 2: Process CL queue
  console.log('⚡ Step 2: Processing CL queue...');
  let clProcessed = 0;
  for (let i = 0; i < 5; i++) {
    const result = await callFunction('process-cl-queue', { batch_size: 20 });
    if (result.success && result.data?.processed) {
      clProcessed += result.data.processed || 0;
      console.log(`   Batch ${i + 1}: ${result.data.processed || 0} processed`);
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ CL queue: ${clProcessed} items processed\n`);
  
  // Step 3: Process import queue
  console.log('⚡ Step 3: Processing import queue...');
  let importProcessed = 0;
  let importSucceeded = 0;
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 20,
      priority_only: false
    });
    
    if (result.success && result.data?.processed) {
      importProcessed += result.data.processed || 0;
      importSucceeded += result.data.succeeded || 0;
      console.log(`   Batch ${i + 1}: ${result.data.processed || 0} processed, ${result.data.succeeded || 0} succeeded`);
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ Import queue: ${importProcessed} processed, ${importSucceeded} succeeded\n`);
  
  // Step 4: Process BaT extraction queue
  console.log('⚡ Step 4: Processing BaT extraction queue...');
  let batProcessed = 0;
  for (let i = 0; i < 5; i++) {
    const result = await callFunction('process-bat-extraction-queue', {
      batchSize: 10,
      maxAttempts: 3
    });
    
    if (result.success && result.data?.processed) {
      batProcessed += result.data.processed || 0;
      console.log(`   Batch ${i + 1}: ${result.data.processed || 0} processed`);
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ BaT queue: ${batProcessed} items processed\n`);
  
  // Summary
  console.log('='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`   CL Queue: ${clProcessed} processed`);
  console.log(`   Import Queue: ${importProcessed} processed, ${importSucceeded} succeeded`);
  console.log(`   BaT Queue: ${batProcessed} processed`);
  console.log('');
}

main().catch(console.error);


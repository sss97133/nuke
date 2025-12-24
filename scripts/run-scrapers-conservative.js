#!/usr/bin/env node

/**
 * Conservative Scraper Runner - Focuses on processing existing queues first
 * Then does small discovery batches to avoid timeouts
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
    if (line.startsWith('VITE_SUPABASE_URL=') && !SUPABASE_URL.includes('qkgaybvrernstplzjaam')) {
      SUPABASE_URL = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
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
  console.log('🚀 CONSERVATIVE SCRAPER RUNNER (FOCUS ON RESULTS)');
  console.log('='.repeat(70));
  console.log('');
  
  let totalCreated = 0;
  let totalProcessed = 0;
  
  // Step 1: Process existing queues first (these are fast and create vehicles)
  console.log('⚡ Step 1: Processing existing queues (fast, creates vehicles)...\n');
  
  // Process CL queue
  console.log('   Processing CL queue...');
  for (let i = 0; i < 25; i++) {
    const result = await callFunction('process-cl-queue', {
      batch_size: 45 // Increased for more compute/RAM
    });
    
    if (result.success && result.data) {
      const stats = result.data.stats || {};
      const processed = stats.processed || 0;
      const created = stats.created || 0;
      
      if (processed > 0) {
        totalProcessed += processed;
        totalCreated += created;
        console.log(`   ✅ Batch ${i + 1}: ${processed} processed, ${created} created`);
      } else {
        console.log(`   ✅ Queue empty after ${i} batches`);
        break;
      }
    } else {
      if (i === 0) {
        console.log(`   ⚠️  First attempt failed: ${result.error}`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      } else {
        break;
      }
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Process import queue
  console.log('\n   Processing import queue...');
  for (let i = 0; i < 25; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 40, // Increased for more compute/RAM
      priority_only: i === 0
    });
    
    if (result.success && result.data) {
      const processed = result.data.processed || 0;
      if (processed > 0) {
        totalProcessed += processed;
        console.log(`   ✅ Batch ${i + 1}: ${processed} processed, ${result.data.succeeded || 0} succeeded`);
      } else {
        console.log(`   ✅ Queue empty after ${i} batches`);
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Step 2: Small discovery batches (to avoid timeouts)
  console.log('\n🔍 Step 2: Discovering new listings (small batches)...\n');
  
  for (let round = 0; round < 3; round++) {
    console.log(`   Discovery round ${round + 1}/3...`);
    const discoverResult = await callFunction('discover-cl-squarebodies', {
      max_regions: 25, // Optimized for upgraded compute/RAM
      max_searches_per_region: 10,
      chain_depth: 2 // Self-invoke to process more
    });
    
    if (discoverResult.success) {
      const data = discoverResult.data || {};
      const stats = data.stats || {};
      console.log(`   ✅ Found ${stats.listings_found || 0} listings, added ${stats.listings_added_to_queue || 0} to queue`);
      
      // Immediately process what we found
      if (stats.listings_added_to_queue > 0) {
        console.log(`   Processing newly discovered listings...`);
        for (let i = 0; i < 5; i++) {
          const result = await callFunction('process-cl-queue', {
            batch_size: 30
          });
          
          if (result.success && result.data) {
            const stats = result.data.stats || {};
            if (stats.processed > 0) {
              totalProcessed += stats.processed;
              totalCreated += (stats.created || 0);
              console.log(`     ✅ Processed ${stats.processed}, created ${stats.created || 0}`);
            } else {
              break;
            }
          } else {
            break;
          }
          
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } else {
      console.log(`   ⚠️  Discovery failed: ${discoverResult.error}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Step 3: One more queue processing pass
  console.log('\n⚡ Step 3: Final queue processing pass...\n');
  
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-cl-queue', {
      batch_size: 30
    });
    
    if (result.success && result.data) {
      const stats = result.data.stats || {};
      if (stats.processed > 0) {
        totalProcessed += stats.processed;
        totalCreated += (stats.created || 0);
        console.log(`   ✅ Batch ${i + 1}: ${stats.processed} processed, ${stats.created || 0} created`);
      } else {
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 1000));
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
    console.log('⚠️  No vehicles created. Check queues and try again.');
  }
  console.log('');
}

main();


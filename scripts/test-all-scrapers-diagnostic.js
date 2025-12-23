#!/usr/bin/env node

/**
 * Comprehensive Scraper Diagnostic & Test Runner
 * 
 * 1. Checks current queue statuses
 * 2. Runs all scrapers
 * 3. Monitors results and identifies failures
 * 4. Reports what's working and what's broken
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
      text,
      error: response.ok ? null : (result.error || result.message || `HTTP ${response.status}`)
    };
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function checkQueueStatus() {
  console.log('📊 Checking queue statuses...\n');
  
  const queues = [
    { name: 'Import Queue', table: 'import_queue' },
    { name: 'CL Listing Queue', table: 'craigslist_listing_queue' },
    { name: 'BaT Extraction Queue', table: 'bat_extraction_queue' }
  ];
  
  const stats = {};
  
  for (const queue of queues) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${queue.table}?select=status&limit=10000`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const statusCounts = {};
        data.forEach(item => {
          statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
        });
        stats[queue.name] = statusCounts;
        const total = data.length;
        const pending = statusCounts.pending || 0;
        const processing = statusCounts.processing || 0;
        const failed = statusCounts.failed || 0;
        const complete = statusCounts.complete || 0;
        
        console.log(`   ${queue.name}:`);
        console.log(`      Total: ${total}`);
        console.log(`      Pending: ${pending} | Processing: ${processing} | Complete: ${complete} | Failed: ${failed}`);
      } else {
        console.log(`   ${queue.name}: ❌ Error ${response.status}`);
        stats[queue.name] = { error: response.status };
      }
    } catch (error) {
      console.log(`   ${queue.name}: ❌ ${error.message}`);
      stats[queue.name] = { error: error.message };
    }
  }
  
  console.log('');
  return stats;
}

async function testScraper(name, functionName, body = {}) {
  console.log(`   🔍 Testing ${name}...`);
  const startTime = Date.now();
  const result = await callFunction(functionName, body);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  if (result.success) {
    const data = result.data || {};
    const message = data.message || data.count || data.processed || 'Success';
    console.log(`      ✅ ${name} (${duration}s): ${message}`);
    return { name, success: true, duration, message, data };
  } else {
    const error = result.error || result.data?.error || `HTTP ${result.status}`;
    console.log(`      ❌ ${name} (${duration}s): ${error}`);
    return { name, success: false, duration, error, status: result.status };
  }
}

async function runAllScrapers() {
  console.log('🚀 Testing all scrapers...\n');
  
  const scrapers = [
    // Discovery scrapers
    {
      name: 'Discover CL Squarebodies',
      function: 'discover-cl-squarebodies',
      body: { max_regions: 5, max_searches_per_region: 3 }
    },
    
    // Marketplace scrapers
    {
      name: 'Scrape KSL Listings',
      function: 'scrape-ksl-listings',
      body: { searchUrl: 'https://www.ksl.com/auto/search?make=Chevrolet&model=Squarebody', maxListings: 5, importToDb: false }
    },
    {
      name: 'Scrape CL Squarebodies',
      function: 'scrape-all-craigslist-squarebodies',
      body: { max_regions: 3, max_listings: 10 }
    },
    
    // Queue processors
    {
      name: 'Process CL Queue',
      function: 'process-cl-queue',
      body: { batch_size: 5 }
    },
    {
      name: 'Process Import Queue',
      function: 'process-import-queue',
      body: { batch_size: 5, priority_only: false }
    },
    {
      name: 'Process BaT Queue',
      function: 'process-bat-extraction-queue',
      body: { batchSize: 5, maxAttempts: 2 }
    },
    
    // Re-extraction
    {
      name: 'Re-extract Pending',
      function: 're-extract-pending-vehicles',
      body: { batch_size: 10, force: false }
    },
    
    // Parts scrapers
    {
      name: 'Scrape LMC Parts',
      function: 'scrape-lmc-parts',
      body: { max_pages: 2 }
    }
  ];
  
  const results = [];
  
  for (const scraper of scrapers) {
    const result = await testScraper(scraper.name, scraper.function, scraper.body);
    results.push(result);
    await new Promise(r => setTimeout(r, 1000)); // Small delay between scrapers
  }
  
  return results;
}

async function checkRecentVehicles() {
  console.log('\n📈 Checking recent vehicle creation...\n');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?select=id,created_at,origin_metadata&order=created_at.desc&limit=10`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    
    if (response.ok) {
      const vehicles = await response.json();
      console.log(`   Last 10 vehicles created:`);
      vehicles.forEach((v, i) => {
        const date = new Date(v.created_at).toLocaleString();
        const source = v.origin_metadata?.source || 'unknown';
        console.log(`      ${i + 1}. ${date} (source: ${source})`);
      });
      
      if (vehicles.length > 0) {
        const newest = new Date(vehicles[0].created_at);
        const now = new Date();
        const minutesAgo = Math.floor((now - newest) / 1000 / 60);
        console.log(`\n   ⏰ Most recent vehicle: ${minutesAgo} minutes ago`);
        return { recent: minutesAgo < 60, minutesAgo, count: vehicles.length };
      }
    }
  } catch (error) {
    console.log(`   ❌ Error checking vehicles: ${error.message}`);
  }
  
  return { recent: false, minutesAgo: null };
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔍 COMPREHENSIVE SCRAPER DIAGNOSTIC');
  console.log('='.repeat(70));
  console.log('');
  
  try {
    // Step 1: Check queue statuses
    const queueStats = await checkQueueStatus();
    
    // Step 2: Run all scrapers
    const scraperResults = await runAllScrapers();
    
    // Step 3: Check recent vehicle creation
    const vehicleCheck = await checkRecentVehicles();
    
    // Step 4: Wait a bit and check queues again
    console.log('\n⏳ Waiting 5 seconds, then checking queues again...\n');
    await new Promise(r => setTimeout(r, 5000));
    const queueStatsAfter = await checkQueueStatus();
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📋 SUMMARY');
    console.log('='.repeat(70));
    
    const successful = scraperResults.filter(r => r.success);
    const failed = scraperResults.filter(r => !r.success);
    
    console.log(`\n✅ Successful scrapers: ${successful.length}/${scraperResults.length}`);
    successful.forEach(r => {
      console.log(`   ✓ ${r.name}`);
    });
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed scrapers: ${failed.length}/${scraperResults.length}`);
      failed.forEach(r => {
        console.log(`   ✗ ${r.name}: ${r.error} (HTTP ${r.status || 'N/A'})`);
      });
    }
    
    console.log(`\n📊 Queue Status:`);
    Object.entries(queueStatsAfter).forEach(([name, stats]) => {
      if (stats.error) {
        console.log(`   ${name}: ❌ ${stats.error}`);
      } else {
        const pending = stats.pending || 0;
        const processing = stats.processing || 0;
        const failed = stats.failed || 0;
        console.log(`   ${name}: ${pending} pending, ${processing} processing, ${failed} failed`);
      }
    });
    
    console.log(`\n🚗 Recent Vehicles:`);
    if (vehicleCheck.recent) {
      console.log(`   ✅ Vehicles being created (last one ${vehicleCheck.minutesAgo} min ago)`);
    } else {
      console.log(`   ⚠️  No recent vehicles (last one ${vehicleCheck.minutesAgo || 'unknown'} min ago)`);
    }
    
    // Recommendations
    console.log(`\n💡 Recommendations:`);
    if (failed.length > 0) {
      console.log(`   - Fix ${failed.length} failing scraper(s)`);
    }
    if (queueStatsAfter['Import Queue']?.pending > 100) {
      console.log(`   - Process import queue (${queueStatsAfter['Import Queue'].pending} pending)`);
    }
    if (queueStatsAfter['CL Listing Queue']?.pending > 50) {
      console.log(`   - Process CL queue (${queueStatsAfter['CL Listing Queue'].pending} pending)`);
    }
    if (!vehicleCheck.recent) {
      console.log(`   - Investigate why no new vehicles are being created`);
      console.log(`   - Check if scrapers are finding listings but not importing`);
      console.log(`   - Verify import queue processor is working`);
    }
    
    console.log('');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();



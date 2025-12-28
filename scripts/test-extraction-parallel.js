#!/usr/bin/env node
/**
 * Test script to verify parallel extraction is working
 * Tests both CL queue and BAT profile extraction
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

async function testCLQueue() {
  console.log('\n=== Testing Craigslist Queue Processor (Parallel) ===');
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/process-cl-queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      batch_size: 10  // Test with 10 items
    })
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Result:', JSON.stringify(result, null, 2));
  
  return result;
}

async function testBATProfileExtraction() {
  console.log('\n=== Testing BaT Profile Extraction (Parallel) ===');
  
  // Test with a known BaT profile
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-bat-profile-vehicles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      username: 'TheShopClubs',  // Known profile
      extract_vehicles: true
    })
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Result:', JSON.stringify(result, null, 2));
  
  return result;
}

async function checkQueueStats() {
  console.log('\n=== Queue Statistics ===');
  
  // Check CL queue
  const clResponse = await fetch(`${SUPABASE_URL}/rest/v1/craigslist_listing_queue?select=status&limit=1000`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  
  const clData = await clResponse.json();
  const clStats = clData.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log('CL Queue:', clStats);

  // Check import queue
  const importResponse = await fetch(`${SUPABASE_URL}/rest/v1/import_queue?select=status&limit=1000`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  
  const importData = await importResponse.json();
  const importStats = importData.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Import Queue:', importStats);

  // Check total vehicles
  const vehiclesResponse = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?select=id&limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact'
    }
  });
  
  const vehicleCount = vehiclesResponse.headers.get('content-range')?.split('/')[1] || 'unknown';
  console.log('Total Vehicles:', vehicleCount);
}

async function main() {
  const args = process.argv.slice(2);
  
  try {
    await checkQueueStats();
    
    if (args.includes('--cl') || args.includes('--all')) {
      await testCLQueue();
    }
    
    if (args.includes('--bat') || args.includes('--all')) {
      await testBATProfileExtraction();
    }
    
    if (!args.length) {
      console.log('\nUsage:');
      console.log('  node test-extraction-parallel.js --cl     # Test CL queue');
      console.log('  node test-extraction-parallel.js --bat    # Test BaT extraction');
      console.log('  node test-extraction-parallel.js --all    # Test everything');
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

main();


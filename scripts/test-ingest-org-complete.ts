#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Test script for ingest-org-complete Edge Function
 * 
 * Usage:
 *   deno run --allow-net --allow-env scripts/test-ingest-org-complete.ts [url]
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('VITE_SUPABASE_ANON_KEY') || '';

const TEST_URL = Deno.args[0] || 'https://www.velocityrestorations.com/';

async function testIngestOrgComplete() {
  console.log('🧪 Testing ingest-org-complete Edge Function\n');
  console.log(`📍 URL: ${TEST_URL}`);
  console.log(`🔗 Supabase URL: ${SUPABASE_URL}\n`);

  if (!SUPABASE_ANON_KEY) {
    console.error('❌ Error: SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY must be set');
    Deno.exit(1);
  }

  const functionUrl = `${SUPABASE_URL}/functions/v1/ingest-org-complete`;

  console.log('📡 Calling Edge Function...\n');

  try {
    const startTime = Date.now();
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: TEST_URL }),
    });

    const duration = Date.now() - startTime;
    const result = await response.json();

    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📊 Status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      console.error('❌ Error Response:');
      console.error(JSON.stringify(result, null, 2));
      Deno.exit(1);
    }

    if (result.success) {
      console.log('✅ Success!\n');
      console.log('📋 Results:');
      console.log(`   Organization ID: ${result.organization_id}`);
      console.log(`   Organization Name: ${result.organization_name}`);
      console.log(`   Vehicles Found: ${result.vehicles.found}`);
      console.log(`   Vehicles Inserted: ${result.vehicles.inserted}`);
      console.log(`   Vehicles Errors: ${result.vehicles.errors}`);
      console.log(`\n📊 Statistics:`);
      console.log(`   Org Fields Extracted: ${result.stats.org_fields_extracted}`);
      console.log(`   Vehicles Found: ${result.stats.vehicles_found}`);
      console.log(`   Vehicles With Images: ${result.stats.vehicles_with_images}`);
      
      console.log(`\n✅ Test passed! Ingested ${result.vehicles.inserted} vehicles for ${result.organization_name}`);
    } else {
      console.error('❌ Function returned success: false');
      console.error('Error:', result.error);
      if (result.stack) {
        console.error('\nStack trace:');
        console.error(result.stack);
      }
      Deno.exit(1);
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await testIngestOrgComplete();
}


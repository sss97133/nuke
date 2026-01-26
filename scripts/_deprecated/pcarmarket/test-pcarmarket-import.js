#!/usr/bin/env node
/**
 * TEST PCARMARKET IMPORT
 * 
 * Tests importing a PCarMarket listing via the Edge Function
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found');
  process.exit(1);
}

async function testImport(listingUrl) {
  console.log(`\n🧪 Testing PCarMarket import: ${listingUrl}\n`);

  try {
    // Invoke the Edge Function
    const { data, error } = await fetch(`${supabaseUrl}/functions/v1/import-pcarmarket-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        listing_url: listingUrl
      })
    });

    const result = await data.json();

    if (error || !data.ok) {
      console.error('❌ Import failed:', result.error || error);
      return;
    }

    if (result.success) {
      console.log('✅ Import successful!');
      console.log(`   Vehicle ID: ${result.vehicle_id}`);
      console.log(`   Organization ID: ${result.organization_id}`);
      console.log(`   Listing: ${result.listing.title}`);
      console.log(`   URL: ${result.listing.url}`);
    } else {
      console.error('❌ Import failed:', result);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.log('Usage: node scripts/test-pcarmarket-import.js <listing_url>');
    console.log('\nExample:');
    console.log('  node scripts/test-pcarmarket-import.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2');
    process.exit(1);
  }

  await testImport(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}


#!/usr/bin/env node
/**
 * Test KSL scraping with Firecrawl
 * This will test if Firecrawl is properly configured
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_URL = process.argv[2] || 'https://cars.ksl.com/listing/10322112';

async function testScrape() {
  console.log('🔍 Testing KSL Scraping with Firecrawl\n');
  console.log(`URL: ${TEST_URL}\n`);
  
  // Check if Firecrawl key is in local env (for reference)
  const localKey = process.env.FIRECRAWL_API_KEY;
  if (localKey) {
    console.log('✅ Firecrawl key found in local .env');
  } else {
    console.log('⚠️  Firecrawl key not in local .env (edge function uses Supabase secrets)');
  }
  console.log('');
  
  console.log('Calling scrape-vehicle edge function...\n');
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: TEST_URL },
      timeout: 60000
    });
    
    if (error) {
      console.error('❌ Error:', error.message);
      
      if (error.message.includes('non-2xx')) {
        console.log('\n💡 The edge function may need:');
        console.log('   1. Firecrawl API key set in Supabase secrets');
        console.log('   2. Edge function redeployed');
        console.log('\n   Run: supabase functions deploy scrape-vehicle');
      }
      return;
    }
    
    if (!data) {
      console.log('⚠️  No data returned');
      return;
    }
    
    // Handle wrapped response format
    const listingData = data?.data || data;
    
    // Check if we got blocked
    if (listingData.title && listingData.title.includes('denied')) {
      console.log('❌ Still blocked by KSL');
      console.log('   Firecrawl may not be working or not configured');
      return;
    }
    
    // Success!
    console.log('✅ Success! Firecrawl is working!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Title: ${listingData.title || 'N/A'}`);
    console.log(`Year: ${listingData.year || 'N/A'} | Make: ${listingData.make || 'N/A'} | Model: ${listingData.model || 'N/A'}`);
    
    if (listingData.asking_price) {
      console.log(`Price: $${listingData.asking_price.toLocaleString()}`);
    }
    
    if (listingData.mileage) {
      console.log(`Mileage: ${listingData.mileage.toLocaleString()} miles`);
    }
    
    if (listingData.vin) {
      console.log(`VIN: ${listingData.vin}`);
    }
    
    if (listingData.source) {
      console.log(`Source: ${listingData.source}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Offer to import
    console.log('💡 To import this listing:');
    console.log(`   node scripts/import-ksl-single.js "${TEST_URL}"`);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  }
}

testScrape().catch(console.error);


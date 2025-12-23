#!/usr/bin/env node
/**
 * Test Craigslist listing scraping
 * 
 * Usage:
 *   node scripts/test-craigslist-scrape.js <craigslist-url>
 * 
 * Example:
 *   node scripts/test-craigslist-scrape.js https://sfbay.craigslist.org/cto/d/san-francisco-1979-chevrolet-c10/7834567890.html
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_URL = process.argv[2];

if (!TEST_URL) {
  console.error('❌ Error: Please provide a Craigslist URL');
  console.error('Usage: node scripts/test-craigslist-scrape.js <craigslist-url>');
  process.exit(1);
}

if (!TEST_URL.includes('craigslist.org')) {
  console.error('❌ Error: URL must be a Craigslist listing URL');
  process.exit(1);
}

async function testScrape() {
  console.log('🔥 Testing Craigslist Listing Scraping\n');
  console.log(`URL: ${TEST_URL}\n`);
  
  console.log('📡 Calling scrape-vehicle edge function...\n');
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: TEST_URL },
      timeout: 60000  // 1 minute timeout
    });

    if (error) {
      console.error('❌ Edge function error:', error);
      console.error('   Message:', error.message);
      if (error.context) {
        console.error('   Context:', JSON.stringify(error.context, null, 2));
      }
      // Try to get response body if available
      if (error.context && error.context.body) {
        try {
          const bodyText = await error.context.body.text();
          console.error('   Response body:', bodyText);
        } catch (e) {
          // Ignore if can't read body
        }
      }
      return;
    }

    if (!data) {
      console.error('❌ No data returned from edge function');
      return;
    }

    if (!data.success) {
      console.error('❌ Scraping failed:', data.error);
      if (data._debug) {
        console.error('   Debug info:', JSON.stringify(data._debug, null, 2));
      }
      return;
    }

    const vehicleData = data.data || data;
    
    console.log('✅ Scraping successful!\n');
    console.log('📊 Extracted Data:');
    console.log(`   Year: ${vehicleData.year || 'N/A'}`);
    console.log(`   Make: ${vehicleData.make || 'N/A'}`);
    console.log(`   Model: ${vehicleData.model || 'N/A'}`);
    console.log(`   Price: ${vehicleData.asking_price || vehicleData.price ? '$' + (vehicleData.asking_price || vehicleData.price).toLocaleString() : 'N/A'}`);
    console.log(`   Mileage: ${vehicleData.mileage ? vehicleData.mileage.toLocaleString() + ' miles' : 'N/A'}`);
    console.log(`   Location: ${vehicleData.location || 'N/A'}`);
    console.log(`   VIN: ${vehicleData.vin || 'N/A'}`);
    console.log(`   Images: ${vehicleData.images?.length || 0}`);
    console.log(`   Source: ${vehicleData.source || 'N/A'}`);
    
    if (vehicleData.title) {
      console.log(`\n📝 Title: ${vehicleData.title}`);
    }
    
    if (vehicleData.description) {
      console.log(`\n📄 Description (first 300 chars):`);
      console.log(`   ${vehicleData.description.substring(0, 300)}...`);
    }
    
    if (vehicleData.images && vehicleData.images.length > 0) {
      console.log(`\n🖼️  Images (first 5):`);
      vehicleData.images.slice(0, 5).forEach((img, i) => {
        console.log(`   ${i + 1}. ${img.substring(0, 100)}${img.length > 100 ? '...' : ''}`);
      });
    }
    
    // Additional Craigslist-specific fields
    if (vehicleData.posted_date) {
      console.log(`\n📅 Posted: ${vehicleData.posted_date}`);
    }
    
    if (vehicleData.attributes) {
      console.log(`\n⚙️  Attributes:`);
      Object.entries(vehicleData.attributes).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    
    console.log('\n✅ Test complete!\n');
    
    // Output full JSON for inspection
    console.log('\n📋 Full JSON Output:');
    console.log(JSON.stringify(vehicleData, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testScrape();


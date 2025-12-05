#!/usr/bin/env node
/**
 * Test Facebook Marketplace scraping with Firecrawl
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_URL = process.argv[2] || 'https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr';

async function testScrape() {
  console.log('🔥 Testing Facebook Marketplace Scraping\n');
  console.log(`URL: ${TEST_URL}\n`);
  
  console.log('📡 Calling scrape-vehicle edge function...\n');
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: TEST_URL },
      timeout: 120000  // 2 minute timeout for Firecrawl
    });

    if (error) {
      console.error('❌ Edge function error:', error);
      console.error('   Message:', error.message);
      if (error.context) {
        console.error('   Context:', JSON.stringify(error.context, null, 2));
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

    const vehicleData = data.data;
    
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
    
    if (data._metadata) {
      console.log(`\n📡 Fetch Method: ${data._metadata.fetchMethod || 'N/A'}`);
      console.log(`   Firecrawl Used: ${data._metadata.firecrawlUsed ? 'Yes' : 'No'}`);
      console.log(`   HTML Length: ${data._metadata.htmlLength || 0} bytes`);
    }
    
    if (vehicleData.title) {
      console.log(`\n📝 Title: ${vehicleData.title}`);
    }
    
    if (vehicleData.description) {
      console.log(`\n📄 Description (first 200 chars):`);
      console.log(`   ${vehicleData.description.substring(0, 200)}...`);
    }
    
    if (vehicleData.images && vehicleData.images.length > 0) {
      console.log(`\n🖼️  Images (first 3):`);
      vehicleData.images.slice(0, 3).forEach((img, i) => {
        console.log(`   ${i + 1}. ${img.substring(0, 80)}...`);
      });
    }
    
    console.log('\n✅ Test complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testScrape();


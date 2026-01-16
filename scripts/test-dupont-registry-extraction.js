/**
 * Test DuPont Registry Extraction
 * Tests extraction from sample DuPont Registry listing URLs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Test URLs from DuPont Registry
const TEST_URLS = [
  // Live Auctions
  'https://live.dupontregistry.com/auction/1992-porsche911targa-reimaginedbysinger-162',
  
  // Marketplace (if we can find a sample)
  // 'https://www.dupontregistry.com/autos/listing/2025/ferrari/296--gts/506113',
];

async function testExtraction(url) {
  console.log(`\n🔍 Testing extraction from: ${url}`);
  console.log('─'.repeat(80));
  
  try {
    // Test scrape-multi-source directly
    console.log('📤 Calling scrape-multi-source directly...');
    const extractResponse = await supabase.functions.invoke('scrape-multi-source', {
      body: {
        source_url: url,
        source_type: url.includes('live.dupontregistry.com') ? 'auction' : 'marketplace',
        extract_listings: true,
        extract_dealer_info: true,
        max_listings: 1
      }
    });
    
    if (extractResponse.error) {
      console.error('❌ Extraction error:', extractResponse.error);
      console.error('Error details:', JSON.stringify(extractResponse.error, null, 2));
    } else {
      console.log('✅ Extraction result:');
      console.log(JSON.stringify(extractResponse.data, null, 2));
      
      if (extractResponse.data?.listings && extractResponse.data.listings.length > 0) {
        console.log(`\n✅ Successfully extracted ${extractResponse.data.listings.length} listing(s)`);
        const listing = extractResponse.data.listings[0];
        console.log(`   Title: ${listing.title || 'N/A'}`);
        console.log(`   Year: ${listing.year || 'N/A'}`);
        console.log(`   Make: ${listing.make || 'N/A'}`);
        console.log(`   Model: ${listing.model || 'N/A'}`);
        console.log(`   Price: ${listing.price || 'N/A'}`);
        console.log(`   Images: ${listing.image_urls?.length || 0}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

async function main() {
  console.log('🚀 DuPont Registry Extraction Test');
  console.log('='.repeat(80));
  
  for (const url of TEST_URLS) {
    await testExtraction(url);
    
    // Delay between tests
    if (TEST_URLS.indexOf(url) < TEST_URLS.length - 1) {
      console.log('\n⏳ Waiting 3 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n✅ Tests completed!');
}

main().catch(console.error);

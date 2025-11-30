/**
 * Test AI Extraction on Unknown Source
 * 
 * Tests the enhanced scrape-vehicle function with a real listing
 * from a source we haven't built a custom parser for.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test URLs from sources we haven't built parsers for
const testUrls = [
  // Hemmings listing
  'https://www.hemmings.com/classifieds/listing/chevrolet/blazer/1977',
  // AutoTrader Classic
  'https://www.autotrader.com/cars-for-sale/vehicledetails.xhtml',
  // Cars.com
  'https://www.cars.com/vehicledetail/',
  // Random dealer site
  'https://www.hemmings.com/classifieds/dealer/chevrolet/blazer/1977'
];

async function testExtraction(url) {
  console.log(`\n🧪 Testing AI extraction for: ${url}\n`);
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url }
    });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    if (!data || !data.success) {
      console.error('❌ Extraction failed:', data?.error || 'Unknown error');
      return;
    }

    const extracted = data.data;
    
    console.log('✅ Extraction successful!\n');
    console.log('📊 Extracted Data:');
    console.log('  Source:', extracted.source);
    console.log('  Year:', extracted.year || 'N/A');
    console.log('  Make:', extracted.make || 'N/A');
    console.log('  Model:', extracted.model || 'N/A');
    console.log('  Series:', extracted.series || 'N/A');
    console.log('  Trim:', extracted.trim || 'N/A');
    console.log('  VIN:', extracted.vin || 'N/A');
    console.log('  Price:', extracted.price || extracted.asking_price || 'N/A');
    console.log('  Mileage:', extracted.mileage || 'N/A');
    console.log('  Images:', extracted.images?.length || 0);
    console.log('  Description length:', extracted.description?.length || 0, 'chars');
    
    if (extracted.source?.includes('AI Extracted')) {
      console.log('\n🎉 AI extraction was used!');
    }
    
    return extracted;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test with first available URL
async function main() {
  console.log('🚀 Testing AI-Powered Vehicle Data Extraction\n');
  console.log('This tests the enhanced scrape-vehicle function');
  console.log('with a source we haven\'t built a custom parser for.\n');
  
  // Try a real squarebody listing - let's use a known good URL
  // If you have a specific URL you want to test, replace this:
  const testUrl = process.argv[2] || 'https://www.hemmings.com/classifieds/listing/chevrolet/blazer/1977';
  
  await testExtraction(testUrl);
}

main().catch(console.error);


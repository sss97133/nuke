/**
 * TEST PROWIRE SCRAPER
 * Uses edge function which has access to Supabase secrets
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ProWire catalog URLs
const CATALOG_URLS = [
  {
    name: 'Deutsch DT Series Heat Shrink Boots',
    url: 'https://www.prowireusa.com/content/9660/Deutsch%20DT%20Series%20Heat%20Shrink%20Boots'
  },
  {
    name: 'Deutsch DTM Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dtm-rubber-boots'
  },
  {
    name: 'Deutsch DT Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dt-rubber-boots'
  },
  {
    name: 'Deutsch DTP Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dtp-rubber-boots'
  }
];

async function testScraper() {
  console.log('🚀 TESTING PROWIRE CATALOG SCRAPER');
  console.log('='.repeat(70));
  console.log('');
  console.log('Using edge function: scrape-prowire-catalog');
  console.log('(Edge function has access to FIRECRAWL_API_KEY from Supabase secrets)');
  console.log('');
  
  // First, deploy the edge function if needed
  console.log('⚠️  Make sure the edge function is deployed:');
  console.log('   supabase functions deploy scrape-prowire-catalog');
  console.log('');
  
  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  
  for (const catalog of CATALOG_URLS) {
    console.log(`\n🔥 Scraping: ${catalog.name}`);
    console.log(`   URL: ${catalog.url}`);
    
    try {
      const { data, error } = await supabase.functions.invoke('scrape-prowire-catalog', {
        body: {
          url: catalog.url,
          category_name: catalog.name
        }
      });
      
      if (error) {
        console.error(`   ❌ Error: ${error.message}`);
        continue;
      }
      
      if (data.error) {
        console.error(`   ❌ Function error: ${data.error}`);
        continue;
      }
      
      console.log(`   ✅ Success!`);
      console.log(`      Products found: ${data.products_found || 0}`);
      console.log(`      Stored: ${data.stored || 0}`);
      console.log(`      Updated: ${data.updated || 0}`);
      
      if (data.products && data.products.length > 0) {
        console.log(`\n   📦 Sample products:`);
        data.products.slice(0, 3).forEach((p, i) => {
          console.log(`      ${i + 1}. ${p.part_number || 'N/A'} - ${p.name || 'N/A'}`);
          if (p.price) console.log(`         Price: $${p.price}`);
        });
      }
      
      totalProducts += data.products_found || 0;
      totalStored += data.stored || 0;
      totalUpdated += data.updated || 0;
      
      // Delay between requests
      if (catalog !== CATALOG_URLS[CATALOG_URLS.length - 1]) {
        console.log(`   ⏳ Waiting 3 seconds...`);
        await new Promise(r => setTimeout(r, 3000));
      }
      
    } catch (error) {
      console.error(`   ❌ Exception: ${error.message}`);
    }
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total products found: ${totalProducts}`);
  console.log(`✅ Stored: ${totalStored}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log('');
  
  // Check database
  const { data: parts, error: dbError } = await supabase
    .from('catalog_parts')
    .select('part_number, name, price_current, category')
    .eq('category', 'wiring')
    .limit(10);
  
  if (!dbError && parts && parts.length > 0) {
    console.log('📦 Sample products in database:');
    parts.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.part_number} - ${p.name}`);
      if (p.price_current) console.log(`      Price: $${p.price_current}`);
    });
  }
  
  console.log('');
  console.log('✅ Test complete!');
}

testScraper().catch(console.error);


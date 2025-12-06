/**
 * UPDATE MOTEC PRICES
 * 
 * Re-scrapes Motec products to extract pricing data
 * Updates existing products with prices for proper quoting
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

async function updatePrices() {
  console.log('💰 UPDATING MOTEC PRICES');
  console.log('='.repeat(70));
  console.log('');
  
  // Get all Motec products without prices
  const { data: source } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'Motec')
    .single();
  
  if (!source) {
    console.error('❌ Motec catalog source not found');
    return;
  }
  
  const { data: products } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current, supplier_url')
    .eq('catalog_id', source.id)
    .order('part_number');
  
  if (!products || products.length === 0) {
    console.log('No Motec products found');
    return;
  }
  
  console.log(`Found ${products.length} Motec products`);
  console.log(`Products without prices: ${products.filter(p => !p.price_current).length}`);
  console.log('');
  console.log('Re-scraping product pages to extract prices...');
  console.log('');
  
  // Pages that had products (from previous scrape)
  const productPages = [
    'https://www.motec.com/',
    'https://www.motec.com/products',
    'https://www.motec.com/software',
    'https://www.motec.com/displays',
    'https://www.motec.com/c1212',
    'https://www.motec.com/downloads',
    'https://www.motec.com/training'
  ];
  
  let totalUpdated = 0;
  let totalWithPrices = 0;
  
  // Re-scrape pages to get prices
  for (let i = 0; i < productPages.length; i++) {
    const url = productPages[i];
    const pageName = url.split('/').pop() || 'Homepage';
    
    console.log(`[${i + 1}/${productPages.length}] Scraping: ${pageName}`);
    console.log(`   URL: ${url}`);
    
    try {
      const { data, error } = await supabase.functions.invoke('scrape-motec-catalog', {
        body: {
          url,
          category_name: `Price Update: ${pageName}`
        }
      });
      
      if (error || data?.error) {
        console.log(`   ⚠️  Failed: ${error?.message || data?.error}`);
      } else {
        console.log(`   ✅ Found ${data.products_found || 0} products`);
        console.log(`      Updated: ${data.updated || 0}`);
        totalUpdated += data.updated || 0;
      }
      
      // Delay between requests
      if (i < productPages.length - 1) {
        console.log(`   ⏳ Waiting 3 seconds...`);
        await new Promise(r => setTimeout(r, 3000));
      }
      console.log('');
    } catch (error) {
      console.error(`   ❌ Exception: ${error.message}`);
    }
  }
  
  // Check final price coverage
  const { data: finalProducts } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current')
    .eq('catalog_id', source.id);
  
  if (finalProducts) {
    totalWithPrices = finalProducts.filter(p => p.price_current).length;
    const priceCoverage = Math.round((totalWithPrices / finalProducts.length) * 100);
    
    console.log('='.repeat(70));
    console.log('📊 PRICE UPDATE SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total products: ${finalProducts.length}`);
    console.log(`Products with prices: ${totalWithPrices} (${priceCoverage}%)`);
    console.log(`Products without prices: ${finalProducts.length - totalWithPrices}`);
    console.log(`Updated in this run: ${totalUpdated}`);
    console.log('');
    
    if (totalWithPrices > 0) {
      console.log('✅ Products with prices:');
      finalProducts
        .filter(p => p.price_current)
        .slice(0, 10)
        .forEach(p => {
          console.log(`   - ${p.part_number}: $${p.price_current}`);
        });
      if (totalWithPrices > 10) {
        console.log(`   ... and ${totalWithPrices - 10} more`);
      }
    }
    
    if (finalProducts.length - totalWithPrices > 0) {
      console.log('');
      console.log('⚠️  Products still without prices:');
      finalProducts
        .filter(p => !p.price_current)
        .slice(0, 10)
        .forEach(p => {
          console.log(`   - ${p.part_number}: ${p.name}`);
        });
      if (finalProducts.length - totalWithPrices > 10) {
        console.log(`   ... and ${finalProducts.length - totalWithPrices - 10} more`);
      }
    }
  }
  
  console.log('');
  console.log('✅ Price update complete!');
  console.log('');
  console.log('Products with prices can now be used for accurate quoting.');
}

updatePrices().catch(console.error);


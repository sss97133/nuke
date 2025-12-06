/**
 * DISCOVER MOTEC PRODUCT PAGES
 * 
 * Scrapes homepage to find actual product category URLs
 * Then indexes all products from those categories
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

async function discoverProductPages() {
  console.log('🔍 Discovering Motec product pages...');
  console.log('');
  
  // Scrape homepage to find product links
  const { data, error } = await supabase.functions.invoke('scrape-motec-catalog', {
    body: {
      url: 'https://www.motec.com/',
      category_name: 'Homepage Discovery'
    }
  });
  
  if (error || data.error) {
    console.error('❌ Failed to scrape homepage:', error || data.error);
    return [];
  }
  
  console.log(`✅ Found ${data.products_found || 0} products on homepage`);
  console.log('');
  
  // Try known MoTeC product pages
  const knownPages = [
    'https://www.motec.com/products',
    'https://www.motec.com/ecus',
    'https://www.motec.com/displays',
    'https://www.motec.com/sensors',
    'https://www.motec.com/software',
    'https://www.motec.com/accessories',
    'https://www.motec.com/support',
    'https://www.motec.com/catalog',
    'https://www.motec.com/shop',
  ];
  
  console.log(`📋 Trying ${knownPages.length} known product pages...`);
  console.log('');
  
  const categories = [];
  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  
  for (let i = 0; i < knownPages.length; i++) {
    const url = knownPages[i];
    const name = url.split('/').pop() || 'Products';
    
    console.log(`[${i + 1}/${knownPages.length}] ${name}`);
    console.log(`   URL: ${url}`);
    
    const result = await supabase.functions.invoke('scrape-motec-catalog', {
      body: {
        url,
        category_name: name
      }
    });
    
    if (result.error || result.data?.error) {
      console.log(`   ⚠️  Failed or no products`);
    } else if (result.data?.products_found > 0) {
      console.log(`   ✅ Found ${result.data.products_found} products`);
      console.log(`      Stored: ${result.data.stored}, Updated: ${result.data.updated}`);
      
      totalProducts += result.data.products_found;
      totalStored += result.data.stored;
      totalUpdated += result.data.updated;
      
      categories.push({ name, url, products: result.data.products_found });
    } else {
      console.log(`   ⚠️  No products found`);
    }
    
    if (i < knownPages.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('');
  }
  
  // Summary
  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Pages processed: ${knownPages.length}`);
  console.log(`Pages with products: ${categories.length}`);
  console.log(`📦 Total products found: ${totalProducts}`);
  console.log(`💾 Stored: ${totalStored}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log('');
  
  if (categories.length > 0) {
    console.log('✅ Product categories found:');
    categories.forEach(cat => {
      console.log(`   - ${cat.name}: ${cat.products} products`);
    });
  }
  
  // Check database
  const { data: source } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'Motec')
    .single();
  
  if (source) {
    const { data: parts } = await supabase
      .from('catalog_parts')
      .select('part_number, name, price_current')
      .eq('catalog_id', source.id)
      .limit(20);
    
    if (parts && parts.length > 0) {
      console.log('');
      console.log('📦 Products in database:');
      parts.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.part_number} - ${p.name}`);
        if (p.price_current) console.log(`      Price: $${p.price_current}`);
      });
    }
  }
  
  console.log('');
  console.log('✅ Discovery complete!');
}

discoverProductPages().catch(console.error);


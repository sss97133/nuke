/**
 * FULL PROWIRE WIRING CATALOG INDEXER
 * 
 * Uses edge function (which has Firecrawl API key) to scrape
 * comprehensive list of all ProWire wiring products
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

// Comprehensive list of ProWire categories to scrape
const ALL_CATEGORIES = [
  // Deutsch Connectors
  { name: 'Deutsch DT Rubber Boots', url: 'https://www.prowireusa.com/deutsch-dt-rubber-boots' },
  { name: 'Deutsch DTM Rubber Boots', url: 'https://www.prowireusa.com/deutsch-dtm-rubber-boots' },
  { name: 'Deutsch DTP Rubber Boots', url: 'https://www.prowireusa.com/deutsch-dtp-rubber-boots' },
  { name: 'Deutsch DT Heat Shrink Boots', url: 'https://www.prowireusa.com/content/9660/Deutsch%20DT%20Series%20Heat%20Shrink%20Boots' },
  { name: 'Deutsch Kit Builder', url: 'https://www.prowireusa.com/deutsch-kit-builder.html' },
  
  // Try common category patterns
  { name: 'Connectors', url: 'https://www.prowireusa.com/connectors' },
  { name: 'Terminals', url: 'https://www.prowireusa.com/terminals' },
  { name: 'Wire & Cable', url: 'https://www.prowireusa.com/wire-cable' },
  { name: 'Heat Shrink', url: 'https://www.prowireusa.com/heat-shrink' },
  { name: 'Tools', url: 'https://www.prowireusa.com/tools' },
  { name: 'Fuses', url: 'https://www.prowireusa.com/fuses' },
  { name: 'Relays', url: 'https://www.prowireusa.com/relays' },
  { name: 'Switches', url: 'https://www.prowireusa.com/switches' },
  { name: 'Grommets', url: 'https://www.prowireusa.com/grommets' },
  { name: 'Sleeving', url: 'https://www.prowireusa.com/sleeving' },
  { name: 'Crimp Tools', url: 'https://www.prowireusa.com/crimp-tools' },
  { name: 'Wire Harness', url: 'https://www.prowireusa.com/wire-harness' },
  { name: 'Cable Ties', url: 'https://www.prowireusa.com/cable-ties' },
  { name: 'Fuse Blocks', url: 'https://www.prowireusa.com/fuse-blocks' },
  { name: 'Relay Sockets', url: 'https://www.prowireusa.com/relay-sockets' },
  { name: 'Terminal Blocks', url: 'https://www.prowireusa.com/terminal-blocks' },
  { name: 'Wire Loom', url: 'https://www.prowireusa.com/wire-loom' },
  { name: 'Strain Relief', url: 'https://www.prowireusa.com/strain-relief' },
  { name: 'Pins & Sockets', url: 'https://www.prowireusa.com/pins-sockets' },
  { name: 'Splices', url: 'https://www.prowireusa.com/splices' },
  { name: 'Cable Clamps', url: 'https://www.prowireusa.com/cable-clamps' },
  
  // Search pages
  { name: 'All Products', url: 'https://www.prowireusa.com/products' },
  { name: 'Wiring Products', url: 'https://www.prowireusa.com/category/wiring' },
  { name: 'Automotive Wiring', url: 'https://www.prowireusa.com/category/automotive' },
];

async function scrapeCategory(url, categoryName) {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-prowire-catalog', {
      body: {
        url,
        category_name: categoryName
      }
    });
    
    if (error) {
      return { success: false, error: error.message, products: 0, stored: 0, updated: 0 };
    }
    
    if (data.error) {
      return { success: false, error: data.error, products: 0, stored: 0, updated: 0 };
    }
    
    return {
      success: true,
      products: data.products_found || 0,
      stored: data.stored || 0,
      updated: data.updated || 0
    };
  } catch (error) {
    return { success: false, error: error.message, products: 0, stored: 0, updated: 0 };
  }
}

async function main() {
  console.log('🚀 FULL PROWIRE WIRING CATALOG INDEXER');
  console.log('='.repeat(70));
  console.log('');
  console.log('Using edge function: scrape-prowire-catalog');
  console.log('(Edge function has access to FIRECRAWL_API_KEY from Supabase secrets)');
  console.log('');
  console.log(`📋 Scraping ${ALL_CATEGORIES.length} categories...`);
  console.log('');
  
  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const results = [];
  
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const category = ALL_CATEGORIES[i];
    console.log(`[${i + 1}/${ALL_CATEGORIES.length}] ${category.name}`);
    console.log(`   URL: ${category.url}`);
    
    const result = await scrapeCategory(category.url, category.name);
    
    if (result.success) {
      console.log(`   ✅ Found ${result.products} products`);
      console.log(`      Stored: ${result.stored}, Updated: ${result.updated}`);
      
      totalProducts += result.products;
      totalStored += result.stored;
      totalUpdated += result.updated;
      
      results.push({
        category: category.name,
        success: true,
        products: result.products,
        stored: result.stored
      });
    } else {
      // Don't count 404s as failures - category might not exist
      const is404 = result.error?.includes('404') || result.error?.includes('Not Found');
      if (!is404) {
        console.log(`   ❌ Failed: ${result.error}`);
        totalFailed++;
      } else {
        console.log(`   ⚠️  Category not found (404)`);
      }
      
      results.push({
        category: category.name,
        success: false,
        error: result.error
      });
    }
    
    // Delay between requests
    if (i < ALL_CATEGORIES.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('');
  }
  
  // Final summary
  console.log('='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log(`Categories processed: ${ALL_CATEGORIES.length}`);
  console.log(`✅ Successful: ${ALL_CATEGORIES.length - totalFailed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📦 Total products found: ${totalProducts}`);
  console.log(`💾 Stored: ${totalStored}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log('');
  
  // Database stats
  const { data: dbStats, error: dbError } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current, category, catalog_sources!inner(provider)')
    .eq('catalog_sources.provider', 'ProWire')
    .limit(1000);
  
  if (!dbError && dbStats) {
    const withPrice = dbStats.filter(p => p.price_current).length;
    const categories = [...new Set(dbStats.map(p => p.category))];
    
    console.log('📊 DATABASE STATISTICS:');
    console.log(`   Total products in database: ${dbStats.length}`);
    console.log(`   Products with prices: ${withPrice}`);
    if (categories.length > 0) {
      console.log(`   Categories: ${categories.join(', ')}`);
    }
    console.log('');
    
    // Show sample products
    if (dbStats.length > 0) {
      console.log('📦 Sample products:');
      dbStats.slice(0, 10).forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.part_number} - ${p.name}`);
        if (p.price_current) console.log(`      Price: $${p.price_current}`);
      });
    }
  }
  
  console.log('');
  console.log('✅ Full wiring catalog indexing complete!');
  console.log('');
  console.log('All products are now available in catalog_parts table');
  console.log('Use for instant wiring quotes and job estimates');
}

main().catch(console.error);


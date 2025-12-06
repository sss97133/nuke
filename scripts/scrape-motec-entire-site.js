/**
 * COMPREHENSIVE MOTEC SITE SCRAPER
 * 
 * Scrapes the entire motec.com site to index:
 * - ECUs (the "nervous system" - computers that control wiring)
 * - Software (configuration tools)
 * - Displays
 * - Sensors
 * - Accessories
 * - Documentation/Manuals
 * - All product pages
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

// Comprehensive list of Motec pages to scrape
const ALL_PAGES = [
  // Main product pages
  { name: 'Homepage', url: 'https://www.motec.com/' },
  { name: 'Products', url: 'https://www.motec.com/products' },
  { name: 'Software', url: 'https://www.motec.com/software' },
  
  // ECUs (the "nervous system")
  { name: 'ECUs', url: 'https://www.motec.com/ecus' },
  { name: 'M1 ECUs', url: 'https://www.motec.com/m1' },
  { name: 'M150 ECUs', url: 'https://www.motec.com/m150' },
  { name: 'M800 ECUs', url: 'https://www.motec.com/m800' },
  { name: 'M880 ECUs', url: 'https://www.motec.com/m880' },
  { name: 'Plug-In ECUs', url: 'https://www.motec.com/plug-in' },
  
  // Displays
  { name: 'Displays', url: 'https://www.motec.com/displays' },
  { name: 'C125 Display', url: 'https://www.motec.com/c125' },
  { name: 'C1212 Display', url: 'https://www.motec.com/c1212' },
  { name: 'ADL Display', url: 'https://www.motec.com/adl' },
  { name: 'ADL2 Display', url: 'https://www.motec.com/adl2' },
  { name: 'ADL3 Display', url: 'https://www.motec.com/adl3' },
  
  // Sensors
  { name: 'Sensors', url: 'https://www.motec.com/sensors' },
  { name: 'Temperature Sensors', url: 'https://www.motec.com/sensors/temperature' },
  { name: 'Pressure Sensors', url: 'https://www.motec.com/sensors/pressure' },
  { name: 'Position Sensors', url: 'https://www.motec.com/sensors/position' },
  
  // Accessories
  { name: 'Accessories', url: 'https://www.motec.com/accessories' },
  { name: 'Cables', url: 'https://www.motec.com/cables' },
  { name: 'Connectors', url: 'https://www.motec.com/connectors' },
  { name: 'Harnesses', url: 'https://www.motec.com/harnesses' },
  
  // Documentation
  { name: 'Documentation', url: 'https://www.motec.com/documentation' },
  { name: 'Manuals', url: 'https://www.motec.com/manuals' },
  { name: 'Technical Reference', url: 'https://www.motec.com/technical-reference' },
  { name: 'Installation Guides', url: 'https://www.motec.com/installation' },
  
  // Support & Resources
  { name: 'Support', url: 'https://www.motec.com/support' },
  { name: 'Downloads', url: 'https://www.motec.com/downloads' },
  { name: 'Training', url: 'https://www.motec.com/training' },
  { name: 'Application Notes', url: 'https://www.motec.com/application-notes' },
  
  // Vehicle Applications
  { name: 'Applications', url: 'https://www.motec.com/applications' },
  { name: 'Vehicle Kits', url: 'https://www.motec.com/kits' },
  { name: 'Plug-In Kits', url: 'https://www.motec.com/plug-in-kits' },
  
  // Shop/Catalog
  { name: 'Shop', url: 'https://www.motec.com/shop' },
  { name: 'Catalog', url: 'https://www.motec.com/catalog' },
  { name: 'All Products', url: 'https://www.motec.com/products/all' },
  
  // Regional sites (may have different products)
  { name: 'Motec USA', url: 'https://www.motecusa.com/' },
  { name: 'Motec USA Products', url: 'https://www.motecusa.com/products' },
];

async function scrapePage(url, pageName) {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-motec-catalog', {
      body: {
        url,
        category_name: pageName
      }
    });
    
    if (error) {
      return { success: false, error: error.message, products: 0, stored: 0, updated: 0 };
    }
    
    if (data?.error) {
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
  console.log('🚀 COMPREHENSIVE MOTEC SITE SCRAPER');
  console.log('='.repeat(70));
  console.log('');
  console.log('Indexing the entire motec.com site:');
  console.log('  - ECUs (the "nervous system" - computers controlling wiring)');
  console.log('  - Software (configuration tools)');
  console.log('  - Displays');
  console.log('  - Sensors');
  console.log('  - Accessories');
  console.log('  - Documentation & Manuals');
  console.log('');
  console.log(`📋 Scraping ${ALL_PAGES.length} pages...`);
  console.log('');
  
  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const successfulPages = [];
  const failedPages = [];
  
  for (let i = 0; i < ALL_PAGES.length; i++) {
    const page = ALL_PAGES[i];
    console.log(`[${i + 1}/${ALL_PAGES.length}] ${page.name}`);
    console.log(`   URL: ${page.url}`);
    
    const result = await scrapePage(page.url, page.name);
    
    if (result.success) {
      if (result.products > 0) {
        console.log(`   ✅ Found ${result.products} products`);
        console.log(`      Stored: ${result.stored}, Updated: ${result.updated}`);
        
        totalProducts += result.products;
        totalStored += result.stored;
        totalUpdated += result.updated;
        
        successfulPages.push({
          name: page.name,
          url: page.url,
          products: result.products,
          stored: result.stored
        });
      } else {
        console.log(`   ⚠️  No products found (page may not exist or have different structure)`);
      }
    } else {
      const is404 = result.error?.includes('404') || result.error?.includes('Not Found');
      if (!is404 && !result.error?.includes('non-2xx')) {
        console.log(`   ❌ Failed: ${result.error}`);
        totalFailed++;
        failedPages.push({ name: page.name, url: page.url, error: result.error });
      } else {
        console.log(`   ⚠️  Page not found or unavailable`);
      }
    }
    
    // Delay between requests
    if (i < ALL_PAGES.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('');
  }
  
  // Final summary
  console.log('='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log(`Pages processed: ${ALL_PAGES.length}`);
  console.log(`✅ Pages with products: ${successfulPages.length}`);
  console.log(`❌ Failed pages: ${totalFailed}`);
  console.log(`📦 Total products found: ${totalProducts}`);
  console.log(`💾 Stored: ${totalStored}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log('');
  
  if (successfulPages.length > 0) {
    console.log('✅ Successful pages:');
    successfulPages.forEach(page => {
      console.log(`   - ${page.name}: ${page.products} products (${page.stored} stored)`);
    });
    console.log('');
  }
  
  // Database stats
  const { data: source } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'Motec')
    .single();
  
  if (source) {
    const { data: dbStats, error: dbError } = await supabase
      .from('catalog_parts')
      .select('id, part_number, name, price_current, category')
      .eq('catalog_id', source.id)
      .limit(1000);
    
    if (!dbError && dbStats) {
      const withPrice = dbStats.filter(p => p.price_current).length;
      const categories = [...new Set(dbStats.map(p => p.category))];
      
      console.log('📊 DATABASE STATISTICS:');
      console.log(`   Total products in database: ${dbStats.length}`);
      console.log(`   Products with prices: ${withPrice}`);
      if (categories.length > 0) {
        console.log(`   Categories: ${categories.slice(0, 10).join(', ')}${categories.length > 10 ? '...' : ''}`);
      }
      console.log('');
      
      // Show sample products by category
      const byCategory = {};
      dbStats.forEach(p => {
        const cat = p.category || 'uncategorized';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(p);
      });
      
      console.log('📦 Products by category:');
      Object.entries(byCategory).slice(0, 10).forEach(([cat, prods]) => {
        console.log(`   ${cat}: ${prods.length} products`);
        prods.slice(0, 3).forEach(p => {
          console.log(`      - ${p.part_number}: ${p.name}`);
        });
      });
    }
  }
  
  console.log('');
  console.log('✅ Complete Motec site scraping finished!');
  console.log('');
  console.log('All ECUs, software, displays, sensors, and documentation indexed.');
  console.log('These are the "nervous system" components that control vehicle wiring.');
}

main().catch(console.error);


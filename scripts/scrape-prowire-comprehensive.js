/**
 * COMPREHENSIVE PROWIRE WIRING CATALOG SCRAPER
 * 
 * Uses Firecrawl search + scraping to find ALL wiring products
 * Discovers categories automatically and indexes everything
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import FirecrawlApp from '@mendable/firecrawl-js';

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

// Get Firecrawl API key
async function getFirecrawlApiKey() {
  if (process.env.FIRECRAWL_API_KEY) {
    return process.env.FIRECRAWL_API_KEY;
  }
  
  try {
    const { data } = await supabase.rpc('get_secret', { secret_name: 'FIRECRAWL_API_KEY' });
    if (data) return data;
  } catch (e) {}
  
  console.error('❌ FIRECRAWL_API_KEY not found');
  console.log('Set it in .env or Supabase secrets');
  process.exit(1);
}

async function discoverAllProductPages(firecrawl) {
  console.log('🔍 Discovering all product pages...');
  
  const categories = [];
  const searchTerms = [
    'deutsch connector',
    'wire terminal',
    'crimp connector',
    'heat shrink',
    'wire harness',
    'fuse block',
    'relay socket',
    'wire grommet',
    'cable tie',
    'wire loom'
  ];
  
  // Use Firecrawl search to find product pages
  for (const term of searchTerms) {
    try {
      console.log(`   Searching: "${term}"...`);
      
      const searchResults = await firecrawl.search(
        `${term} site:prowireusa.com`,
        { limit: 10 }
      );
      
      if (searchResults.data && searchResults.data.length > 0) {
        searchResults.data.forEach(result => {
          if (result.url && !categories.find(c => c.url === result.url)) {
            categories.push({
              name: result.title || term,
              url: result.url
            });
          }
        });
      }
      
      // Small delay between searches
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.warn(`   ⚠️  Search failed for "${term}": ${error.message}`);
    }
  }
  
  // Also scrape homepage to find category links
  try {
    console.log('   Scraping homepage for category links...');
    const homepage = await firecrawl.scrapeUrl('https://www.prowireusa.com/', {
      formats: ['html']
    });
    
    if (homepage.success && homepage.html) {
      // Extract all product category links
      const linkPattern = /href="([^"]*\/[^"]*)"[^>]*>([^<]*)/gi;
      const matches = Array.from(homepage.html.matchAll(linkPattern));
      
      for (const match of matches) {
        const url = match[1];
        const text = match[2].replace(/<[^>]+>/g, '').trim();
        
        if (url && 
            (url.includes('/deutsch') || 
             url.includes('/connector') || 
             url.includes('/terminal') ||
             url.includes('/wire') ||
             url.includes('/cable') ||
             url.includes('/tool') ||
             url.includes('/fuse') ||
             url.includes('/relay') ||
             url.includes('/switch') ||
             url.includes('/grommet') ||
             url.includes('/heat') ||
             url.includes('/sleeving'))) {
          
          const fullUrl = url.startsWith('http') ? url : `https://www.prowireusa.com${url}`;
          
          if (!categories.find(c => c.url === fullUrl)) {
            categories.push({
              name: text || url,
              url: fullUrl
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn(`   ⚠️  Homepage scrape failed: ${error.message}`);
  }
  
  console.log(`   Found ${categories.length} potential category pages`);
  return categories;
}

async function scrapeCategory(firecrawl, url, categoryName) {
  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ['html', 'markdown', 'extract'],
      extract: {
        schema: {
          type: 'object',
          properties: {
            products: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  part_number: { type: 'string' },
                  name: { type: 'string' },
                  price: { type: 'number' },
                  description: { type: 'string' },
                  image_url: { type: 'string' },
                  category: { type: 'string' }
                }
              }
            }
          }
        }
      },
      waitFor: 3000
    });
    
    if (!result.success) {
      return { success: false, products: [] };
    }
    
    let products = [];
    
    if (result.extract?.products) {
      products = result.extract.products;
    } else {
      // Parse HTML manually
      products = parseProductsFromHTML(result.html || '', result.markdown || '', categoryName);
    }
    
    return { success: true, products };
  } catch (error) {
    return { success: false, products: [], error: error.message };
  }
}

function parseProductsFromHTML(html, markdown, category) {
  const products = [];
  
  // Extract part numbers (various formats)
  const partNumberPatterns = [
    /(?:DT|DTM|DTP|RBT)[-\s]?([0-9A-Z-]+)/gi,
    /(?:Part|SKU|Item)[\s#:]*([A-Z0-9-]+)/gi,
    /([A-Z]{2,6}[-\s]?[0-9]+[A-Z0-9-]*)/gi
  ];
  
  const seenParts = new Set();
  
  for (const pattern of partNumberPatterns) {
    const matches = Array.from(html.matchAll(pattern));
    
    for (const match of matches) {
      const partNumber = match[0].replace(/\s+/g, '-').toUpperCase().trim();
      
      if (seenParts.has(partNumber) || partNumber.length < 3) continue;
      seenParts.add(partNumber);
      
      // Find context around part number
      const contextStart = Math.max(0, match.index - 300);
      const contextEnd = Math.min(html.length, match.index + 500);
      const context = html.substring(contextStart, contextEnd);
      
      // Extract name
      const nameMatch = context.match(/<[^>]*class="[^"]*(?:title|name|product)[^"]*"[^>]*>(.*?)<\/[^>]*>/i) ||
                       context.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i) ||
                       context.match(/<strong>(.*?)<\/strong>/i);
      const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : partNumber;
      
      // Extract price
      const priceMatch = context.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      
      // Extract image
      const imageMatch = context.match(/src="([^"]*\.(?:jpg|jpeg|png|webp))"/i);
      const imageUrl = imageMatch ? 
        (imageMatch[1].startsWith('http') ? imageMatch[1] : `https://www.prowireusa.com${imageMatch[1]}`) 
        : null;
      
      if (name && name.length > 2 && name.length < 200) {
        products.push({
          part_number: partNumber,
          name: name,
          price: price,
          description: null,
          image_url: imageUrl,
          category: category || 'wiring'
        });
      }
    }
    
    if (products.length > 0) break; // Found pattern that works
  }
  
  return products;
}

async function storeProducts(products, categoryName, catalogSourceId) {
  if (products.length === 0) return { stored: 0, updated: 0 };
  
  let stored = 0;
  let updated = 0;
  
  for (const product of products) {
    if (!product.part_number || !product.name) continue;
    
    // Check if exists
    const { data: existing } = await supabase
      .from('catalog_parts')
      .select('id')
      .eq('part_number', product.part_number)
      .eq('catalog_id', catalogSourceId)
      .single();
    
    if (existing) {
      // Update
      await supabase
        .from('catalog_parts')
        .update({
          name: product.name,
          price_current: product.price,
          description: product.description,
          product_image_url: product.image_url,
          category: product.category || 'wiring',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      
      updated++;
    } else {
      // Insert
      await supabase
        .from('catalog_parts')
        .insert({
          catalog_id: catalogSourceId,
          part_number: product.part_number,
          name: product.name,
          price_current: product.price,
          description: product.description,
          product_image_url: product.image_url,
          category: product.category || 'wiring',
          application_data: {
            supplier: 'ProWire USA',
            category: categoryName
          }
        });
      
      stored++;
    }
  }
  
  return { stored, updated };
}

async function main() {
  console.log('🚀 COMPREHENSIVE PROWIRE WIRING CATALOG INDEXER');
  console.log('='.repeat(70));
  console.log('');
  
  // Get Firecrawl API key
  const firecrawlApiKey = await getFirecrawlApiKey();
  const firecrawl = new FirecrawlApp({ apiKey: firecrawlApiKey });
  console.log('✅ Firecrawl initialized');
  console.log('');
  
  // Get or create catalog source
  let { data: catalogSource } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'ProWire')
    .single();
  
  if (!catalogSource) {
    const { data: newSource } = await supabase
      .from('catalog_sources')
      .insert({
        name: 'ProWire USA',
        provider: 'ProWire',
        base_url: 'https://www.prowireusa.com'
      })
      .select()
      .single();
    
    catalogSource = newSource;
  }
  
  // Step 1: Discover all categories
  console.log('📋 Step 1: Discovering all product categories...');
  const categories = await discoverAllProductPages(firecrawl);
  console.log(`   Found ${categories.length} categories to scrape`);
  console.log('');
  
  // Add known important categories
  const knownCategories = [
    { name: 'Deutsch DT Series', url: 'https://www.prowireusa.com/deutsch-dt-rubber-boots' },
    { name: 'Deutsch DTM Series', url: 'https://www.prowireusa.com/deutsch-dtm-rubber-boots' },
    { name: 'Deutsch DTP Series', url: 'https://www.prowireusa.com/deutsch-dtp-rubber-boots' },
    { name: 'Deutsch DT Heat Shrink', url: 'https://www.prowireusa.com/content/9660/Deutsch%20DT%20Series%20Heat%20Shrink%20Boots' },
    { name: 'Deutsch Kit Builder', url: 'https://www.prowireusa.com/deutsch-kit-builder.html' }
  ];
  
  // Merge and deduplicate
  const allCategories = [...knownCategories];
  for (const cat of categories) {
    if (!allCategories.find(c => c.url === cat.url)) {
      allCategories.push(cat);
    }
  }
  
  console.log(`📦 Step 2: Scraping ${allCategories.length} categories...`);
  console.log('');
  
  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  
  for (let i = 0; i < allCategories.length; i++) {
    const category = allCategories[i];
    console.log(`[${i + 1}/${allCategories.length}] ${category.name}`);
    console.log(`   URL: ${category.url}`);
    
    const result = await scrapeCategory(firecrawl, category.url, category.name);
    
    if (result.success && result.products.length > 0) {
      const storeResult = await storeProducts(result.products, category.name, catalogSource.id);
      
      console.log(`   ✅ Found ${result.products.length} products`);
      console.log(`      Stored: ${storeResult.stored}, Updated: ${storeResult.updated}`);
      
      totalProducts += result.products.length;
      totalStored += storeResult.stored;
      totalUpdated += storeResult.updated;
    } else {
      console.log(`   ⚠️  ${result.error || 'No products found'}`);
      totalFailed++;
    }
    
    // Delay between requests
    if (i < allCategories.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('');
  }
  
  // Final summary
  console.log('='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log(`Categories processed: ${allCategories.length}`);
  console.log(`✅ Successful: ${allCategories.length - totalFailed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📦 Total products found: ${totalProducts}`);
  console.log(`💾 Stored: ${totalStored}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log('');
  
  // Database stats
  const { data: dbStats } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current')
    .eq('catalog_sources.id', catalogSource.id)
    .limit(1000);
  
  if (dbStats) {
    console.log(`📊 Total products in database: ${dbStats.length}`);
    console.log(`   With prices: ${dbStats.filter(p => p.price_current).length}`);
  }
  
  console.log('');
  console.log('✅ Full wiring catalog indexing complete!');
}

main().catch(console.error);


/**
 * SCRAPE PROWIRE USA CATALOG
 * 
 * Indexes Deutsch connector products from prowireusa.com
 * Uses Firecrawl to scrape product pages and extract:
 * - Part numbers
 * - Product names
 * - Prices
 * - Descriptions
 * - Images
 * - Specifications
 * 
 * Stores in catalog_parts table for instant wiring quotes
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

// Get Firecrawl API key from multiple sources
async function getFirecrawlApiKey() {
  // 1. Check command line argument
  if (process.argv[2] && process.argv[2].startsWith('fc-')) {
    return process.argv[2];
  }
  
  // 2. Check environment variable
  if (process.env.FIRECRAWL_API_KEY) {
    return process.env.FIRECRAWL_API_KEY;
  }
  
  // 3. Try to get from Supabase vault
  try {
    const { data, error } = await supabase
      .rpc('get_secret', { secret_name: 'FIRECRAWL_API_KEY' });
    
    if (data && !error) {
      return data;
    }
  } catch (e) {
    // Vault might not be set up
  }
  
  console.error('❌ Error: FIRECRAWL_API_KEY not found');
  console.log('\n💡 Provide the API key in one of these ways:');
  console.log('   1. Command line: node scrape-prowire-catalog.js fc-your-key-here');
  console.log('   2. Environment: export FIRECRAWL_API_KEY="fc-your-key-here"');
  console.log('   3. Supabase vault: Store as FIRECRAWL_API_KEY secret');
  console.log('\n🔑 Get your API key from: https://www.firecrawl.dev/');
  process.exit(1);
}

// ProWire catalog URLs to scrape
const CATALOG_URLS = [
  {
    name: 'Deutsch DT Series Assembly Manual',
    url: 'https://www.prowireusa.com/deutsch-kit-builder.html',
    type: 'assembly_manual'
  },
  {
    name: 'Deutsch DT Series Heat Shrink Boots',
    url: 'https://www.prowireusa.com/content/9660/Deutsch%20DT%20Series%20Heat%20Shrink%20Boots',
    type: 'product_category'
  },
  {
    name: 'Deutsch DTM Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dtm-rubber-boots',
    type: 'product_category'
  },
  {
    name: 'Deutsch DT Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dt-rubber-boots',
    type: 'product_category'
  },
  {
    name: 'Deutsch DTP Rubber Boots',
    url: 'https://www.prowireusa.com/deutsch-dtp-rubber-boots',
    type: 'product_category'
  },
  {
    name: 'ProWire Homepage',
    url: 'https://www.prowireusa.com/',
    type: 'catalog_index'
  }
];

// Product extraction schema
const productSchema = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          part_number: { type: 'string', description: 'Product part number/SKU' },
          name: { type: 'string', description: 'Product name/title' },
          price: { type: 'number', description: 'Price in USD' },
          description: { type: 'string', description: 'Product description' },
          image_url: { type: 'string', description: 'Product image URL' },
          category: { type: 'string', description: 'Product category' },
          specifications: { type: 'object', description: 'Technical specifications' },
          in_stock: { type: 'boolean', description: 'Stock availability' }
        },
        required: ['part_number', 'name']
      }
    }
  }
};

async function scrapeCategoryPage(url, categoryName, firecrawl) {
  console.log(`\n🔥 Scraping: ${categoryName}`);
  console.log(`   URL: ${url}`);
  
  try {
    // Use Firecrawl to scrape the page
    const result = await firecrawl.scrapeUrl(url, {
      formats: ['html', 'markdown', 'extract'],
      extract: {
        schema: productSchema
      },
      waitFor: 3000, // Wait 3 seconds for JS to load
      onlyMainContent: false
    });
    
    if (!result.success) {
      console.error(`   ❌ Scrape failed: ${result.error || 'Unknown error'}`);
      return [];
    }
    
    // Try to extract structured products
    let products = [];
    
    if (result.extract?.products && Array.isArray(result.extract.products)) {
      products = result.extract.products;
      console.log(`   ✅ Extracted ${products.length} products via schema`);
    } else {
      // Fallback: Parse HTML manually
      console.log(`   ⚠️  Schema extraction failed, parsing HTML...`);
      products = parseProductsFromHTML(result.html || '', result.markdown || '', categoryName);
    }
    
    return products;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return [];
  }
}

function parseProductsFromHTML(html, markdown, categoryName) {
  const products = [];
  
  // Multiple patterns to try
  const patterns = [
    // Pattern 1: Product cards/divs
    /<div[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    // Pattern 2: Table rows
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
    // Pattern 3: List items
    /<li[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  ];
  
  for (const pattern of patterns) {
    const matches = Array.from(html.matchAll(pattern));
    
    for (const match of matches) {
      const productHTML = match[1] || match[0];
      
      // Extract part number (various formats)
      const partNumPatterns = [
        /(?:part[_-]?number|sku|item[_-]?number|model)[\s:]*([A-Z0-9-]+)/i,
        /DT[-\s]?([0-9]+[A-Z]?)/i,
        /DTM[-\s]?([0-9]+[A-Z]?)/i,
        /DTP[-\s]?([0-9]+[A-Z]?)/i,
        /([A-Z]{2,4}[-\s]?[0-9]+[A-Z0-9-]*)/i
      ];
      
      let partNumber = null;
      for (const p of partNumPatterns) {
        const m = productHTML.match(p);
        if (m && m[1]) {
          partNumber = m[1].trim();
          break;
        }
      }
      
      // Extract name/title
      const namePatterns = [
        /<(?:h[1-4]|div|span)[^>]*class="[^"]*(?:title|name|product[_-]?name)[^"]*"[^>]*>(.*?)<\/(?:h[1-4]|div|span)>/i,
        /<a[^>]*href="[^"]*"[^>]*>(.*?)<\/a>/i,
        /<strong>(.*?)<\/strong>/i
      ];
      
      let name = null;
      for (const p of namePatterns) {
        const m = productHTML.match(p);
        if (m && m[1]) {
          name = m[1].replace(/<[^>]+>/g, '').trim();
          if (name.length > 5 && name.length < 200) break;
        }
      }
      
      // Extract price
      const priceMatch = productHTML.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      
      // Extract image
      const imageMatch = productHTML.match(/src="([^"]*\.(?:jpg|jpeg|png|webp))"/i);
      const imageUrl = imageMatch ? 
        (imageMatch[1].startsWith('http') ? imageMatch[1] : `https://www.prowireusa.com${imageMatch[1]}`) 
        : null;
      
      // Extract description
      const descMatch = markdown.match(new RegExp(`${partNumber || name || ''}[^\\n]{20,200}`, 'i'));
      const description = descMatch ? descMatch[0].substring(0, 500) : null;
      
      if (partNumber && name) {
        products.push({
          part_number: partNumber,
          name: name,
          price: price,
          description: description,
          image_url: imageUrl,
          category: categoryName,
          in_stock: !productHTML.toLowerCase().includes('out of stock')
        });
      }
    }
    
    if (products.length > 0) break; // Found pattern that works
  }
  
  return products;
}

async function storeProducts(products, categoryName) {
  if (products.length === 0) {
    console.log(`   ⚠️  No products to store`);
    return { stored: 0, skipped: 0 };
  }
  
  // Get or create catalog source
  let { data: catalogSource } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('name', 'ProWire USA')
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
  
  let stored = 0;
  let skipped = 0;
  
  for (const product of products) {
    // Check if part already exists
    const { data: existing } = await supabase
      .from('catalog_parts')
      .select('id')
      .eq('part_number', product.part_number)
      .eq('catalog_id', catalogSource.id)
      .single();
    
    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('catalog_parts')
        .update({
          name: product.name,
          price_current: product.price,
          description: product.description,
          product_image_url: product.image_url,
          in_stock: product.in_stock,
          category: product.category,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      
      if (!error) stored++;
      else skipped++;
    } else {
      // Insert new
      const { error } = await supabase
        .from('catalog_parts')
        .insert({
          catalog_id: catalogSource.id,
          part_number: product.part_number,
          name: product.name,
          price_current: product.price,
          description: product.description,
          product_image_url: product.image_url,
          in_stock: product.in_stock,
          category: product.category || 'wiring',
          application_data: {
            supplier: 'ProWire USA',
            category: categoryName
          }
        });
      
      if (!error) stored++;
      else {
        console.warn(`   ⚠️  Failed to store ${product.part_number}: ${error?.message}`);
        skipped++;
      }
    }
  }
  
  return { stored, skipped };
}

async function crawlCatalog() {
  console.log('🚀 PROWIRE USA CATALOG SCRAPER');
  console.log('='.repeat(70));
  console.log('');
  
  // Get Firecrawl API key
  const firecrawlApiKey = await getFirecrawlApiKey();
  console.log(`✅ Firecrawl API key loaded: ${firecrawlApiKey.substring(0, 10)}...`);
  const firecrawl = new FirecrawlApp({ apiKey: firecrawlApiKey });
  console.log('');
  
  let totalProducts = 0;
  let totalStored = 0;
  let totalSkipped = 0;
  
  for (const catalog of CATALOG_URLS) {
    const products = await scrapeCategoryPage(catalog.url, catalog.name, firecrawl);
    
    if (products.length > 0) {
      console.log(`   📦 Found ${products.length} products`);
      
      const result = await storeProducts(products, catalog.name);
      totalStored += result.stored;
      totalSkipped += result.skipped;
      totalProducts += products.length;
      
      console.log(`   ✅ Stored: ${result.stored}, Skipped: ${result.skipped}`);
    }
    
    // Delay between categories
    if (catalog !== CATALOG_URLS[CATALOG_URLS.length - 1]) {
      console.log(`   ⏳ Waiting 3 seconds before next category...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total products found: ${totalProducts}`);
  console.log(`✅ Stored: ${totalStored}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log('');
  console.log('✅ Catalog scraping complete!');
  console.log('');
  console.log('Products are now available in catalog_parts table');
  console.log('Use for instant wiring quotes and job estimates');
}

// Also support crawling all product pages from homepage
async function crawlAllProducts(firecrawl) {
  console.log('\n🌐 Crawling all product pages from homepage...');
  
  try {
    // Scrape homepage to find all product category links
    const homepage = await firecrawl.scrapeUrl('https://www.prowireusa.com/', {
      formats: ['html', 'markdown']
    });
    
    if (!homepage.success) {
      console.error('❌ Failed to scrape homepage');
      return;
    }
    
    // Find all product category links
    const categoryLinks = [];
    const linkPattern = /href="([^"]*\/deutsch[^"]*)"|href="([^"]*\/product[^"]*)"|href="([^"]*\/catalog[^"]*)"/gi;
    const matches = Array.from((homepage.html || '').matchAll(linkPattern));
    
    for (const match of matches) {
      const url = match[1] || match[2] || match[3];
      if (url && !url.startsWith('#')) {
        const fullUrl = url.startsWith('http') ? url : `https://www.prowireusa.com${url}`;
        if (!categoryLinks.includes(fullUrl)) {
          categoryLinks.push(fullUrl);
        }
      }
    }
    
    console.log(`   Found ${categoryLinks.length} product category links`);
    
    // Scrape each category
    for (const link of categoryLinks.slice(0, 20)) { // Limit to 20 for now
      const products = await scrapeCategoryPage(link, 'Product Category', firecrawl);
      if (products.length > 0) {
        await storeProducts(products, 'Product Category');
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    
  } catch (error) {
    console.error('❌ Error crawling all products:', error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const crawlAll = args.includes('--all');
  
  // Get Firecrawl API key
  const firecrawlApiKey = await getFirecrawlApiKey();
  const firecrawl = new FirecrawlApp({ apiKey: firecrawlApiKey });
  
  if (crawlAll) {
    await crawlAllProducts(firecrawl);
  } else {
    await crawlCatalog();
  }
}

main().catch(console.error);


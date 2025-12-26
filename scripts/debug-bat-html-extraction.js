#!/usr/bin/env node
/**
 * Debug script to test BaT HTML extraction and see what's actually in the HTML
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const firecrawlKey = process.env.FIRECRAWL_API_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testHtmlExtraction(batUrl) {
  console.log(`\n🔍 Testing HTML extraction for: ${batUrl}\n`);

  // Test 1: Try Firecrawl
  console.log('1️⃣ Testing Firecrawl...');
  try {
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: batUrl,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 12000,
        timeout: 60000,
      }),
    });

    if (firecrawlResponse.ok) {
      const data = await firecrawlResponse.json();
      if (data?.success && data?.data?.html) {
        const html = String(data.data.html);
        console.log(`   ✅ Firecrawl success: ${html.length} chars`);
        
        // Check for data-gallery-items
        const galleryMatch = html.match(/data-gallery-items\s*=\s*["']([^"']+)["']/i);
        if (galleryMatch) {
          try {
            const decoded = galleryMatch[1]
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'")
              .replace(/&#038;/g, '&')
              .replace(/&amp;/g, '&');
            const items = JSON.parse(decoded);
            if (Array.isArray(items)) {
              console.log(`   ✅ Found data-gallery-items with ${items.length} items`);
              console.log(`   📸 Sample image URLs (first 3):`);
              items.slice(0, 3).forEach((item, i) => {
                const url = item?.full?.url || item?.original?.url || item?.large?.url || item?.small?.url;
                console.log(`      ${i + 1}. ${url || 'NO URL'}`);
              });
            } else {
              console.log(`   ⚠️  data-gallery-items is not an array`);
            }
          } catch (e) {
            console.log(`   ❌ Failed to parse data-gallery-items: ${e.message}`);
            console.log(`   📄 First 500 chars of attribute: ${galleryMatch[1].slice(0, 500)}`);
          }
        } else {
          console.log(`   ❌ data-gallery-items attribute not found in Firecrawl HTML`);
          // Check if gallery div exists
          if (html.includes('bat_listing_page_photo_gallery')) {
            console.log(`   ℹ️  But 'bat_listing_page_photo_gallery' string exists in HTML`);
          }
        }
      } else {
        console.log(`   ❌ Firecrawl returned success=false: ${JSON.stringify(data).slice(0, 200)}`);
      }
    } else {
      const errorText = await firecrawlResponse.text();
      console.log(`   ❌ Firecrawl failed: ${firecrawlResponse.status} - ${errorText.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`   ❌ Firecrawl error: ${e.message}`);
  }

  // Test 2: Try direct fetch
  console.log('\n2️⃣ Testing direct fetch...');
  try {
    const directResponse = await fetch(batUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; N-Zero Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
    const html = await directResponse.text();
    console.log(`   ✅ Direct fetch success: ${html.length} chars`);
    
    // Check for data-gallery-items
    const galleryMatch = html.match(/data-gallery-items\s*=\s*["']([^"']+)["']/i);
    if (galleryMatch) {
      try {
        const decoded = galleryMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&#038;/g, '&')
          .replace(/&amp;/g, '&');
        const items = JSON.parse(decoded);
        if (Array.isArray(items)) {
          console.log(`   ✅ Found data-gallery-items with ${items.length} items`);
        } else {
          console.log(`   ⚠️  data-gallery-items is not an array`);
        }
      } catch (e) {
        console.log(`   ❌ Failed to parse data-gallery-items: ${e.message}`);
      }
    } else {
      console.log(`   ❌ data-gallery-items attribute not found in direct fetch HTML`);
    }
  } catch (e) {
    console.log(`   ❌ Direct fetch error: ${e.message}`);
  }

  // Test 3: Call the Edge Function
  console.log('\n3️⃣ Testing Edge Function extraction...');
  try {
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: { batUrl, vehicleId: null } // Just test extraction, don't update DB
    });
    
    if (error) {
      console.log(`   ❌ Edge Function error: ${error.message}`);
    } else {
      console.log(`   ✅ Edge Function success`);
      if (data?.images) {
        console.log(`   📊 Images found: ${data.images.found || 0}`);
        console.log(`   📤 Images uploaded: ${data.images.uploaded || 0}`);
      }
    }
  } catch (e) {
    console.log(`   ❌ Edge Function exception: ${e.message}`);
  }
}

async function main() {
  const batUrl = process.argv[2] || 'https://bringatrailer.com/listing/2026-chevrolet-corvette-zr1-10/';
  await testHtmlExtraction(batUrl);
}

main().catch(console.error);


#!/usr/bin/env npx tsx
/**
 * Playwright Multi-Source Extractor
 * Uses local Playwright to extract from sources that block direct fetch/Firecrawl
 * - Cars & Bids (full data)
 * - Hagerty Marketplace
 * - eBay Motors
 * - PCarMarket (backup)
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = parseInt(process.argv[2] || '20');
const DELAY_MS = 2500;

interface ExtractedData {
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
  images?: string[];
}

async function extractCarsAndBids(page: Page, url: string): Promise<ExtractedData> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  return await page.evaluate(() => {
    const data: any = {};
    
    // Title from og:title or h1
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const h1 = document.querySelector('h1');
    data.title = ogTitle?.getAttribute('content') || h1?.textContent?.trim();
    
    // Parse year/make/model from title
    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    }
    
    // VIN - look in auction-details or body text
    const bodyText = document.body.innerText;
    const vinMatch = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();
    
    // Mileage
    const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)\b/i);
    if (mileageMatch) data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    
    // Current bid / sold price
    const bidEl = document.querySelector('[class*="bid-value"], [class*="current-bid"], [class*="sold-price"]');
    const priceMatch = (bidEl?.textContent || bodyText).match(/\$\s*([\d,]+)/);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));
    
    // Images
    const images = Array.from(document.querySelectorAll('img[src*="carsandbids"]'))
      .map(img => (img as HTMLImageElement).src)
      .filter(src => src.includes('/photos/') || src.includes('/images/'))
      .slice(0, 50);
    if (images.length) data.images = images;
    
    return data;
  });
}

async function extractHagertyMarketplace(page: Page, url: string): Promise<ExtractedData> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  return await page.evaluate(() => {
    const data: any = {};
    
    // Try __NEXT_DATA__ first (Next.js)
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const json = JSON.parse(nextData.textContent || '');
        const listing = json.props?.pageProps?.listing || json.props?.pageProps?.vehicle;
        if (listing) {
          data.year = listing.year;
          data.make = listing.make;
          data.model = listing.model;
          data.vin = listing.vin;
          data.mileage = listing.mileage;
          data.price = listing.price || listing.askingPrice;
        }
      } catch {}
    }
    
    // Fallback to DOM
    if (!data.title) {
      const h1 = document.querySelector('h1');
      data.title = h1?.textContent?.trim();
    }
    
    return data;
  });
}

async function processQueue(browser: Browser) {
  // Get pending items for blocked sources
  const { data: items } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .eq('status', 'pending')
    .or('listing_url.ilike.%carsandbids%,listing_url.ilike.%hagerty%,listing_url.ilike.%pcarmarket%')
    .limit(BATCH_SIZE);
  
  if (!items?.length) {
    console.log('No pending items for Playwright sources');
    return;
  }
  
  console.log(`Processing ${items.length} items with Playwright...`);
  
  const page = await browser.newPage();
  let processed = 0;
  let success = 0;
  
  for (const item of items) {
    try {
      // Mark as processing
      await supabase.from('import_queue').update({ status: 'processing' }).eq('id', item.id);
      
      let data: ExtractedData = {};
      const url = item.listing_url;
      
      if (url.includes('carsandbids')) {
        data = await extractCarsAndBids(page, url);
      } else if (url.includes('hagerty')) {
        data = await extractHagertyMarketplace(page, url);
      }
      
      if (data.year || data.vin || data.price) {
        // Update/create vehicle
        const vehicleData: any = {
          discovery_url: url,
          year: data.year,
          make: data.make,
          model: data.model,
          vin: data.vin,
          mileage: data.mileage,
          sale_price: data.price,
          title: data.title,
        };
        
        // Upsert vehicle
        const { data: vehicle, error } = await supabase
          .from('vehicles')
          .upsert(vehicleData, { onConflict: 'discovery_url' })
          .select('id')
          .single();
        
        if (!error) {
          await supabase.from('import_queue').update({ 
            status: 'complete', 
            vehicle_id: vehicle?.id,
            processed_at: new Date().toISOString()
          }).eq('id', item.id);
          console.log(`  ✅ ${data.year} ${data.make} ${data.model}`);
          success++;
        } else {
          throw error;
        }
      } else {
        throw new Error('No data extracted');
      }
    } catch (err: any) {
      console.log(`  ❌ ${item.listing_url.slice(0, 60)}... - ${err.message}`);
      await supabase.from('import_queue').update({ 
        status: 'failed', 
        error_message: err.message?.slice(0, 200)
      }).eq('id', item.id);
    }
    
    processed++;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  
  await page.close();
  console.log(`\nCompleted: ${success}/${processed} successful`);
}

async function main() {
  console.log('🎭 Playwright Multi-Source Extractor');
  console.log(`Batch size: ${BATCH_SIZE}\n`);
  
  const browser = await chromium.launch({ headless: true });
  
  try {
    await processQueue(browser);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

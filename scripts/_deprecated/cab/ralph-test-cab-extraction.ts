/**
 * Test C&B __NEXT_DATA__ extraction
 * This verifies we can extract VIN/mileage from Cars & Bids using Firecrawl
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

function extractCarsAndBidsFromNextData(html: string): {
  vin: string | null;
  mileage: number | null;
  title: string | null;
  images: string[];
  engine: string | null;
  transmission: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  location: string | null;
  currentBid: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
} | null {
  try {
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      console.log('⚠️ C&B: No __NEXT_DATA__ found');
      return null;
    }
    const data = JSON.parse(match[1]);
    const auction = data?.props?.pageProps?.auction;
    if (!auction) {
      console.log('⚠️ C&B: No auction data in __NEXT_DATA__');
      // Log what we found
      console.log('  pageProps keys:', Object.keys(data?.props?.pageProps || {}));
      return null;
    }

    // Log all auction keys for debugging
    console.log('  Auction keys:', Object.keys(auction));

    // Extract images from auction.photos array
    const images: string[] = [];
    if (auction.photos && Array.isArray(auction.photos)) {
      for (const photo of auction.photos) {
        if (photo.large) images.push(photo.large);
        else if (photo.medium) images.push(photo.medium);
        else if (photo.small) images.push(photo.small);
      }
    }

    // Parse mileage - could be number or string like "12,345"
    let mileage: number | null = null;
    if (auction.mileage) {
      const mileageStr = String(auction.mileage).replace(/[^0-9]/g, '');
      mileage = mileageStr ? parseInt(mileageStr, 10) : null;
    }

    // Parse year from title if not directly available
    let year: number | null = auction.year || null;
    let make: string | null = auction.make || null;
    let model: string | null = auction.model || null;

    // Try to parse from title if fields not available
    if (!year && auction.title) {
      const yearMatch = auction.title.match(/^(\d{4})\s+/);
      if (yearMatch) year = parseInt(yearMatch[1], 10);
    }

    return {
      vin: auction.vin || null,
      mileage,
      title: auction.title || null,
      images,
      engine: auction.engine || null,
      transmission: auction.transmission || null,
      exteriorColor: auction.exteriorColor || auction.exterior_color || auction.color || null,
      interiorColor: auction.interiorColor || auction.interior_color || null,
      location: auction.location || null,
      currentBid: auction.currentBid || auction.current_bid || auction.highBid || null,
      year,
      make,
      model,
    };
  } catch (e) {
    console.error('⚠️ C&B: Error parsing __NEXT_DATA__:', e);
    return null;
  }
}

async function fetchWithFirecrawl(url: string): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) {
    console.error('❌ FIRECRAWL_API_KEY not set');
    return null;
  }

  try {
    console.log(`🔥 Fetching ${url} with Firecrawl...`);
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['html'],
        waitFor: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Firecrawl error: ${response.status} - ${error}`);
      return null;
    }

    const data = await response.json();
    if (data.success && data.data?.html) {
      console.log(`✅ Firecrawl returned ${data.data.html.length} chars`);
      return data.data.html;
    }
    console.error('❌ Firecrawl returned no HTML');
    return null;
  } catch (e) {
    console.error('❌ Firecrawl fetch error:', e);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║    TEST C&B __NEXT_DATA__ EXTRACTION               ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get some C&B URLs from the import queue
  const { data: cabItems, error } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .like('listing_url', '%carsandbids.com%')
    .eq('status', 'pending')
    .limit(5);

  if (error || !cabItems?.length) {
    console.log('No C&B items in queue, using test URLs');
    // Use test URLs
    const testUrls = [
      'https://carsandbids.com/auctions/9V3aMgEN/1984-chevrolet-corvette-coupe',
    ];

    for (const url of testUrls) {
      console.log(`\n=== Testing: ${url} ===`);
      const html = await fetchWithFirecrawl(url);
      if (html) {
        const data = extractCarsAndBidsFromNextData(html);
        if (data) {
          console.log('\n📊 Extracted data:');
          console.log(`  VIN: ${data.vin || '❌ NOT FOUND'}`);
          console.log(`  Mileage: ${data.mileage || '❌ NOT FOUND'}`);
          console.log(`  Title: ${data.title || 'N/A'}`);
          console.log(`  Year: ${data.year || 'N/A'}`);
          console.log(`  Make: ${data.make || 'N/A'}`);
          console.log(`  Model: ${data.model || 'N/A'}`);
          console.log(`  Engine: ${data.engine || 'N/A'}`);
          console.log(`  Transmission: ${data.transmission || 'N/A'}`);
          console.log(`  Ext Color: ${data.exteriorColor || 'N/A'}`);
          console.log(`  Int Color: ${data.interiorColor || 'N/A'}`);
          console.log(`  Location: ${data.location || 'N/A'}`);
          console.log(`  Current Bid: ${data.currentBid || 'N/A'}`);
          console.log(`  Images: ${data.images.length}`);
        } else {
          console.log('❌ Failed to extract data from __NEXT_DATA__');
        }
      }
    }
    return;
  }

  console.log(`Found ${cabItems.length} C&B items in queue\n`);

  for (const item of cabItems) {
    console.log(`\n=== Testing: ${item.listing_url} ===`);
    const html = await fetchWithFirecrawl(item.listing_url);
    if (html) {
      const data = extractCarsAndBidsFromNextData(html);
      if (data) {
        console.log('\n📊 Extracted data:');
        console.log(`  VIN: ${data.vin || '❌ NOT FOUND'}`);
        console.log(`  Mileage: ${data.mileage || '❌ NOT FOUND'}`);
        console.log(`  Title: ${data.title || 'N/A'}`);
        console.log(`  Engine: ${data.engine || 'N/A'}`);
        console.log(`  Transmission: ${data.transmission || 'N/A'}`);
        console.log(`  Images: ${data.images.length}`);
      } else {
        console.log('❌ Failed to extract data from __NEXT_DATA__');
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(console.error);

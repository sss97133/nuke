/**
 * BACKFILL Cars & Bids Vehicles
 *
 * C&B vehicles are missing VIN, mileage, images because:
 * 1. Direct fetch fails (403)
 * 2. Current extraction doesn't properly parse __NEXT_DATA__
 *
 * This script:
 * 1. Finds C&B vehicles missing data
 * 2. Uses Firecrawl to get the page (with JS rendering)
 * 3. Parses __NEXT_DATA__ for all vehicle data
 * 4. Updates the vehicle profile
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

interface CabAuctionData {
  title?: string;
  mileage?: number | string;
  vin?: string;
  color?: string;
  exteriorColor?: string;
  interiorColor?: string;
  transmission?: string;
  engine?: string;
  location?: string;
  images?: Array<{ url: string } | string>;
  photos?: Array<{ url: string } | string>;
  gallery?: Array<{ url: string } | string>;
  comments?: any[];
  bids?: any[];
  highlights?: string;
  equipment?: string;
  modifications?: string;
  known_flaws?: string;
  seller_notes?: string;
}

async function extractNextData(html: string): Promise<CabAuctionData | null> {
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) {
    console.log('  No __NEXT_DATA__ found');
    return null;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);

    // Try multiple paths to find auction data
    const auction =
      nextData?.props?.pageProps?.auction ||
      nextData?.props?.pageProps?.data?.auction ||
      nextData?.props?.pageProps?.listing ||
      nextData?.props?.auction ||
      nextData?.auction ||
      nextData?.props?.pageProps;

    if (!auction) {
      console.log('  No auction data found in __NEXT_DATA__');
      console.log('  pageProps keys:', Object.keys(nextData?.props?.pageProps || {}));
      return null;
    }

    console.log('  ✅ Found auction data. Keys:', Object.keys(auction).slice(0, 15).join(', '));
    return auction;
  } catch (e: any) {
    console.log('  Failed to parse __NEXT_DATA__:', e.message);
    return null;
  }
}

function extractImages(auction: CabAuctionData): string[] {
  const images: string[] = [];

  // Try multiple image sources
  const imageSources = [
    auction.images,
    auction.photos,
    auction.gallery,
  ].filter(Boolean);

  for (const source of imageSources) {
    if (!Array.isArray(source)) continue;

    for (const img of source) {
      let url: string | null = null;

      if (typeof img === 'string') {
        url = img;
      } else if (typeof img === 'object' && img !== null) {
        url = img.url || (img as any).src || (img as any).large || (img as any).original;
      }

      if (url && typeof url === 'string' && url.startsWith('http')) {
        // Clean up CDN URLs to get full resolution
        // C&B uses: /cdn-cgi/image/width=80,height=80/...
        const cleanUrl = url.replace(/\/cdn-cgi\/image\/[^/]+\//g, '/');
        images.push(cleanUrl);
      }
    }
  }

  return [...new Set(images)]; // Deduplicate
}

async function fetchWithFirecrawl(url: string): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) {
    console.log('  No FIRECRAWL_API_KEY set');
    return null;
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['html'],
        waitFor: 3000, // Wait for JS to render
        onlyMainContent: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  Firecrawl error: ${response.status} - ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    if (!data.success) {
      console.log('  Firecrawl returned error:', data.error);
      return null;
    }

    return data.data?.html || null;
  } catch (e: any) {
    console.log('  Firecrawl exception:', e.message);
    return null;
  }
}

async function backfillVehicle(vehicle: any): Promise<boolean> {
  console.log(`\n📋 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url}`);

  // Try direct fetch first (might work for some pages)
  let html: string | null = null;

  try {
    const directResponse = await fetch(vehicle.discovery_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (directResponse.ok) {
      html = await directResponse.text();
      console.log(`  Direct fetch: ${html.length} chars`);
    } else {
      console.log(`  Direct fetch failed: ${directResponse.status}`);
    }
  } catch (e: any) {
    console.log(`  Direct fetch error: ${e.message}`);
  }

  // Fallback to Firecrawl if direct fetch failed or returned too little
  if (!html || html.length < 5000 || !html.includes('__NEXT_DATA__')) {
    console.log('  Trying Firecrawl...');
    html = await fetchWithFirecrawl(vehicle.discovery_url);
    if (html) {
      console.log(`  Firecrawl: ${html.length} chars`);
    }
  }

  if (!html) {
    console.log('  ❌ Could not fetch page');
    return false;
  }

  // Extract data from __NEXT_DATA__
  const auction = await extractNextData(html);
  if (!auction) {
    return false;
  }

  // Build updates
  const updates: any = {};
  let hasUpdates = false;

  // Extract mileage
  if (!vehicle.mileage && auction.mileage) {
    const mileage = typeof auction.mileage === 'string'
      ? parseInt(auction.mileage.replace(/[^0-9]/g, ''), 10)
      : auction.mileage;
    if (mileage && mileage > 0) {
      updates.mileage = mileage;
      hasUpdates = true;
      console.log(`  ✅ Mileage: ${mileage}`);
    }
  }

  // Extract VIN
  if (!vehicle.vin && auction.vin) {
    updates.vin = auction.vin;
    hasUpdates = true;
    console.log(`  ✅ VIN: ${auction.vin}`);
  }

  // Extract color
  if (!vehicle.color && (auction.color || auction.exteriorColor)) {
    updates.color = auction.color || auction.exteriorColor;
    hasUpdates = true;
    console.log(`  ✅ Color: ${updates.color}`);
  }

  // Extract interior color
  if (!vehicle.interior_color && auction.interiorColor) {
    updates.interior_color = auction.interiorColor;
    hasUpdates = true;
  }

  // Extract transmission
  if (!vehicle.transmission && auction.transmission) {
    updates.transmission = auction.transmission;
    hasUpdates = true;
    console.log(`  ✅ Transmission: ${auction.transmission}`);
  }

  // Extract engine
  if (!vehicle.engine_size && auction.engine) {
    updates.engine_size = auction.engine;
    hasUpdates = true;
  }

  // Extract location
  if (!vehicle.location && auction.location) {
    updates.location = auction.location;
    hasUpdates = true;
  }

  // Extract images
  const images = extractImages(auction);
  console.log(`  Images found: ${images.length}`);

  // Update vehicle if we have changes
  if (hasUpdates) {
    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);

    if (updateError) {
      console.log(`  ❌ Update failed: ${updateError.message}`);
      return false;
    }
    console.log(`  ✅ Vehicle updated`);
  }

  // Insert images
  if (images.length > 0) {
    // Check existing images
    const { count: existingCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    if ((existingCount || 0) < images.length) {
      const imageRows = images.slice(0, 100).map((url, idx) => ({
        vehicle_id: vehicle.id,
        image_url: url,
        display_order: idx,
        source: 'cars_and_bids',
        created_at: new Date().toISOString(),
      }));

      const { error: imageError } = await supabase
        .from('vehicle_images')
        .upsert(imageRows, { onConflict: 'vehicle_id,image_url', ignoreDuplicates: true });

      if (imageError) {
        console.log(`  ⚠️ Image insert failed: ${imageError.message}`);
      } else {
        console.log(`  ✅ Inserted ${imageRows.length} images`);
      }
    }
  }

  return hasUpdates || images.length > 0;
}

async function main() {
  console.log('=== BACKFILL Cars & Bids Vehicles ===\n');

  if (!FIRECRAWL_API_KEY) {
    console.log('⚠️ FIRECRAWL_API_KEY not set - will only try direct fetch');
  }

  // Find C&B vehicles missing data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, transmission, engine_size, location, discovery_url')
    .ilike('discovery_url', '%carsandbids%')
    .or('vin.is.null,mileage.is.null')
    .limit(10); // Process in small batches

  if (error) {
    console.log('❌ Query error:', error.message);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} C&B vehicles needing backfill\n`);

  let updated = 0;
  let failed = 0;

  for (const vehicle of vehicles || []) {
    try {
      const success = await backfillVehicle(vehicle);
      if (success) updated++;
      else failed++;
    } catch (e: any) {
      console.log(`  ❌ Exception: ${e.message}`);
      failed++;
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);

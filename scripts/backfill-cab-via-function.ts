/**
 * BACKFILL Cars & Bids Vehicles via Supabase Function
 *
 * Uses the existing scrape-vehicle-with-firecrawl function which has
 * valid API keys configured in Supabase secrets.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function scrapeViaFunction(url: string): Promise<any> {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle-with-firecrawl', {
      body: { url, return_html: true },
    });

    if (error) {
      console.log(`  Function error: ${error.message}`);
      return null;
    }

    return data;
  } catch (e: any) {
    console.log(`  Function exception: ${e.message}`);
    return null;
  }
}

function extractFromNextData(html: string): any | null {
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) {
    return null;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const auction =
      nextData?.props?.pageProps?.auction ||
      nextData?.props?.pageProps?.data?.auction ||
      nextData?.props?.pageProps?.listing ||
      nextData?.props?.auction ||
      nextData?.auction;
    return auction;
  } catch {
    return null;
  }
}

function extractImages(auction: any): string[] {
  const images: string[] = [];
  const sources = [auction?.images, auction?.photos, auction?.gallery].filter(Boolean);

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const img of source) {
      const url = typeof img === 'string' ? img : img?.url || img?.src;
      if (url && typeof url === 'string' && url.startsWith('http')) {
        images.push(url.replace(/\/cdn-cgi\/image\/[^/]+\//g, '/'));
      }
    }
  }

  return [...new Set(images)];
}

async function backfillVehicle(vehicle: any): Promise<boolean> {
  console.log(`\n📋 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url}`);

  // Call the Supabase function
  const result = await scrapeViaFunction(vehicle.discovery_url);

  if (!result) {
    console.log('   ❌ Scrape failed');
    return false;
  }

  // Check if we got HTML with __NEXT_DATA__
  const html = result.html || '';
  if (!html.includes('__NEXT_DATA__')) {
    console.log(`   ❌ No __NEXT_DATA__ in response (${html.length} chars)`);

    // Check if the function returned extracted data directly
    if (result.vehicle) {
      console.log('   ✅ Function returned vehicle data directly');
      const v = result.vehicle;

      // Update vehicle with extracted data
      const updates: any = {};
      if (!vehicle.vin && v.vin) updates.vin = v.vin;
      if (!vehicle.mileage && v.mileage) updates.mileage = v.mileage;
      if (!vehicle.color && v.color) updates.color = v.color;
      if (!vehicle.transmission && v.transmission) updates.transmission = v.transmission;
      if (!vehicle.engine_size && v.engine_size) updates.engine_size = v.engine_size;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        const { error } = await supabase.from('vehicles').update(updates).eq('id', vehicle.id);
        if (error) {
          console.log(`   ❌ Update failed: ${error.message}`);
        } else {
          console.log(`   ✅ Updated: ${Object.keys(updates).join(', ')}`);
          return true;
        }
      }
    }

    return false;
  }

  console.log(`   ✅ Got HTML with __NEXT_DATA__ (${html.length} chars)`);

  // Parse __NEXT_DATA__
  const auction = extractFromNextData(html);
  if (!auction) {
    console.log('   ❌ Could not find auction data in __NEXT_DATA__');
    return false;
  }

  console.log(`   Auction keys: ${Object.keys(auction).slice(0, 10).join(', ')}`);

  // Build updates
  const updates: any = {};

  if (!vehicle.vin && auction.vin) {
    updates.vin = auction.vin;
    console.log(`   VIN: ${auction.vin}`);
  }

  if (!vehicle.mileage && auction.mileage) {
    const mileage = typeof auction.mileage === 'string'
      ? parseInt(auction.mileage.replace(/[^0-9]/g, ''), 10)
      : auction.mileage;
    if (mileage > 0) {
      updates.mileage = mileage;
      console.log(`   Mileage: ${mileage}`);
    }
  }

  if (!vehicle.color && (auction.color || auction.exteriorColor)) {
    updates.color = auction.color || auction.exteriorColor;
    console.log(`   Color: ${updates.color}`);
  }

  if (!vehicle.transmission && auction.transmission) {
    updates.transmission = auction.transmission;
    console.log(`   Transmission: ${auction.transmission}`);
  }

  if (!vehicle.engine_size && auction.engine) {
    updates.engine_size = auction.engine;
    console.log(`   Engine: ${auction.engine}`);
  }

  // Extract images
  const images = extractImages(auction);
  console.log(`   Images: ${images.length}`);

  // Update vehicle
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase.from('vehicles').update(updates).eq('id', vehicle.id);
    if (error) {
      console.log(`   ❌ Update failed: ${error.message}`);
      return false;
    }
    console.log(`   ✅ Vehicle updated`);
  }

  // Insert images
  if (images.length > 0) {
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

      const { error: imgError } = await supabase
        .from('vehicle_images')
        .upsert(imageRows, { onConflict: 'vehicle_id,image_url', ignoreDuplicates: true });

      if (imgError) {
        console.log(`   ⚠️ Image insert error: ${imgError.message}`);
      } else {
        console.log(`   ✅ Inserted ${imageRows.length} images`);
      }
    }
  }

  return Object.keys(updates).length > 0 || images.length > 0;
}

async function main() {
  console.log('=== BACKFILL C&B via Supabase Function ===\n');

  // Find C&B vehicles missing data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, transmission, engine_size, discovery_url')
    .ilike('discovery_url', '%carsandbids%')
    .or('vin.is.null,mileage.is.null')
    .limit(5);

  if (error) {
    console.log('❌ Query error:', error.message);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} C&B vehicles to backfill\n`);

  let updated = 0;
  let failed = 0;

  for (const vehicle of vehicles || []) {
    try {
      const success = await backfillVehicle(vehicle);
      if (success) updated++;
      else failed++;
    } catch (e: any) {
      console.log(`   ❌ Exception: ${e.message}`);
      failed++;
    }

    // Rate limit - Firecrawl has limits
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);

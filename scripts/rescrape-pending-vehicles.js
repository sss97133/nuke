#!/usr/bin/env node

/**
 * Re-scrape pending vehicles to get fresh data and images
 * Uses the scrape-vehicle edge function which uses Firecrawl
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function rescrapeVehicle(vehicle) {
  console.log(`\nRe-scraping: ${vehicle.id}`);
  console.log(`  URL: ${vehicle.discovery_url?.substring(0, 60)}`);
  
  try {
    // Call scrape-vehicle edge function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ url: vehicle.discovery_url })
    });

    if (!response.ok) {
      console.log(`  Scrape failed: ${response.status}`);
      return false;
    }

    const result = await response.json();
    
    if (!result.success) {
      console.log(`  Scrape error: ${result.error}`);
      return false;
    }

    const data = result.data;
    console.log(`  Scraped: ${data.year} ${data.make} ${data.model}`);
    console.log(`  Auction: ${data.auction_outcome || 'unknown'} - High bid: $${data.high_bid || 'N/A'}`);
    console.log(`  Images found: ${data.images?.length || 0}`);
    
    // Create auction_event record if we have auction data
    if (data.auction_outcome && (data.auction_outcome !== 'pending')) {
      const auctionEvent = {
        vehicle_id: vehicle.id,
        source: data.source?.toLowerCase().includes('trailer') ? 'bat' : data.source?.toLowerCase() || 'unknown',
        source_url: data.listing_url || vehicle.discovery_url,
        lot_number: data.lot_number,
        auction_end_date: data.sale_date || data.auction_end_date,
        outcome: data.auction_outcome,
        high_bid: data.high_bid,
        winning_bid: data.winning_bid,
        total_bids: data.bid_count,
        high_bidder: data.high_bidder,
        winning_bidder: data.buyer,
        seller_name: data.seller,
        estimate_low: data.estimate_low,
        estimate_high: data.estimate_high,
        reserve_gap_pct: data.reserve_gap_pct ? parseFloat(data.reserve_gap_pct) : null,
        scraped_at: new Date().toISOString()
      };
      
      const { error: auctionError } = await supabase
        .from('auction_events')
        .upsert(auctionEvent, { 
          onConflict: 'vehicle_id,source_url',
          ignoreDuplicates: false 
        });
      
      if (auctionError) {
        console.log(`  Auction event error: ${auctionError.message}`);
      } else {
        console.log(`  Auction event created: ${data.auction_outcome}`);
      }
    }

    // Update vehicle with fresh data
    const updates = {
      year: data.year || vehicle.year,
      make: data.make || vehicle.make,
      model: data.model || vehicle.model,
      trim: data.trim,
      mileage: data.mileage,
      asking_price: data.price,
      vin: data.vin,
      body_style: data.body_style,
      drivetrain: data.drivetrain,
      engine_type: data.engine_type,
      origin_metadata: {
        ...vehicle.origin_metadata,
        ...data,
        rescrape_date: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    };

    // Remove null/undefined values
    Object.keys(updates).forEach(key => {
      if (updates[key] === null || updates[key] === undefined) {
        delete updates[key];
      }
    });

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);

    if (updateError) {
      console.log(`  Update failed: ${updateError.message}`);
      return false;
    }

    // Download and upload images if we have them
    if (data.images && data.images.length > 0) {
      console.log(`  Downloading ${Math.min(data.images.length, 15)} images...`);
      console.log(`  First image URL: ${data.images[0]?.substring(0, 80)}`);
      
      let uploadedCount = 0;
      for (let i = 0; i < Math.min(data.images.length, 15); i++) {
        const imageUrl = data.images[i];
        
        try {
          const imgResponse = await fetch(imageUrl);
          if (!imgResponse.ok) {
            console.log(`    Image ${i + 1} fetch failed: ${imgResponse.status}`);
            continue;
          }
          
          const blob = await imgResponse.blob();
          const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
          const ext = contentType.includes('png') ? 'png' : 'jpg';
          const filename = `rescrape_${Date.now()}_${i}.${ext}`;
          const storagePath = `${vehicle.id}/${filename}`;
          
          const { error: uploadError } = await supabase.storage
            .from('vehicle-images')
            .upload(storagePath, blob, { contentType });
          
          if (uploadError) {
            console.log(`    Image ${i + 1} upload failed: ${uploadError.message}`);
            continue;
          }
          
          const { data: { publicUrl } } = supabase.storage
            .from('vehicle-images')
            .getPublicUrl(storagePath);
          
          // Create image record
          const { error: dbError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicle.id,
              user_id: '13450c45-3e8b-4124-9f5b-5c512094ff04', // skylar@nukemannerheim.com
              image_url: publicUrl,
              storage_path: storagePath,
              source: 'rescrape',
              is_primary: i === 0
            });
          
          if (!dbError) uploadedCount++;
          
          // Rate limit
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.log(`    Image ${i + 1} error: ${err.message}`);
        }
      }
      
      console.log(`  Uploaded: ${uploadedCount} images`);
      
      // Set to active if we have images
      if (uploadedCount > 0) {
        await supabase
          .from('vehicles')
          .update({ status: 'active' })
          .eq('id', vehicle.id);
        console.log(`  Status: active`);
      }
    }

    return true;
  } catch (error) {
    console.log(`  Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('RE-SCRAPE PENDING VEHICLES');
  console.log('='.repeat(60));
  
  // Get pending scraped vehicles - focus on sources that work
  // Skip Hemmings (500 errors) and ClassicCarDeals (inventory pages)
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('status', 'pending')
    .not('discovery_url', 'is', null)
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%cars.ksl.com/listing/%,discovery_url.ilike.%classiccars.com/listings/view%')
    .order('created_at', { ascending: false })
    .limit(20); // Process 20 at a time
  
  if (error) {
    console.error('Failed to fetch vehicles:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} pending scraped vehicles to re-scrape`);
  
  let success = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const result = await rescrapeVehicle(vehicle);
    if (result) success++;
    else failed++;
    
    // Rate limit between vehicles (Firecrawl has limits)
    await new Promise(r => setTimeout(r, 5000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Success: ${success}, Failed: ${failed}`);
}

main().catch(console.error);


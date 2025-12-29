// RE-EXTRACT: Update existing vehicle profiles from BaT
// Does NOT overwrite user data - only fills gaps and updates auction telemetry
//
// Modes:
// 1. Single vehicle: { vehicle_id: "uuid" }
// 2. Batch by criteria: { batch: true, limit: 50, criteria: "missing_price" | "missing_images" | "stale" }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Call bat-simple-extract to get fresh data
async function extractFromBat(url: string): Promise<any> {
  const extractUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bat-simple-extract`;
  const response = await fetch(extractUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ url, save_to_db: false }),
  });
  
  if (!response.ok) {
    throw new Error(`Extract failed: ${response.status}`);
  }
  
  const result = await response.json();
  return result.extracted;
}

// Update a single vehicle with extracted data
async function updateVehicle(vehicleId: string, batUrl: string): Promise<{ success: boolean; changes: string[] }> {
  const changes: string[] = [];
  
  // Get current vehicle data
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (fetchError || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleId}`);
  }
  
  // Extract fresh data from BaT
  console.log(`Extracting from: ${batUrl}`);
  const extracted = await extractFromBat(batUrl);
  
  if (!extracted) {
    throw new Error('Extraction returned no data');
  }
  
  // Build update payload - only update NULL/empty fields or auction telemetry
  const updates: Record<string, any> = {};
  
  // Always update auction telemetry (these are live metrics)
  if (extracted.sale_price) {
    updates.sale_price = extracted.sale_price;
    if (vehicle.sale_price !== extracted.sale_price) changes.push(`sale_price: ${vehicle.sale_price} -> ${extracted.sale_price}`);
  }
  if (extracted.bid_count !== undefined) {
    updates.bat_bids = extracted.bid_count;
    if (vehicle.bat_bids !== extracted.bid_count) changes.push(`bat_bids: ${vehicle.bat_bids} -> ${extracted.bid_count}`);
  }
  if (extracted.comment_count !== undefined) {
    updates.bat_comments = extracted.comment_count;
    if (vehicle.bat_comments !== extracted.comment_count) changes.push(`bat_comments: ${vehicle.bat_comments} -> ${extracted.comment_count}`);
  }
  if (extracted.view_count !== undefined) {
    updates.bat_views = extracted.view_count;
    if (vehicle.bat_views !== extracted.view_count) changes.push(`bat_views: ${vehicle.bat_views} -> ${extracted.view_count}`);
  }
  if (extracted.watcher_count !== undefined) {
    updates.bat_watchers = extracted.watcher_count;
    changes.push(`bat_watchers: ${extracted.watcher_count}`);
  }
  if (extracted.lot_number) {
    updates.bat_lot_number = extracted.lot_number;
    changes.push(`bat_lot_number: ${extracted.lot_number}`);
  }
  
  // Update buyer/seller if missing
  if (!vehicle.bat_seller && extracted.seller_username) {
    updates.bat_seller = extracted.seller_username;
    changes.push(`bat_seller: ${extracted.seller_username}`);
  }
  if (!vehicle.bat_buyer && extracted.buyer_username) {
    updates.bat_buyer = extracted.buyer_username;
    changes.push(`bat_buyer: ${extracted.buyer_username}`);
  }
  
  // Update specs only if currently NULL
  if (!vehicle.transmission && extracted.transmission) {
    updates.transmission = extracted.transmission;
    changes.push(`transmission: ${extracted.transmission}`);
  }
  if (!vehicle.drivetrain && extracted.drivetrain) {
    updates.drivetrain = extracted.drivetrain;
    changes.push(`drivetrain: ${extracted.drivetrain}`);
  }
  if (!vehicle.color && extracted.exterior_color) {
    updates.color = extracted.exterior_color;
    changes.push(`color: ${extracted.exterior_color}`);
  }
  if (!vehicle.interior_color && extracted.interior_color) {
    updates.interior_color = extracted.interior_color;
    changes.push(`interior_color: ${extracted.interior_color}`);
  }
  if (!vehicle.engine_type && extracted.engine) {
    updates.engine_type = extracted.engine;
    changes.push(`engine_type: ${extracted.engine}`);
  }
  if (!vehicle.body_style && extracted.body_style) {
    updates.body_style = extracted.body_style;
    changes.push(`body_style: ${extracted.body_style}`);
  }
  if (!vehicle.mileage && extracted.mileage) {
    updates.mileage = extracted.mileage;
    changes.push(`mileage: ${extracted.mileage}`);
  }
  if (!vehicle.bat_location && extracted.location) {
    updates.bat_location = extracted.location;
    changes.push(`bat_location: ${extracted.location}`);
  }
  if (!vehicle.auction_end_date && extracted.auction_end_date) {
    updates.auction_end_date = extracted.auction_end_date;
    changes.push(`auction_end_date: ${extracted.auction_end_date}`);
  }
  if (!vehicle.description && extracted.description) {
    updates.description = extracted.description;
    changes.push(`description: added (${extracted.description.length} chars)`);
  }
  if (!vehicle.reserve_status && extracted.reserve_status) {
    updates.reserve_status = extracted.reserve_status;
    changes.push(`reserve_status: ${extracted.reserve_status}`);
  }
  
  // Store the original listing title for reference (not for display)
  if (extracted.title && !vehicle.bat_listing_title) {
    updates.bat_listing_title = extracted.title;
    changes.push(`bat_listing_title: stored for reference`);
  }
  
  // Update sale_status based on price
  if (extracted.sale_price && vehicle.sale_status !== 'sold') {
    updates.sale_status = 'sold';
    changes.push(`sale_status: sold`);
  }
  
  // Apply updates
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);
    
    if (updateError) {
      throw new Error(`Update failed: ${updateError.message}`);
    }
  }
  
  // Handle images - add any missing ones
  if (extracted.image_urls && extracted.image_urls.length > 0) {
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', vehicleId);
    
    const existingUrls = new Set((existingImages || []).map((i: any) => i.image_url));
    const newImages = extracted.image_urls.filter((url: string) => !existingUrls.has(url));
    
    if (newImages.length > 0) {
      const maxPosition = existingImages?.length || 0;
      const imageRecords = newImages.map((url: string, i: number) => ({
        vehicle_id: vehicleId,
        image_url: url,
        position: maxPosition + i,
        source: 'bat_reextract',
        is_external: true,
      }));
      
      const { error: imgError } = await supabase
        .from('vehicle_images')
        .insert(imageRecords);
      
      if (!imgError) {
        changes.push(`images: added ${newImages.length} new (${existingUrls.size} existing)`);
      }
    }
  }
  
  // Handle comments - add if none exist
  if (extracted.comments && extracted.comments.length > 0) {
    const { count } = await supabase
      .from('auction_comments')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    if (!count || count === 0) {
      const commentRecords = extracted.comments.map((c: any, i: number) => ({
        vehicle_id: vehicleId,
        platform: 'bat',
        source_url: batUrl,
        comment_type: c.type,
        sequence_number: i + 1,
        author_username: c.author_username,
        is_seller: c.is_seller,
        posted_at: c.posted_at,
        comment_text: c.text,
        bid_amount: c.bid_amount,
        comment_likes: c.likes,
      }));
      
      // Insert in batches
      for (let i = 0; i < commentRecords.length; i += 100) {
        const batch = commentRecords.slice(i, i + 100);
        await supabase.from('auction_comments').insert(batch);
      }
      changes.push(`comments: added ${commentRecords.length}`);
    }
  }
  
  // Update external_listings if exists, or create
  const { data: existingListing } = await supabase
    .from('external_listings')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'bat')
    .maybeSingle();
  
  const listingData = {
    vehicle_id: vehicleId,
    platform: 'bat',
    listing_url: batUrl,
    listing_id: extracted.lot_number,
    listing_status: extracted.sale_price ? 'sold' : 'ended',
    end_date: extracted.auction_end_date,
    final_price: extracted.sale_price,
    bid_count: extracted.bid_count,
    view_count: extracted.view_count,
    watcher_count: extracted.watcher_count,
    sold_at: extracted.sale_price ? extracted.auction_end_date : null,
    metadata: {
      lot_number: extracted.lot_number,
      seller_username: extracted.seller_username,
      buyer_username: extracted.buyer_username,
      reserve_status: extracted.reserve_status,
    },
  };
  
  if (existingListing) {
    await supabase
      .from('external_listings')
      .update(listingData)
      .eq('id', existingListing.id);
    changes.push(`external_listings: updated`);
  } else {
    await supabase
      .from('external_listings')
      .insert(listingData);
    changes.push(`external_listings: created`);
  }
  
  return { success: true, changes };
}

// Find vehicles that need fixing
async function findVehiclesToFix(criteria: string, limit: number): Promise<any[]> {
  let query = supabase
    .from('vehicles')
    .select('id, bat_auction_url, year, make, model, sale_price, bat_bids, bat_views')
    .not('bat_auction_url', 'is', null);
  
  switch (criteria) {
    case 'missing_price':
      // Has BaT URL but no sale price
      query = query.is('sale_price', null);
      break;
    case 'missing_images':
      // Would need a join - simplified for now
      break;
    case 'missing_seller':
      query = query.is('bat_seller', null);
      break;
    case 'missing_specs':
      query = query.or('transmission.is.null,drivetrain.is.null,color.is.null');
      break;
    case 'stale':
      // Updated more than 7 days ago
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 7);
      query = query.lt('updated_at', staleDate.toISOString());
      break;
    default:
      // All BaT vehicles
      break;
  }
  
  const { data, error } = await query.limit(limit);
  
  if (error) throw error;
  return data || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const results: any[] = [];
    
    if (body.vehicle_id) {
      // Single vehicle mode
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('id, bat_auction_url')
        .eq('id', body.vehicle_id)
        .single();
      
      if (!vehicle?.bat_auction_url) {
        throw new Error('Vehicle has no BaT URL');
      }
      
      const result = await updateVehicle(vehicle.id, vehicle.bat_auction_url);
      results.push({ vehicle_id: vehicle.id, ...result });
      
    } else if (body.batch) {
      // Batch mode
      const limit = body.limit || 10;
      const criteria = body.criteria || 'missing_price';
      
      const vehicles = await findVehiclesToFix(criteria, limit);
      console.log(`Found ${vehicles.length} vehicles to fix (criteria: ${criteria})`);
      
      for (const vehicle of vehicles) {
        try {
          const result = await updateVehicle(vehicle.id, vehicle.bat_auction_url);
          results.push({ 
            vehicle_id: vehicle.id, 
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            ...result 
          });
        } catch (err: any) {
          results.push({ 
            vehicle_id: vehicle.id,
            success: false, 
            error: err.message 
          });
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      throw new Error('Provide vehicle_id for single update or batch: true for batch processing');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: results.length,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


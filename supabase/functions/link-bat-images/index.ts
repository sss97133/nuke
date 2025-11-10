import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vehicle_id } = await req.json();

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if vehicle already has images
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle_id);

    if (count && count > 0) {
      return new Response(
        JSON.stringify({ message: 'Vehicle already has images', count }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get vehicle details
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, vin, sale_date, sale_price')
      .eq('id', vehicle_id)
      .single();

    if (!vehicle) {
      return new Response(
        JSON.stringify({ error: 'Vehicle not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Search BaT for this vehicle
    const searchTerm = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.toLowerCase();
    const batSearchUrl = `https://bringatrailer.com/member/vivalasvegasautos/`;
    
    // Fetch the member page
    const response = await fetch(batSearchUrl);
    const html = await response.text();
    
    // Parse with cheerio
    const $ = cheerio.load(html);
    
    // Find listing URL matching year/make
    let listingUrl = null;
    $('a[href*="/listing/"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      
      if (href && text.includes(vehicle.year.toString()) && 
          (text.includes(vehicle.make.toLowerCase()) || href.includes(vehicle.make.toLowerCase()))) {
        listingUrl = href;
        return false; // break
      }
    });

    if (!listingUrl) {
      return new Response(
        JSON.stringify({ error: 'No BaT listing found for this vehicle' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the listing page
    const listingResponse = await fetch(listingUrl);
    const listingHtml = await listingResponse.text();
    const $$ = cheerio.load(listingHtml);

    // Extract all gallery image URLs
    const imageUrls: string[] = [];
    $$('img').each((_, img) => {
      const alt = $$(img).attr('alt') || '';
      let src = $$(img).attr('src');
      
      if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
        src = src.split('?')[0]; // Remove query params for full resolution
        if (!imageUrls.includes(src)) {
          imageUrls.push(src);
        }
      }
    });

    if (imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No images found in listing' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert image records (direct links to BaT - no download)
    const imagesToInsert = imageUrls.slice(0, 15).map((url, i) => ({
      vehicle_id,
      image_url: url,
      user_id: Deno.env.get('VIVA_USER_ID') || '0b9f107a-d124-49de-9ded-94698f63c1c4',
      category: 'bat_listing',
      is_primary: i === 0,
      filename: `bat_image_${i}.jpg`
    }));

    const { error: insertError } = await supabase
      .from('vehicle_images')
      .insert(imagesToInsert);

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        images_linked: imagesToInsert.length,
        listing_url: listingUrl
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error linking BaT images:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


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

    // IMPORTANT: Direct hotlinks to BaT frequently fail in browsers (anti-hotlink/CORS).
    // Instead, download + upload into Supabase Storage via `backfill-images` to produce stable public URLs.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    }

    const backfillResp = await fetch(`${supabaseUrl}/functions/v1/backfill-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        vehicle_id,
        image_urls: imageUrls.slice(0, 15),
        source: 'bat_import',
        run_analysis: false,
      }),
    });

    const backfillText = await backfillResp.text();
    if (!backfillResp.ok) {
      throw new Error(`backfill-images failed: ${backfillResp.status} ${backfillText}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        listing_url: listingUrl,
        backfill: (() => {
          try { return JSON.parse(backfillText); } catch { return { raw: backfillText }; }
        })(),
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


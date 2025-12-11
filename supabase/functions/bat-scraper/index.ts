/**
 * BaT Listing Scraper Edge Function
 * Bypasses CORS by fetching BaT listings server-side
 * Extracts: VIN, specs, images, price, seller info
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url || !url.includes('bringatrailer.com')) {
      return new Response(
        JSON.stringify({ error: 'Invalid BaT URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching BaT listing:', url);

    // Fetch the listing page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    
    // Parse the listing data
    const result: any = {
      source: 'bat',
      listing_url: url,
      year: null,
      make: null,
      model: null,
      vin: null,
      sold_price: null,
      sold_date: null,
      mileage: null,
      location: null,
      seller: null,
      images: []
    };

    // Extract title (e.g., "1987 GMC V1500 Suburban Sierra Classic 4×4")
    const titleMatch = html.match(/<h1[^>]*class="post-title"[^>]*>([^<]+)<\/h1>/i) ||
                        html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    
    if (titleMatch) {
      const title = titleMatch[1].trim();
      console.log('Title:', title);
      
      // Parse year
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        result.year = parseInt(yearMatch[0]);
      }

      // Parse make and model (after year)
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1).join(' ');
      }
    }

    // Extract VIN - BaT uses both "VIN:" and "Chassis:" labels
    const vinMatch = html.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i) ||
                     html.match(/<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i) ||
                     html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) {
      const vin = vinMatch[1].toUpperCase();
      if (!/[IOQ]/.test(vin)) {
        result.vin = vin;
      }
    }

    // Extract sold price
    const soldMatch = html.match(/Sold for[:\s]*\$([0-9,]+)/i) ||
                      html.match(/winning bid[:\s]*\$([0-9,]+)/i);
    if (soldMatch) {
      result.sold_price = parseInt(soldMatch[1].replace(/,/g, ''));
    }

    // Extract sold date
    const dateMatch = html.match(/Sold on[:\s]*([^<]+)</i) ||
                      html.match(/Ended[:\s]*([^<]+)</i);
    if (dateMatch) {
      result.sold_date = dateMatch[1].trim();
    }

    // Extract mileage
    const mileageMatch = html.match(/([0-9,]+)\s*miles/i);
    if (mileageMatch) {
      result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Extract location
    const locationMatch = html.match(/Location:?\s*([^<,]+(?:,\s*[^<]+)?)/i);
    if (locationMatch) {
      result.location = locationMatch[1].trim();
    }

    // Extract seller
    const sellerMatch = html.match(/seller[:\s]*([^<]+)</i) ||
                        html.match(/by\s+([A-Za-z0-9_]+)\s+on/i);
    if (sellerMatch) {
      result.seller = sellerMatch[1].trim();
    }

    // Extract images - BaT uses various formats
    const imageMatches = html.matchAll(/<img[^>]*src="([^"]*bringatrailer\.com[^"]*)"[^>]*>/gi);
    const imageUrls = new Set<string>();
    
    for (const match of imageMatches) {
      let imgUrl = match[1];
      
      // Filter out icons/logos/small images
      if (imgUrl.includes('logo') || imgUrl.includes('icon') || imgUrl.includes('avatar')) continue;
      if (imgUrl.includes('150x150') || imgUrl.includes('50x50')) continue;
      
      // Get full resolution
      imgUrl = imgUrl.replace(/-\d+x\d+\./, '.');
      
      // Only include unique URLs
      if (imgUrl.includes('bringatrailer.com') && !imageUrls.has(imgUrl)) {
        imageUrls.add(imgUrl);
      }
    }

    result.images = Array.from(imageUrls);

    console.log('Parsed result:', result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Scraper error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});


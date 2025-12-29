/**
 * Batch BaT Extraction - Direct fetch (FREE)
 * Falls back to Firecrawl only if rate limited
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractResult {
  vehicle_id: string;
  url: string;
  success: boolean;
  error?: string;
  data?: any;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchBatPage(url: string): Promise<{ html: string | null; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return { html: await response.text() };
    }
    return { html: null, error: `HTTP ${response.status}` };
  } catch (err: any) {
    return { html: null, error: err.message };
  }
}

// Quick regex extractors (same as bat-simple-extract)
function extractFromHtml(html: string) {
  // Title
  const titleMatch = html.match(/<h1[^>]*class="[^"]*listing-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                     html.match(/<title>([^<|]+)/i);
  const title = titleMatch?.[1]?.trim()?.replace(/\s+for sale.*$/i, '') || null;

  // Year/Make/Model from title
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  if (title) {
    const ymm = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    if (ymm) {
      year = parseInt(ymm[1]);
      make = ymm[2];
      model = ymm[3];
    }
  }

  // VIN
  const vinPatterns = [
    /Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>/i,
    /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
    /\b(W[A-Z0-9]{16})\b/,  // German
    /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/,  // US
  ];
  let vin: string | null = null;
  for (const p of vinPatterns) {
    const m = html.match(p);
    if (m) { vin = m[1].toUpperCase(); break; }
  }

  // Sale price
  const priceMatch = html.match(/Sold\s+for\s+(?:USD\s*)?\$?([\d,]+)/i);
  const sale_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

  // High bid (for unsold)
  const bidMatch = html.match(/High Bid[:\s]*(?:USD\s*)?\$?([\d,]+)/i) ||
                   html.match(/Current Bid[:\s]*(?:USD\s*)?\$?([\d,]+)/i);
  const high_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

  // Seller - pattern: Seller</strong>: <a href=".../member/username/">
  const sellerMatch = html.match(/Seller<\/strong>:\s*<a[^>]*href="[^"]*\/member\/([^/"]+)/i) ||
                      html.match(/"seller"[^}]*"username"\s*:\s*"([^"]+)"/i);
  const seller = sellerMatch?.[1] || null;

  // Buyer - pattern: "to <strong>username</strong> for" (BaT History section)
  const buyerMatch = html.match(/to <strong>([^<]+)<\/strong> for/i) ||
                     html.match(/Sold\s+to\s*<a[^>]*href="[^"]*\/member\/([^/"]+)/i);
  const buyer = buyerMatch?.[1]?.trim() || null;

  // Bid count
  const bidCountMatch = html.match(/(\d+)\s+bids?/i);
  const bid_count = bidCountMatch ? parseInt(bidCountMatch[1]) : 0;

  // Comment count
  const commentMatch = html.match(/(\d+)\s+comments?/i);
  const comment_count = commentMatch ? parseInt(commentMatch[1]) : 0;

  // Views
  const viewMatch = html.match(/([\d,]+)\s+views?/i);
  const view_count = viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : 0;

  // Watchers
  const watcherMatch = html.match(/(\d+)\s+watchers?/i);
  const watcher_count = watcherMatch ? parseInt(watcherMatch[1]) : 0;

  // Location
  const locMatch = html.match(/Location[:\s]*([^<\n]+)/i);
  const location = locMatch?.[1]?.trim() || null;

  // Lot number
  const lotMatch = html.match(/Lot\s*#?\s*(\d+)/i);
  const lot_number = lotMatch?.[1] || null;

  // Images
  const imgMatches = html.matchAll(/<img[^>]*src="(https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"]+)"/gi);
  const image_urls = [...new Set([...imgMatches].map(m => m[1]).filter(u => !u.includes('150x150')))];

  // Mileage
  const mileageMatch = html.match(/([\d,]+)\s*(?:k\s*)?miles?/i);
  const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) * (mileageMatch[0].toLowerCase().includes('k') ? 1000 : 1) : null;

  // Color
  const colorMatch = html.match(/(?:Exterior|Paint)[:\s]*([A-Za-z\s]+?)(?:<|,|\n)/i);
  const color = colorMatch?.[1]?.trim() || null;

  return {
    title, year, make, model, vin, sale_price, high_bid,
    seller, buyer, bid_count, comment_count, view_count, watcher_count,
    location, lot_number, image_urls, mileage, color
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { limit = 50, criteria = 'missing_seller' } = await req.json();

    // Build query based on criteria
    let query = supabase
      .from('vehicles')
      .select('id, bat_auction_url, discovery_url, year, make, model')
      .limit(limit);

    if (criteria === 'missing_seller') {
      query = query.is('bat_seller', null);
    } else if (criteria === 'missing_price') {
      query = query.is('sale_price', null);
    } else if (criteria === 'missing_images') {
      // Will filter after
    }

    // Must have BaT URL
    query = query.or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer%');

    const { data: vehicles, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    console.log(`Processing ${vehicles?.length || 0} vehicles with Firecrawl...`);

    const results: ExtractResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const vehicle of vehicles || []) {
      const url = vehicle.bat_auction_url || vehicle.discovery_url;
      if (!url) {
        results.push({ vehicle_id: vehicle.id, url: '', success: false, error: 'No URL' });
        errorCount++;
        continue;
      }

      console.log(`[${successCount + errorCount + 1}/${vehicles?.length}] ${url}`);

      // Direct fetch (FREE)
      const { html, error: fetchErr } = await fetchBatPage(url);
      
      if (!html) {
        results.push({ vehicle_id: vehicle.id, url, success: false, error: fetchErr });
        errorCount++;
        continue;
      }

      // Extract data
      const extracted = extractFromHtml(html);

      // Update vehicle
      const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (extracted.seller) updatePayload.bat_seller = extracted.seller;
      if (extracted.buyer) updatePayload.bat_buyer = extracted.buyer;
      if (extracted.sale_price) updatePayload.sale_price = extracted.sale_price;
      if (extracted.high_bid) updatePayload.high_bid = extracted.high_bid;
      if (extracted.bid_count) updatePayload.bat_bids = extracted.bid_count;
      if (extracted.comment_count) updatePayload.bat_comments = extracted.comment_count;
      if (extracted.view_count) updatePayload.bat_views = extracted.view_count;
      if (extracted.watcher_count) updatePayload.bat_watchers = extracted.watcher_count;
      if (extracted.vin) updatePayload.vin = extracted.vin;
      if (extracted.location) updatePayload.bat_location = extracted.location;
      if (extracted.lot_number) updatePayload.bat_lot_number = extracted.lot_number;
      if (extracted.mileage) updatePayload.mileage = extracted.mileage;
      if (extracted.color) updatePayload.color = extracted.color;
      if (extracted.title) updatePayload.bat_listing_title = extracted.title;
      if (!vehicle.bat_auction_url && url.includes('bringatrailer')) {
        updatePayload.bat_auction_url = url;
      }

      const { error: updateErr } = await supabase
        .from('vehicles')
        .update(updatePayload)
        .eq('id', vehicle.id);

      if (updateErr) {
        results.push({ vehicle_id: vehicle.id, url, success: false, error: updateErr.message });
        errorCount++;
        continue;
      }

      // Save images if found
      if (extracted.image_urls.length > 0) {
        // Delete existing and insert new
        await supabase.from('vehicle_images').delete().eq('vehicle_id', vehicle.id);
        
        const imgRecords = extracted.image_urls.slice(0, 100).map((img_url, i) => ({
          vehicle_id: vehicle.id,
          image_url: img_url,
          position: i,
          source: 'bat_firecrawl',
          is_external: true,
        }));
        
        await supabase.from('vehicle_images').insert(imgRecords);
      }

      results.push({
        vehicle_id: vehicle.id,
        url,
        success: true,
        data: {
          seller: extracted.seller,
          buyer: extracted.buyer,
          sale_price: extracted.sale_price,
          images: extracted.image_urls.length,
        }
      });
      successCount++;

      // Rate limit protection - 1 second delay between requests
      await new Promise(r => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({
      success: true,
      processed: vehicles?.length || 0,
      successful: successCount,
      errors: errorCount,
      results: results.slice(0, 10),  // Sample
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Batch error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});


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

function stripBatSidebarHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    if (!doc) return String(html || '');
    doc.querySelectorAll('.sidebar, #sidebar, [class*=\"sidebar\"]').forEach((n) => n.remove());
    return doc.documentElement?.outerHTML || String(html || '');
  } catch {
    return String(html || '');
  }
}

function extractBatGalleryImagesFromHtml(html: string): string[] {
  const h = String(html || '');
  const normalize = (u: string) => u.split('#')[0].split('?')[0].replace(/-scaled\./g, '.').trim();
  const isOk = (u: string) => {
    const s = u.toLowerCase();
    return (
      u.startsWith('http') &&
      s.includes('bringatrailer.com/wp-content/uploads/') &&
      !s.endsWith('.svg') &&
      !s.endsWith('.pdf')
    );
  };

  // 1) Canonical source: listing gallery JSON
  try {
    let idx = h.indexOf('id=\"bat_listing_page_photo_gallery\"');
    if (idx < 0) idx = h.indexOf(\"id='bat_listing_page_photo_gallery'\");
    if (idx >= 0) {
      const window = h.slice(idx, idx + 300000);
      const m = window.match(/data-gallery-items=(?:\"([^\"]+)\"|'([^']+)')/i);
      const encoded = (m?.[1] || m?.[2] || '').trim();
      if (encoded) {
        const jsonText = encoded.replace(/&quot;/g, '\"').replace(/&#038;/g, '&').replace(/&amp;/g, '&');
        const items = JSON.parse(jsonText);
        if (Array.isArray(items)) {
          const urls: string[] = [];
          for (const it of items) {
            const u = it?.large?.url || it?.small?.url;
            if (typeof u !== 'string' || !u.trim()) continue;
            const nu = normalize(u);
            if (!isOk(nu)) continue;
            urls.push(nu);
          }
          if (urls.length) return [...new Set(urls)];
        }
      }
    }
  } catch {
    // fall through
  }

  // 2) Fallback: scan uploads, but strip sidebar first to avoid ad/CTA images.
  const cleaned = stripBatSidebarHtml(h);
  const abs = cleaned.match(/https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || [];
  const protoRel = cleaned.match(/\/\/bringatrailer\.com\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || [];
  const rel = cleaned.match(/\/wp-content\/uploads\/[^\"'\\s>]+\\.(jpg|jpeg|png|webp)(?:\\?[^\"'\\s>]*)?/gi) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...abs, ...protoRel, ...rel]) {
    let u = raw;
    if (u.startsWith('//')) u = 'https:' + u;
    if (u.startsWith('/')) u = 'https://bringatrailer.com' + u;
    const nu = normalize(u);
    if (!isOk(nu)) continue;
    if (seen.has(nu)) continue;
    seen.add(nu);
    out.push(nu);
    if (out.length >= 400) break;
  }
  return out;
}

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

    // Extract images:
    // CRITICAL: Do NOT scan arbitrary <img> tags (sidebar ads + CTAs contaminate galleries).
    // Prefer the canonical gallery JSON; fallback explicitly strips `.sidebar`.
    result.images = extractBatGalleryImagesFromHtml(html);

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


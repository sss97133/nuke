/**
 * Victory Lap Classics (victorylapclassics.net) listing extractor.
 * Wix-based dealer site: product pages have title, price, and description.
 * Writes to vehicles, vehicle_events, extraction_metadata (raw_listing_description).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

const PLATFORM = 'victorylapclassics';

interface VictoryLapExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  description: string | null;
  sale_price: number | null;
  image_urls: string[];
}

function parseYearMakeModel(title: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!title || !title.trim()) return { year: null, make: null, model: null };
  const t = title.trim();
  const yearMatch = t.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  // Common makes on Victory Lap (classic Chevy dealer)
  const makeMap: Record<string, string> = {
    'bel air': 'Chevrolet',
    'bel-air': 'Chevrolet',
    'camaro': 'Chevrolet',
    'chevelle': 'Chevrolet',
    'corvette': 'Chevrolet',
    'nova': 'Chevrolet',
    'malibu': 'Chevrolet',
    'c10': 'Chevrolet',
    'c-10': 'Chevrolet',
    'chevy': 'Chevrolet',
    'chevrolet': 'Chevrolet',
    'challenger': 'Dodge',
    'lincoln': 'Lincoln',
  };
  const lower = t.toLowerCase();
  let make: string | null = null;
  for (const [key, val] of Object.entries(makeMap)) {
    if (lower.includes(key)) {
      make = val;
      break;
    }
  }
  // Model: strip year and common suffixes (Restomod, Convertible, etc.)
  let model = t
    .replace(/\b(19|20)\d{2}\b/, '')
    .replace(/\b(restomod|convertible|survivor|original|custom build|twin turbo|supercharged|lsa|ls3|ls1|lt4|lt1|ls turbo|whipple|hellcat|widebody|redeye|short bed|hardtop|unrestored)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!make && (lower.includes('chevy') || lower.includes('3100'))) make = 'Chevrolet';
  if (!make && lower.includes('bel air')) make = 'Chevrolet';
  if (!make && lower.includes('camaro')) make = 'Chevrolet';
  if (!make && lower.includes('chevelle')) make = 'Chevrolet';
  if (!make && lower.includes('corvette')) make = 'Chevrolet';
  if (!make && lower.includes('nova')) make = 'Chevrolet';
  if (!make && lower.includes('malibu')) make = 'Chevrolet';
  if (!make && lower.includes('c-10') || lower.includes('c10')) make = 'Chevrolet';
  if (!make && lower.includes('challenger')) make = 'Dodge';
  if (!make && lower.includes('lincoln')) make = 'Lincoln';
  if (!model) model = null;
  return { year, make, model };
}

function extractFromHtml(html: string, url: string): VictoryLapExtracted {
  const out: VictoryLapExtracted = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    description: null,
    sale_price: null,
    image_urls: [],
  };

  // og:title or <title>
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  out.title = (ogTitle?.[1] || titleTag?.[1] || '').trim().replace(/\s*\|\s*Victory Lap Classics.*$/i, '').trim() || null;

  // Price: $85,000.00 or $85,000
  const priceMatch = html.match(/\$[\s]*([\d,]+)(?:\.(\d{2}))?/);
  if (priceMatch) {
    const num = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(num)) out.sale_price = num;
  }

  // Description: often in a block of text, or data-block or paragraph after title
  const descBlock = html.match(/<[^>]*class=["'][^"']*product-page[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<p[^>]*>([^<]{50,800})<\/p>/)
    || html.match(/description["']?\s*[:=]\s*["']([^"']{20,800})/i);
  if (descBlock && descBlock[1]) {
    const raw = descBlock[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (raw.length > 20) out.description = raw;
  }
  // Wix sometimes puts body text in script or data
  if (!out.description) {
    const anyText = html.match(/\b(Check out this[^<>"]{30,500})/i)
      || html.match(/\b(This (?:is )?a?\s*\d{4}[^<>"]{20,400})/i);
    if (anyText && anyText[1]) out.description = anyText[1].replace(/\s+/g, ' ').trim();
  }

  // Images: og:image or wix image URLs
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImage?.[1]) out.image_urls.push(ogImage[1]);
  const imgSrcs = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  for (const m of imgSrcs) {
    const u = m[1];
    if (u && (u.includes('wix') || u.includes('victorylap') || u.startsWith('http')) && !out.image_urls.includes(u)) {
      if (out.image_urls.length < 20) out.image_urls.push(u);
    }
  }

  const parsed = parseYearMakeModel(out.title);
  if (!out.year) out.year = parsed.year;
  if (!out.make) out.make = parsed.make;
  if (!out.model) out.model = parsed.model;

  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url || !url.includes('victorylapclassics')) {
      return new Response(
        JSON.stringify({ error: 'url must be a Victory Lap Classics product page' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalized = url.replace(/#.*$/, '').split('?')[0];
    const res = await fetch(normalized, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Nuke/1.0; +https://nuke.ag)' },
    });
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Fetch failed: ${res.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const html = await res.text();
    const extracted = extractFromHtml(html, normalized);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const listingUrlKey = normalizeListingUrlKey(normalized);
    const pattern = discoveryUrlIlikePattern(normalized);

    // 1) Resolve by vehicle_events or discovery_url
    let { vehicleId } = await resolveExistingVehicleId(supabase, {
      url: normalized,
      platform: PLATFORM,
      discoveryUrlIlikePattern: pattern,
    });

    // 2) If not found, try to link to existing vehicle that references Victory Lap (same year)
    if (!vehicleId && extracted.year) {
      const { data: candidates } = await supabase
        .from('vehicles')
        .select('id')
        .eq('year', extracted.year)
        .or('description.ilike.%victorylap%,discovery_url.ilike.%victorylap%')
        .limit(5);
      const first = Array.isArray(candidates) ? candidates[0] : (candidates as { id: string } | null);
      if (first?.id) vehicleId = first.id;
    }

    const now = new Date().toISOString();

    if (!vehicleId) {
      const { data: inserted, error: insertErr } = await supabase
        .from('vehicles')
        .insert({
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          discovery_url: normalized,
          description: extracted.description,
          description_source: 'source_imported',
          sale_price: extracted.sale_price,
          primary_image_url: extracted.image_urls[0] || null,
          origin_metadata: { source: PLATFORM, listing_url: normalized, extracted_at: now },
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .maybeSingle();
      if (insertErr) throw insertErr;
      vehicleId = inserted?.id;
    } else {
      await supabase
        .from('vehicles')
        .update({
          updated_at: now,
          ...(extracted.description ? { description: extracted.description, description_source: 'source_imported' } : {}),
          ...(extracted.sale_price != null ? { sale_price: extracted.sale_price } : {}),
        })
        .eq('id', vehicleId);
    }

    await supabase
      .from('vehicle_events')
      .upsert(
        {
          vehicle_id: vehicleId,
          source_platform: PLATFORM,
          event_type: 'listing',
          source_url: normalized,
          source_listing_id: listingUrlKey,
          event_status: 'active',
          metadata: { title: extracted.title, price: extracted.sale_price },
          updated_at: now,
        } as any,
        { onConflict: 'platform,listing_url_key' }
      );

    if (extracted.description) {
      await supabase.from('extraction_metadata').insert({
        vehicle_id: vehicleId,
        field_name: 'raw_listing_description',
        field_value: extracted.description,
        extraction_method: 'extract-victorylap-listing',
        scraper_version: '1.0',
        source_url: normalized,
        confidence_score: 0.85,
        extracted_at: now,
        raw_extraction_data: { title: extracted.title, sale_price: extracted.sale_price },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        title: extracted.title,
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        sale_price: extracted.sale_price,
        has_description: !!extracted.description,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('extract-victorylap-listing error:', e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

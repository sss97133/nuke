import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  // Keep query string (Classic uses filters sometimes) but normalize www + trailing slash for detail pages.
  u.hostname = u.hostname.replace(/^www\./, '');
  if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
  return u.toString();
}

function extractListingId(u: URL): string {
  // Stable-ish ID: use the full pathname without trailing slash (Classic has multiple URL patterns).
  return u.pathname.replace(/\/$/, '');
}

function parseMoneyToNumber(s: string | undefined | null): number | null {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseYearMakeModel(title: string): { year: number | null; make: string | null; model: string | null } {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/\b(18\d{2}|19\d{2}|20\d{2})\s+([A-Za-z0-9]+)\s+(.+?)(?:\s*\||\s*–|\s*-|$)/);
  if (!m?.[1]) return { year: null, make: null, model: null };
  const year = Number(m[1]);
  const make = String(m[2] || '').trim() || null;
  const model = String(m[3] || '').trim() || null;
  return {
    year: Number.isFinite(year) ? year : null,
    make,
    model,
  };
}

function bestEffortStatus(html: string, title: string): 'active' | 'sold' | 'ended' {
  const t = `${title}\n${html}`.toLowerCase();
  if (t.includes('sold')) return 'sold';
  if (t.includes('ended') || t.includes('auction ended') || t.includes('ended on')) return 'ended';
  return 'active';
}

function parseIsoDateFromJsonLd(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`, 'i');
    const m = html.match(re);
    if (m?.[1]) {
      const s = String(m[1]).trim();
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function extractImageUrlsFromHtml(baseUrl: string, html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const r = String(raw || '').trim();
    if (!r) return;
    try {
      const u = new URL(r, baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      const s = u.toString();
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    } catch {
      // ignore
    }
  };

  // OG/Twitter meta images
  add(html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]);
  add(html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1]);

  // JSON-LD images
  const ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const inner = block.replace(/^[\s\S]*?>/i, '').replace(/<\/script>\s*$/i, '');
    const txt = String(inner || '').trim();
    if (!txt) continue;
    try {
      const j = JSON.parse(txt);
      const candidates: any[] = Array.isArray(j) ? j : [j];
      for (const obj of candidates) {
        const img = (obj as any)?.image ?? (obj as any)?.primaryImageOfPage?.url ?? null;
        if (typeof img === 'string') add(img);
        else if (Array.isArray(img)) img.forEach((x) => typeof x === 'string' && add(x));
        else if (img && typeof img === 'object' && typeof (img as any).url === 'string') add((img as any).url);

        const contentUrl = (obj as any)?.contentUrl;
        if (typeof contentUrl === 'string') add(contentUrl);
      }
    } catch {
      // ignore parse failures
    }
  }

  // Last resort: pick up a few obvious CDN image URLs from the HTML (cap to avoid huge lists)
  const urlMatches = html.match(/https?:\/\/[^"'\\s>]+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"'\\s>]*)?/gi) || [];
  for (const m of urlMatches.slice(0, 50)) add(m);

  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json();
    const rawUrl = String(payload?.url || payload?.listingUrl || '').trim();
    const organizationId = payload?.organizationId ? String(payload.organizationId) : null;

    if (!rawUrl) {
      return new Response(JSON.stringify({ error: 'url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = normalizeUrl(rawUrl);
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'classic.com') {
      return new Response(JSON.stringify({ error: 'url must be on classic.com' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    let html = '';
    let title = '';

    if (firecrawlApiKey) {
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ['html', 'markdown'],
          onlyMainContent: false,
          waitFor: 6500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j?.success) {
          html = String(j?.data?.html || '');
          title = String(j?.data?.metadata?.title || '');
        }
      }
    }

    if (!html) {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
      html = await resp.text();
    }

    if (!title) {
      const tMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = String(tMatch?.[1] || '').trim();
    }

    const ymm = parseYearMakeModel(title);
    const listingStatus = bestEffortStatus(html, title);

    // Best-effort: current bid / price + bid count
    const currentBid =
      parseMoneyToNumber(html.match(/\b(Current Bid|High Bid)\b[\s\S]{0,120}?\$([\d,]+)/i)?.[2]) ??
      parseMoneyToNumber(html.match(/"price"\s*:\s*"(\$?[\d,]+)"/i)?.[1]) ??
      null;
    const bidCount = (() => {
      const m = html.match(/\b([\d,]+)\s+bids?\b/i) || html.match(/"bidCount"\s*:\s*(\d+)/i);
      const n = m?.[1] ? Number(String(m[1]).replace(/,/g, '')) : NaN;
      return Number.isFinite(n) ? n : null;
    })();

    const endDateIso =
      parseIsoDateFromJsonLd(html, ['endDate', 'validThrough']) ||
      null;

    // Upsert vehicle: we keep it private by default (VIN public safety can block is_public=true)
    let vehicleId: string | null = null;
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .or(`listing_url.eq.${url},discovery_url.eq.${url}`)
      .limit(1)
      .maybeSingle();
    if (existingVehicle?.id) vehicleId = existingVehicle.id;

    if (!vehicleId) {
      const { data: newVehicle, error: vehicleErr } = await supabase
        .from('vehicles')
        .insert({
          year: ymm.year || 0,
          make: ymm.make || 'Unknown',
          model: ymm.model || 'Vehicle',
          trim: null,
          description: '',
          listing_url: url,
          discovery_url: url,
          profile_origin: 'classic_com_import',
          discovery_source: 'classic_com_auction',
          origin_metadata: {
            source: 'classic_com_import',
            classic_url: url,
            extracted_at: new Date().toISOString(),
          },
          is_public: false,
        })
        .select('id')
        .single();
      if (vehicleErr) throw vehicleErr;
      vehicleId = newVehicle.id;
    } else {
      await supabase
        .from('vehicles')
        .update({
          year: ymm.year || undefined,
          make: ymm.make || undefined,
          model: ymm.model || undefined,
          listing_url: url,
          discovery_url: url,
          origin_metadata: {
            source: 'classic_com_import',
            classic_url: url,
            extracted_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', vehicleId);
    }

    // Upsert external listing for marketplace
    const listingId = extractListingId(u);
    const { data: ext, error: extErr } = await supabase
      .from('external_listings')
      .upsert(
        {
          vehicle_id: vehicleId,
          organization_id: organizationId,
          platform: 'classic_com',
          listing_url: url,
          listing_id: listingId,
          listing_status: listingStatus,
          end_date: endDateIso,
          current_bid: currentBid,
          bid_count: bidCount,
          metadata: {
            source: 'import-classic-auction',
            title,
            images: extractImageUrlsFromHtml(url, html),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vehicle_id,platform,listing_id' },
      )
      .select('id')
      .single();
    if (extErr) throw extErr;

    // Persist images into vehicle_images so marketplace/profile cards can show them.
    const extractedImages = extractImageUrlsFromHtml(url, html);
    if (extractedImages.length > 0) {
      try {
        await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicleId,
            image_urls: extractedImages,
            source: 'external_import',
            run_analysis: true,
            max_images: Math.min(50, extractedImages.length),
          },
        });
      } catch {
        // non-fatal
      }

      // Best-effort: set vehicles.primary_image_url if missing.
      try {
        const { data: v } = await supabase.from('vehicles').select('primary_image_url').eq('id', vehicleId).maybeSingle();
        if (!v?.primary_image_url) {
          await supabase.from('vehicles').update({ primary_image_url: extractedImages[0] }).eq('id', vehicleId);
        }
      } catch {
        // non-fatal
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        external_listing_id: ext?.id,
        platform: 'classic_com',
        listing_status: listingStatus,
        end_date: endDateIso,
        current_bid: currentBid,
        bid_count: bidCount,
        images_found: extractedImages.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});



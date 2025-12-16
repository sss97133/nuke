import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractBatDomMap } from './_shared/batDomMap.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RunnerRequest = {
  limit?: number;
  listing_urls?: string[];
  force_rescrape?: boolean;
  persist_html?: boolean;
  extractor_version?: string;
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchHtml(url: string): Promise<{ html: string; method: string; status: number }> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (firecrawlApiKey) {
    try {
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ['html'],
          onlyMainContent: false,
          waitFor: 3500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const html = String(j?.data?.html || '');
        if (html) return { html, method: 'firecrawl', status: 200 };
      }
    } catch {
      // fall through
    }
  }

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(20000),
  });
  const html = await r.text();
  return { html, method: 'direct', status: r.status };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const body: RunnerRequest = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, Number(body.limit || 50)));
    const listingUrlsInput = Array.isArray(body.listing_urls) ? body.listing_urls.map((u) => String(u).trim()).filter(Boolean) : [];
    const forceRescrape = body.force_rescrape === true;
    const persistHtml = body.persist_html !== false; // default true
    const extractorVersion = String(body.extractor_version || 'v1');

    // Select candidates
    let listingUrls: string[] = listingUrlsInput;
    if (listingUrls.length === 0) {
      // Prefer bat_listings if present; fall back to vehicles.bat_auction_url.
      const { data: batRows, error: batErr } = await supabase
        .from('bat_listings')
        .select('bat_listing_url')
        .order('last_updated_at', { ascending: false })
        .limit(limit);

      if (!batErr && Array.isArray(batRows) && batRows.length > 0) {
        listingUrls = batRows.map((r: any) => String(r.bat_listing_url)).filter(Boolean);
      } else {
        const { data: vehRows } = await supabase
          .from('vehicles')
          .select('bat_auction_url')
          .not('bat_auction_url', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(limit);
        listingUrls = (vehRows || []).map((r: any) => String(r.bat_auction_url)).filter(Boolean);
      }
    }

    // De-dupe
    listingUrls = [...new Set(listingUrls)];
    if (listingUrls.length > limit) listingUrls = listingUrls.slice(0, limit);

    const results: any[] = [];
    let okCount = 0;
    let failCount = 0;

    for (const listing_url of listingUrls) {
      const platform = 'bat';
      const startedAt = Date.now();
      let snapshotId: string | null = null;
      let html = '';
      let fetchMethod = 'none';
      let httpStatus: number | null = null;
      let fetchError: string | null = null;

      try {
        // Attempt to reuse latest snapshot unless forced.
        if (!forceRescrape) {
          const { data: existing } = await supabase
            .from('listing_page_snapshots')
            .select('id, html, success')
            .eq('platform', platform)
            .eq('listing_url', listing_url)
            .order('fetched_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing?.id && existing?.success === true && typeof (existing as any).html === 'string' && (existing as any).html.length > 0) {
            snapshotId = existing.id;
            html = String((existing as any).html);
            fetchMethod = 'snapshot_cache';
            httpStatus = 200;
          }
        }

        if (!html) {
          const fetched = await fetchHtml(listing_url);
          html = fetched.html;
          fetchMethod = fetched.method;
          httpStatus = fetched.status;
        }

        const contentLen = html.length;
        const sha = html ? await sha256Hex(html) : null;

        if (persistHtml) {
          // Upsert snapshot (deduped by unique index)
          const { data: snap, error: snapErr } = await supabase
            .from('listing_page_snapshots')
            .insert({
              platform,
              listing_url,
              fetched_at: new Date().toISOString(),
              fetch_method: fetchMethod,
              http_status: httpStatus,
              success: !!html && contentLen > 1000 && (httpStatus ? httpStatus < 500 : true),
              error_message: fetchError,
              html,
              html_sha256: sha,
              content_length: contentLen,
              metadata: {
                runner: 'bat-dom-map-health-runner',
              },
            })
            .select('id')
            .single();

          if (!snapErr && snap?.id) snapshotId = snap.id;
        }

        const { health } = extractBatDomMap(html, listing_url);

        const ok = health.overall_score >= 70 && health.counts.images > 0 && (health.fields.location.ok || health.fields.title.ok);
        if (ok) okCount++; else failCount++;

        // Persist health row
        const { error: healthErr } = await supabase
          .from('listing_extraction_health')
          .insert({
            platform,
            listing_url,
            snapshot_id: snapshotId,
            extractor_name: 'bat_dom_map',
            extractor_version: extractorVersion,
            extracted_at: new Date().toISOString(),
            overall_score: health.overall_score,
            ok,
            health,
            error_message: null,
          });

        if (healthErr) {
          // Non-fatal; still return the computed result.
        }

        results.push({
          listing_url,
          snapshot_id: snapshotId,
          ok,
          overall_score: health.overall_score,
          counts: health.counts,
          fields: Object.fromEntries(Object.entries(health.fields).map(([k, v]) => [k, { ok: v.ok, method: v.method }])),
          fetch: {
            method: fetchMethod,
            status: httpStatus,
            ms: Date.now() - startedAt,
            content_length: contentLen,
          },
        });
      } catch (e: any) {
        fetchError = e?.message || String(e);
        failCount++;

        // Persist failure health row
        await supabase
          .from('listing_extraction_health')
          .insert({
            platform,
            listing_url,
            snapshot_id: snapshotId,
            extractor_name: 'bat_dom_map',
            extractor_version: extractorVersion,
            extracted_at: new Date().toISOString(),
            overall_score: 0,
            ok: false,
            health: {
              overall_score: 0,
              fields: {},
              counts: { images: 0, comments: 0, bids: 0 },
              warnings: [],
              errors: [fetchError],
            },
            error_message: fetchError,
          })
          .catch(() => null);

        results.push({
          listing_url,
          snapshot_id: snapshotId,
          ok: false,
          overall_score: 0,
          error: fetchError,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        ok: okCount,
        failed: failCount,
        extractor_version: extractorVersion,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});



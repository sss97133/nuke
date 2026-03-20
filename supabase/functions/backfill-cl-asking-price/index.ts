/**
 * backfill-cl-asking-price
 *
 * Backfills asking_price on acquisition_pipeline rows that have a Craigslist
 * discovery_url but null asking_price.
 *
 * Strategy:
 *  1. Fetch individual CL listing pages
 *  2. Extract price from <span class="price">$N</span> OR JSON-LD "price" field
 *  3. Update acquisition_pipeline.asking_price
 *
 * Input:  { batch_size?: number }
 * Output: { success, stats: { attempted, updated, expired, failed } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract asking price from CL listing HTML.
 * Returns null if the listing is 410 gone or price can't be parsed.
 */
function extractPriceFromHtml(html: string): number | null {
  // Method 1: <span class="price">$15,000</span>
  const spanMatch = html.match(/<span[^>]*class=["']price["'][^>]*>\s*\$([0-9,]+)/);
  if (spanMatch) {
    const price = parseInt(spanMatch[1].replace(/,/g, ''), 10);
    if (price >= 500 && price < 10_000_000) return price;
  }

  // Method 2: JSON-LD "price":"15000" or "price":15000
  const jsonMatch = html.match(/"price":\s*"?([0-9,]+)"?/);
  if (jsonMatch) {
    const price = parseInt(jsonMatch[1].replace(/,/g, ''), 10);
    if (price >= 500 && price < 10_000_000) return price;
  }

  // Method 3: data-price attribute (some CL regions use this)
  const dataMatch = html.match(/data-price="([0-9]+)"/);
  if (dataMatch) {
    const price = parseInt(dataMatch[1], 10);
    if (price >= 500 && price < 10_000_000) return price;
  }

  return null;
}

/**
 * Fetch a single CL listing page and extract the asking price.
 * Returns { price, expired } where expired=true means 410/removed.
 */
async function fetchClPrice(
  url: string,
): Promise<{ price: number | null; expired: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 410 = listing removed/expired, 404 = gone
    if (response.status === 410 || response.status === 404) {
      return { price: null, expired: true };
    }

    if (!response.ok) {
      return { price: null, expired: false };
    }

    const html = await response.text();
    const price = extractPriceFromHtml(html);
    return { price, expired: false };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      console.warn(`[timeout] ${url}`);
    }
    return { price: null, expired: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const batchSize: number = body.batch_size ?? 30;
    const triggerReScore: boolean = body.trigger_re_score ?? true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://qkgaybvrernstplzjaam.supabase.co';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fetch pipeline entries missing asking_price
    const { data: rows, error: fetchErr } = await supabase
      .from('acquisition_pipeline')
      .select('id, discovery_url, stage')
      .is('asking_price', null)
      .like('discovery_url', 'https://%.craigslist.org%')
      .in('stage', ['discovered', 'market_proofed'])
      .order('created_at', { ascending: false })
      .limit(batchSize);

    if (fetchErr) {
      throw new Error(`Failed to fetch pipeline rows: ${fetchErr.message}`);
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No null-price CL pipeline entries found',
          stats: { attempted: 0, updated: 0, expired: 0, failed: 0 },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    console.log(`[backfill-cl-asking-price] Processing ${rows.length} entries...`);

    const stats = { attempted: 0, updated: 0, expired: 0, failed: 0 };
    const updatedIds: string[] = [];

    // Process sequentially with small delay to be polite to CL
    for (const row of rows) {
      stats.attempted++;

      const { price, expired } = await fetchClPrice(row.discovery_url);

      if (expired) {
        stats.expired++;
        // Mark expired in pipeline (set stage to something we can filter on, or just log)
        // Don't delete — just note the listing is gone. We keep the record for comps.
        console.log(`[expired] ${row.discovery_url}`);
        continue;
      }

      if (price === null) {
        stats.failed++;
        console.log(`[no_price] ${row.discovery_url}`);
        continue;
      }

      // Update asking_price
      const { error: updateErr } = await supabase
        .from('acquisition_pipeline')
        .update({ asking_price: price, updated_at: new Date().toISOString() })
        .eq('id', row.id);

      if (updateErr) {
        console.error(`[update_error] ${row.id}: ${updateErr.message}`);
        stats.failed++;
      } else {
        stats.updated++;
        updatedIds.push(row.id);
        console.log(`[updated] ${row.id} → $${price.toLocaleString()} (${row.discovery_url})`);
      }

      // Polite delay — CL rate limits aggressively
      await new Promise((r) => setTimeout(r, 500));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${stats.attempted} entries`,
        stats,
        updated_ids: updatedIds,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill-cl-asking-price] Fatal error: ${msg}`);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});

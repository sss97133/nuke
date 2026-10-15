// KSL Cars listing extractor - no LLM. The page is server-rendered; the parsing lives in ./extract.ts (pure, tested
// against a stored page). Every fetch is archived to listing_page_snapshots by archiveFetch before it is parsed.
// Returns { success, extracted }; `ingest` reads that shape and does the vehicle write.

import { archiveFetch } from '../_shared/archiveFetch.ts';
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { extractFromHtml } from './extract.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (typeof url !== 'string' || !/^https:\/\/cars\.ksl\.com\/listing\/\d+/.test(url)) {
      return json({ error: 'Invalid KSL Cars listing URL' }, 400);
    }
    const fetched = await archiveFetch(url, {
      platform: 'ksl',
      callerName: 'extract-ksl',
      useFirecrawl: false,
      directFetchOptions: { publicOnly: true },
      maxAgeSec: 86400,
      // cars.ksl.com refuses the server's datacenter address (403 / login wall, 2026-10-15); a residential IP gets 200.
      firecrawlOnBlock: true,
    });
    if (!fetched.html || fetched.html.length < 5000) {
      throw new Error(`Failed to fetch: ${fetched.error || `HTTP ${fetched.statusCode}, ${fetched.html?.length || 0} bytes`}`);
    }
    const extracted = extractFromHtml(fetched.html, url);
    if (extracted.status && extracted.status !== 'Active') {
      return json({ success: false, skipped: true, skip_reason: `KSL listing status ${extracted.status}`, url });
    }
    return json({ success: true, extracted: { ...extracted, listing_url: extracted.url } });
  } catch (error: any) {
    console.error('extract-ksl error:', error);
    return json({ error: error.message }, 500);
  }
});

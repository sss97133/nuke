import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Cars & Bids URL Discovery
 *
 * Discovers listing URLs from C&B past auctions.
 * NOTE: C&B has Cloudflare protection, so we use Firecrawl /map for discovery only.
 * Extraction uses extract-cars-and-bids-core which does NOT use AI (just HTML parsing).
 *
 * Deploy: supabase functions deploy cab-url-discovery --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "discover", "limit": 100}  - discover up to N URLs
 *   POST {"action": "status"}                  - check discovery stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// URL patterns that are NOT actual listings
const BAD_URL_PATTERNS = [
  /\/contact$/,
  /\/about$/,
  /\/sell-car$/,
  /\/how-it-works$/,
  /\/buyers-guide$/,
  /\/faq$/,
  /\/widgets$/,
  /\/dealers$/,
  /\.js$/,
  /\.css$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.webp$/,
];

function isValidListingUrl(url: string): boolean {
  // C&B listing patterns:
  // https://carsandbids.com/auctions/[id]/[slug]
  // https://carsandbids.com/listing/[slug]
  const listingPattern = /^https:\/\/carsandbids\.com\/(auctions\/[A-Za-z0-9]+\/[a-z0-9-]+|listing\/[a-z0-9-]+)\/?$/i;

  if (!listingPattern.test(url)) {
    return false;
  }

  // Check against bad patterns
  for (const pattern of BAD_URL_PATTERNS) {
    if (pattern.test(url)) {
      return false;
    }
  }

  return true;
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getExistingUrls(supabase: any): Promise<Set<string>> {
  const existing = new Set<string>();

  // Get from import_queue
  const { data: queued } = await supabase
    .from("import_queue")
    .select("listing_url")
    .ilike("listing_url", "%carsandbids.com%");

  for (const row of queued || []) {
    if (row.listing_url) {
      // Normalize: remove trailing slash
      existing.add(row.listing_url.replace(/\/$/, ""));
    }
  }

  // Also check external_listings
  const { data: external } = await supabase
    .from("external_listings")
    .select("listing_url")
    .eq("platform", "carsandbids");

  for (const row of external || []) {
    if (row.listing_url) {
      existing.add(row.listing_url.replace(/\/$/, ""));
    }
  }

  return existing;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "discover";

    if (action === "status") {
      // Get discovery stats
      const { data: state } = await supabase
        .from("system_state")
        .select("value")
        .eq("key", "cab_url_discovery")
        .single();

      const { count: queuedCount } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%carsandbids.com%")
        .eq("status", "pending");

      return okJson({
        success: true,
        state: state?.value || { total_discovered: 0, total_queued: 0 },
        pending_in_queue: queuedCount,
      });
    }

    if (action === "discover") {
      const pages = body.pages || 3; // Number of past-auctions pages to scrape

      console.log("[cab-url-discovery] Starting discovery...");

      // Get existing URLs to avoid duplicates
      const existingUrls = await getExistingUrls(supabase);
      console.log(`[cab-url-discovery] ${existingUrls.size} URLs already known`);

      const results = {
        pages_scraped: 0,
        urls_found: 0,
        urls_new: 0,
        urls_queued: 0,
        errors: [] as string[],
      };

      // Scrape past-auctions pages
      // C&B past-auctions uses pagination: ?page=1, ?page=2, etc.
      for (let page = 1; page <= pages; page++) {
        try {
          const targetUrl = page === 1
            ? "https://carsandbids.com/past-auctions/"
            : `https://carsandbids.com/past-auctions/?page=${page}`;

          console.log(`[cab-url-discovery] Scraping ${targetUrl}...`);

          const scrapeResult = await firecrawlScrape({
            url: targetUrl,
            formats: ['html'],
            onlyMainContent: false,
            waitFor: 3000,
            actions: [
              { type: 'scroll', direction: 'down', pixels: 3000 },
              { type: 'wait', milliseconds: 1500 },
            ],
          }, {
            timeoutMs: 45000,
            maxAttempts: 1,
          });

          if (!scrapeResult.success || !scrapeResult.data.html) {
            results.errors.push(`Page ${page}: ${scrapeResult.error || 'No HTML returned'}`);
            continue;
          }

          results.pages_scraped++;

          const html = scrapeResult.data.html;

          // Extract listing URLs using regex
          // Pattern 1: /auctions/[id]/[slug]
          // Pattern 2: /listing/[slug]
          const urlPattern1 = /href=["'](https:\/\/carsandbids\.com\/auctions\/[A-Za-z0-9]+\/[a-z0-9-]+)['"]/gi;
          const urlPattern2 = /href=["'](https:\/\/carsandbids\.com\/listing\/[a-z0-9-]+)['"]/gi;

          const foundUrls = new Set<string>();

          let match;
          while ((match = urlPattern1.exec(html)) !== null) {
            foundUrls.add(match[1].replace(/\/$/, ""));
          }
          while ((match = urlPattern2.exec(html)) !== null) {
            foundUrls.add(match[1].replace(/\/$/, ""));
          }

          // Filter to valid URLs
          const validUrls = Array.from(foundUrls).filter(url => isValidListingUrl(url));
          results.urls_found += validUrls.length;

          // Filter to new URLs
          const newUrls = validUrls.filter(url => !existingUrls.has(url));
          results.urls_new += newUrls.length;

          console.log(`[cab-url-discovery] Page ${page}: ${validUrls.length} URLs found, ${newUrls.length} new`);

          // Queue new URLs
          if (newUrls.length > 0) {
            const queueRecords = newUrls.map(url => ({
              listing_url: url,
              status: "pending",
              priority: 5,
              raw_data: {
                source: "cab_url_discovery",
                discovered_page: page,
                discovered_at: new Date().toISOString(),
              },
            }));

            const { error } = await supabase
              .from("import_queue")
              .upsert(queueRecords, { onConflict: "listing_url", ignoreDuplicates: true });

            if (error) {
              results.errors.push(`Page ${page} queue error: ${error.message}`);
            } else {
              results.urls_queued += newUrls.length;
              // Add to existing set
              newUrls.forEach(url => existingUrls.add(url));
            }
          }

          // If we found no URLs on this page, we've likely reached the end
          if (validUrls.length === 0) {
            console.log(`[cab-url-discovery] Page ${page} returned no URLs, stopping`);
            break;
          }

          // Rate limit: 1s between pages
          if (page < pages) {
            await new Promise(r => setTimeout(r, 1000));
          }

        } catch (err: any) {
          results.errors.push(`Page ${page}: ${err.message}`);
          console.error(`[cab-url-discovery] Error on page ${page}:`, err.message);
        }
      }

      // Update state
      let { data: stateRow } = await supabase
        .from("system_state")
        .select("value")
        .eq("key", "cab_url_discovery")
        .single();

      let state = stateRow?.value || {
        total_discovered: 0,
        total_queued: 0,
        last_run: null,
      };

      state.total_discovered += results.urls_found;
      state.total_queued += results.urls_queued;
      state.last_run = new Date().toISOString();

      await supabase.from("system_state").upsert({
        key: "cab_url_discovery",
        value: state,
        updated_at: new Date().toISOString(),
      });

      return okJson({
        success: true,
        ...results,
        state,
      });
    }

    return okJson({ success: false, error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[cab-url-discovery] Error:", err);
    return okJson({ success: false, error: err.message }, 500);
  }
});

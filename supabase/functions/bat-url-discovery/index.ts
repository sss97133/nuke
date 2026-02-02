import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * BAT URL Discovery
 *
 * Scrapes BAT results pages directly (no Firecrawl needed) to discover listing URLs.
 * Queues new URLs for extraction.
 *
 * Deploy: supabase functions deploy bat-url-discovery --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "discover", "pages": 10}  - scrape N pages, queue new URLs
 *   POST {"action": "status"}                 - check discovery progress
 *   POST {"action": "continuous", "target": 1000} - keep running until target URLs queued
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// URL patterns that are NOT actual listings
const BAD_URL_PATTERNS = [
  /\/contact$/,           // Contact pages
  /\/embed$/,             // Embed pages
  /\.js$/,                // JavaScript files
  /\.css$/,               // CSS files
  /\.png$/,               // Images
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.webp$/,
  /%22/,                  // URL-encoded quotes (garbage)
  /%5C/,                  // URL-encoded backslashes
  /&quot;/,               // HTML entities
  /&amp;/,
  /\\"$/,                 // Escaped quotes at end
  /",$/,                  // Comma after quote
];

function isValidListingUrl(url: string): boolean {
  // Must match pattern: /listing/[slug]/ or /listing/[slug]
  // Where slug is alphanumeric with hyphens
  const listingPattern = /^https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+\/?$/i;

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

async function scrapeBatResultsPage(page: number): Promise<string[]> {
  const url = `https://bringatrailer.com/auctions/results/?page=${page}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    console.error(`BAT page ${page} returned ${response.status}`);
    return [];
  }

  const html = await response.text();

  // Extract listing URLs using regex
  const matches = html.matchAll(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/g);
  const urls = new Set<string>();

  for (const match of matches) {
    // Clean URL (remove trailing slash variations)
    let listingUrl = match[1].replace(/\/$/, "");

    // Validate URL is an actual listing
    if (isValidListingUrl(listingUrl)) {
      urls.add(listingUrl);
    }
  }

  return Array.from(urls);
}

async function getExistingUrls(supabase: any): Promise<Set<string>> {
  const existing = new Set<string>();

  // Get from bat_listings
  const { data: batListings } = await supabase
    .from("bat_listings")
    .select("bat_listing_url")
    .not("bat_listing_url", "is", null);

  for (const row of batListings || []) {
    if (row.bat_listing_url) {
      existing.add(row.bat_listing_url.replace(/\/$/, ""));
    }
  }

  // Get from import_queue
  const { data: queued } = await supabase
    .from("import_queue")
    .select("listing_url")
    .ilike("listing_url", "%bringatrailer%");

  for (const row of queued || []) {
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
        .eq("key", "bat_url_discovery")
        .single();

      const { count: queuedCount } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%bringatrailer%")
        .eq("status", "pending");

      return okJson({
        success: true,
        state: state?.value || { total_discovered: 0, total_queued: 0, last_page: 0 },
        pending_in_queue: queuedCount,
      });
    }

    if (action === "discover" || action === "continuous") {
      const pagesToScrape = body.pages || 10;
      const targetUrls = body.target || 0;
      const startPage = body.start_page || 1;

      // Get existing URLs to avoid duplicates
      console.log("[bat-url-discovery] Loading existing URLs...");
      const existingUrls = await getExistingUrls(supabase);
      console.log(`[bat-url-discovery] ${existingUrls.size} URLs already known`);

      // Get current state
      let { data: stateRow } = await supabase
        .from("system_state")
        .select("value")
        .eq("key", "bat_url_discovery")
        .single();

      let state = stateRow?.value || {
        total_discovered: 0,
        total_queued: 0,
        last_page: 0,
        last_run: null,
      };

      const results = {
        pages_scraped: 0,
        urls_found: 0,
        urls_new: 0,
        urls_queued: 0,
        errors: [] as string[],
      };

      let currentPage = startPage;
      let shouldContinue = true;

      while (shouldContinue && results.pages_scraped < pagesToScrape) {
        try {
          console.log(`[bat-url-discovery] Scraping page ${currentPage}...`);
          const urls = await scrapeBatResultsPage(currentPage);

          if (urls.length === 0) {
            console.log(`[bat-url-discovery] Page ${currentPage} returned no URLs, stopping`);
            shouldContinue = false;
            break;
          }

          results.urls_found += urls.length;
          results.pages_scraped++;

          // Filter to new URLs only
          const newUrls = urls.filter(url => !existingUrls.has(url));
          results.urls_new += newUrls.length;

          // Queue new URLs
          if (newUrls.length > 0) {
            const queueRecords = newUrls.map(url => ({
              listing_url: url,
              status: "pending",
              priority: 5,
              raw_data: {
                source: "bat_url_discovery",
                discovered_page: currentPage,
                discovered_at: new Date().toISOString(),
              },
            }));

            const { error } = await supabase
              .from("import_queue")
              .upsert(queueRecords, { onConflict: "listing_url", ignoreDuplicates: true });

            if (error) {
              results.errors.push(`Page ${currentPage}: ${error.message}`);
            } else {
              results.urls_queued += newUrls.length;
              // Add to existing set
              newUrls.forEach(url => existingUrls.add(url));
            }
          }

          console.log(`[bat-url-discovery] Page ${currentPage}: ${urls.length} found, ${newUrls.length} new, ${newUrls.length} queued`);

          state.last_page = currentPage;
          state.total_discovered += urls.length;
          state.total_queued += newUrls.length;

          currentPage++;

          // Check if we hit target in continuous mode
          if (action === "continuous" && targetUrls > 0 && results.urls_queued >= targetUrls) {
            console.log(`[bat-url-discovery] Target ${targetUrls} reached`);
            shouldContinue = false;
          }

          // Rate limit: 500ms between pages
          await new Promise(r => setTimeout(r, 500));

        } catch (err: any) {
          results.errors.push(`Page ${currentPage}: ${err.message}`);
          console.error(`[bat-url-discovery] Page ${currentPage} error:`, err.message);
          currentPage++;
        }
      }

      // Save state
      state.last_run = new Date().toISOString();
      await supabase.from("system_state").upsert({
        key: "bat_url_discovery",
        value: state,
        updated_at: new Date().toISOString(),
      });

      return okJson({
        success: true,
        ...results,
        state,
        next_page: currentPage,
      });
    }

    return okJson({ success: false, error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[bat-url-discovery] Error:", err);
    return okJson({ success: false, error: err.message }, 500);
  }
});

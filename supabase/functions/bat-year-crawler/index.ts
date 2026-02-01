import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * BAT Year Crawler
 *
 * Crawls ALL BAT completed auctions by paginating through results.
 * Discovers listing URLs and queues them for extraction.
 *
 * Deploy: supabase functions deploy bat-year-crawler --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "crawl", "pages": 100, "start_page": 1}
 *   POST {"action": "status"}
 *   POST {"action": "continuous", "max_pages": 500}  - keeps going until no new URLs
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function scrapeBatPage(page: number, crawlType: string = "results"): Promise<string[]> {
  let url: string;
  if (crawlType === "results") {
    url = `https://bringatrailer.com/auctions/results/?page=${page}`;
  } else if (crawlType.startsWith("year_")) {
    const year = crawlType.replace("year_", "");
    url = `https://bringatrailer.com/${year}/?page=${page}`;
  } else {
    url = `https://bringatrailer.com/auctions/results/?page=${page}`;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    console.error(`[bat-year-crawler] Page ${page} returned ${response.status}`);
    return [];
  }

  const html = await response.text();
  const matches = html.matchAll(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/g);
  const urls = new Set<string>();

  for (const match of matches) {
    urls.add(match[1].replace(/\/$/, ""));
  }

  return Array.from(urls);
}

async function getScrapedPages(supabase: any, crawlType: string): Promise<Set<number>> {
  const { data } = await supabase
    .from("bat_crawl_state")
    .select("page_number")
    .eq("crawl_type", crawlType);

  return new Set((data || []).map((r: any) => r.page_number));
}

async function markPageScraped(supabase: any, crawlType: string, page: number, urlsFound: number, urlsNew: number) {
  await supabase.from("bat_crawl_state").upsert({
    crawl_type: crawlType,
    page_number: page,
    urls_found: urlsFound,
    urls_new: urlsNew,
    crawled_at: new Date().toISOString(),
  }, { onConflict: "crawl_type,page_number" });
}

async function getExistingUrls(supabase: any): Promise<Set<string>> {
  const existing = new Set<string>();

  // Get from bat_listings
  const { data: batListings } = await supabase
    .from("bat_listings")
    .select("bat_listing_url");

  for (const row of batListings || []) {
    if (row.bat_listing_url) {
      existing.add(row.bat_listing_url.replace(/\/$/, ""));
    }
  }

  // Get from import_queue (pending/processing)
  const { data: queued } = await supabase
    .from("import_queue")
    .select("listing_url")
    .ilike("listing_url", "%bringatrailer%")
    .in("status", ["pending", "processing"]);

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
    const action = body.action || "crawl";

    // Queue URLs directly (from Playwright crawler)
    if (action === "queue_urls") {
      const urls = body.urls || [];
      if (!urls.length) {
        return okJson({ success: true, urls_queued: 0, message: "No URLs provided" });
      }

      const existingUrls = await getExistingUrls(supabase);
      const newUrls = urls.filter((url: string) => !existingUrls.has(url.replace(/\/$/, "")));

      if (newUrls.length === 0) {
        return okJson({ success: true, urls_queued: 0, message: "All URLs already known" });
      }

      const queueRecords = newUrls.map((url: string) => ({
        listing_url: url.replace(/\/$/, ""),
        status: "pending",
        priority: 10,
        raw_data: { source: "playwright_crawler", discovered_at: new Date().toISOString() },
      }));

      const { error } = await supabase
        .from("import_queue")
        .upsert(queueRecords, { onConflict: "listing_url", ignoreDuplicates: true });

      if (error) {
        return okJson({ success: false, error: error.message }, 500);
      }

      return okJson({ success: true, urls_queued: newUrls.length, total_submitted: urls.length });
    }

    if (action === "status") {
      // Get real stats from DB, not inflated counters
      const { count: pagesScraped } = await supabase
        .from("bat_crawl_state")
        .select("*", { count: "exact", head: true });

      const { count: uniqueUrls } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%bringatrailer%");

      const { count: pendingCount } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%bringatrailer%")
        .eq("status", "pending");

      const { count: completeCount } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .ilike("listing_url", "%bringatrailer%")
        .eq("status", "complete");

      const { count: batListings } = await supabase
        .from("bat_listings")
        .select("*", { count: "exact", head: true });

      return okJson({
        success: true,
        target: 228000,
        pages_scraped: pagesScraped || 0,
        unique_urls_found: uniqueUrls || 0,
        extracted: batListings || 0,
        pending: pendingCount || 0,
        complete_in_queue: completeCount || 0,
        progress_pct: Math.round(((batListings || 0) / 228000) * 100),
      });
    }

    // Crawl mode
    const pagesToCrawl = body.pages || 50;
    const startPage = body.start_page || 1;
    const maxPages = body.max_pages || 10000;
    const crawlType = body.crawl_type || "results";
    const skipScraped = body.skip_scraped !== false; // Default true

    console.log(`[bat-year-crawler] Loading existing URLs...`);
    const existingUrls = await getExistingUrls(supabase);
    console.log(`[bat-year-crawler] ${existingUrls.size} URLs already known`);

    // Load already-scraped pages
    const scrapedPages = skipScraped ? await getScrapedPages(supabase, crawlType) : new Set<number>();
    console.log(`[bat-year-crawler] ${scrapedPages.size} pages already scraped for ${crawlType}`);

    const results = {
      pages_scraped: 0,
      pages_skipped: 0,
      urls_found: 0,
      urls_new: 0,
      urls_queued: 0,
      empty_pages: 0,
    };

    let currentPage = startPage;
    let consecutiveEmpty = 0;

    while (results.pages_scraped < pagesToCrawl && currentPage <= maxPages) {
      // Skip already-scraped pages
      if (scrapedPages.has(currentPage)) {
        results.pages_skipped++;
        currentPage++;
        continue;
      }

      try {
        console.log(`[bat-year-crawler] Scraping page ${currentPage}...`);
        const urls = await scrapeBatPage(currentPage, crawlType);

        if (urls.length === 0) {
          results.empty_pages++;
          consecutiveEmpty++;
          if (consecutiveEmpty >= 3) {
            console.log(`[bat-year-crawler] 3 consecutive empty pages, stopping`);
            break;
          }
          currentPage++;
          continue;
        }

        consecutiveEmpty = 0;
        results.urls_found += urls.length;
        results.pages_scraped++;

        // Filter to new URLs
        const newUrls = urls.filter(url => !existingUrls.has(url));
        results.urls_new += newUrls.length;

        if (newUrls.length > 0) {
          const queueRecords = newUrls.map(url => ({
            listing_url: url,
            status: "pending",
            priority: 10, // High priority for recent listings
            raw_data: {
              source: "bat_year_crawler",
              discovered_page: currentPage,
              discovered_at: new Date().toISOString(),
            },
          }));

          const { error } = await supabase
            .from("import_queue")
            .upsert(queueRecords, { onConflict: "listing_url", ignoreDuplicates: true });

          if (!error) {
            results.urls_queued += newUrls.length;
            newUrls.forEach(url => existingUrls.add(url));
          }
        }

        console.log(`[bat-year-crawler] Page ${currentPage}: ${urls.length} found, ${newUrls.length} new`);

        // Mark page as scraped so we don't re-scrape it
        await markPageScraped(supabase, crawlType, currentPage, urls.length, newUrls.length);

        currentPage++;

        // Rate limit
        await new Promise(r => setTimeout(r, 300));

      } catch (err: any) {
        console.error(`[bat-year-crawler] Page ${currentPage} error:`, err.message);
        currentPage++;
      }
    }

    // Get real stats from DB
    const { count: totalScraped } = await supabase
      .from("bat_crawl_state")
      .select("*", { count: "exact", head: true })
      .eq("crawl_type", crawlType);

    const { count: pendingCount } = await supabase
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .ilike("listing_url", "%bringatrailer%")
      .eq("status", "pending");

    const { count: uniqueUrls } = await supabase
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .ilike("listing_url", "%bringatrailer%");

    return okJson({
      success: true,
      this_run: results,
      totals: {
        pages_scraped: totalScraped || 0,
        unique_urls_queued: uniqueUrls || 0,
        pending_extraction: pendingCount || 0,
      },
      next_page: currentPage,
      message: results.urls_queued > 0
        ? `Queued ${results.urls_queued} new BAT URLs`
        : results.pages_skipped > 0
        ? `Skipped ${results.pages_skipped} already-scraped pages`
        : "No new URLs found in this range",
    });

  } catch (err: any) {
    console.error("[bat-year-crawler] Error:", err);
    return okJson({ success: false, error: err.message }, 500);
  }
});

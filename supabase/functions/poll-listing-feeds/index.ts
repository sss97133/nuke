/**
 * POLL LISTING FEEDS
 *
 * Polls RSS/Atom feeds from configured sources (Craigslist, BaT, Hemmings, etc.)
 * and queues new listings into import_queue. No accounts, no subscriptions,
 * no email -- just direct feed polling.
 *
 * Called on a schedule via pg_cron or manually.
 * Each invocation processes a batch of feeds that are due for polling.
 *
 * POST body (optional):
 *   { "source": "craigslist" }  -- only poll feeds for a specific source
 *   { "feed_id": "uuid" }      -- poll a specific feed
 *   { "batch_size": 10 }       -- how many feeds to poll (default: 10)
 *   { "force": true }          -- ignore poll interval, poll now
 *
 * Fetch strategies:
 *   - Default: fetch feed_url directly and parse RSS/Atom XML.
 *   - search_criteria.fetch_strategy = "firecrawl_html": Craigslist killed RSS,
 *     so the search page is fetched as curated HTML, listing detail URLs are
 *     extracted from the HTML/markdown, and unknown ones are POSTed to the
 *     `ingest` edge function (capped per poll). Firecrawl is tried first, but
 *     Firecrawl refuses craigslist.org outright (HTTP 403 "we do not support
 *     this site"), so on failure we fall back to a direct archiveFetch -- the
 *     static search page carries a full page of /view/d/ share links (verified
 *     2026-07-01). Failures are ALWAYS written to the feed row
 *     (last_error / error_count) -- a silent 0 is a lie.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { extractCraigslistCanonicalUrls } from "../_shared/urlNormalization.ts";
import { isGarbageMake } from "../_shared/normalizeVehicle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── RSS/Atom Parsing ─────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  published: string | null;
  description: string | null;
}

function parseRSS(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Match <item> blocks (RSS 2.0)
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link") || extractAttr(block, "link", "href"),
      published: extractTag(block, "pubDate") || extractTag(block, "dc:date"),
      description: extractTag(block, "description"),
    });
  }

  // If no <item> found, try <entry> (Atom format)
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      items.push({
        title: extractTag(block, "title"),
        link: extractAttr(block, "link", "href") || extractTag(block, "link"),
        published: extractTag(block, "published") || extractTag(block, "updated"),
        description:
          extractTag(block, "summary") || extractTag(block, "content"),
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA
  const cdataRegex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular content
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? decodeEntities(match[1].trim()) : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : "";
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Fetch an RSS/Atom feed URL with a bounded timeout and Nuke's standard bot
 * User-Agent/Accept headers, then parse it into FeedItem[]. Throws (does not
 * swallow) on abort/network failure or a non-2xx response — callers decide
 * how to surface that (failFeed() vs the outer per-feed try/catch), so this
 * stays opinion-free on error handling. Shared by both the rss_direct_ingest
 * strategy and the legacy per-feed RSS loop, which previously duplicated
 * this exact fetch+timeout+parse sequence with an unexplained 20s/15s
 * timeout mismatch between the two copies.
 */
async function fetchAndParseRssFeed(
  feedUrl: string,
  timeoutMs = 15000
): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NukeBot/1.0; vehicle-research)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return parseRSS(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Listing Data Extraction ──────────────────────────────────────

function parseVehicleFromTitle(
  title: string
): Partial<{ year: number; make: string; model: string; price: number }> {
  // Try to match "YEAR MAKE MODEL" pattern
  const ymm = title.match(/(\d{4})\s+([A-Za-z]+(?:\s*-\s*[A-Za-z]+)?)\s+(.+)/);
  if (ymm) {
    const year = parseInt(ymm[1], 10);
    if (year >= 1900 && year <= 2030) {
      const rawMake = ymm[2].trim();
      // Drop a garbage-shaped make (single char / year) — unknown, not garbage. (Gate 5.)
      return {
        year,
        make: isGarbageMake(rawMake) ? undefined : rawMake,
        model: ymm[3].replace(/\s*[-–]\s*\$[\d,]+.*$/, "").trim(), // Remove price from title
      };
    }
  }

  // Just try year
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) {
    return { year: parseInt(yearMatch[1], 10) };
  }

  return {};
}

function parsePriceFromText(text: string): number | null {
  const priceMatch = text.match(/\$\s*([\d,]+)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1].replace(/,/g, ""));
    if (price > 0 && price < 100_000_000) return price;
  }
  return null;
}

function cleanListingUrl(url: string, sourceSlug: string): string {
  let cleaned = url
    .replace(/&amp;/g, "&")
    .split("#")[0]
    .replace(/\/+$/, "");

  // For Craigslist, strip tracking params but keep the listing ID
  if (sourceSlug === "craigslist") {
    // Craigslist URLs: https://city.craigslist.org/cto/d/title/12345.html
    const clMatch = cleaned.match(
      /(https?:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/d\/[^?]+)/
    );
    if (clMatch) cleaned = clMatch[1];
  }

  return cleaned;
}

// ─── Firecrawl HTML Strategy (Craigslist search pages) ───────────

/** Cost bound: max NEW listings sent to `ingest` per feed per poll. */
const MAX_NEW_INGESTS_PER_POLL = 20;

interface FeedResult {
  feed: string;
  source: string;
  items_found: number;
  new_queued?: number; // RSS path
  new_ingested?: number; // firecrawl_html path
  matched_existing?: number; // firecrawl_html path
  rejected?: number; // firecrawl_html path
  ingest_outcomes?: Array<{
    url: string;
    status: string;
    vehicle_id?: string | null;
    error?: string;
    reason?: string;
  }>;
  error: string | null;
}

/**
 * Extract Craigslist listing detail URLs from search-page HTML/markdown.
 * Handles both URL shapes, deduped by listing ID / share token:
 *   https://<city>.craigslist.org/<cat>/d/<slug>/<digits>.html  (canonical)
 *   https://www.craigslist.org/view/d/<slug>/<id-or-base62-token>
 * The current www search UI emits ONLY the share form with base62 tokens
 * (e.g. /view/d/las-vegas-1965-ford-mustang/8436xEWWj3kDbhbnMUV8Fi);
 * `ingest` resolves those to the canonical regional URL before dedup.
 */
function extractCraigslistListingUrls(
  html: string | null,
  markdown: string | null
): string[] {
  const haystack = `${html || ""}\n${markdown || ""}`;
  const byId = new Map<string, string>();
  let m: RegExpExecArray | null;

  // City form first -- it's the canonical shape vehicles.listing_url stores.
  for (const { id, url } of extractCraigslistCanonicalUrls(haystack)) {
    byId.set(id, cleanListingUrl(url, "craigslist"));
  }

  // View form only fills gaps -- same listing ID never yields two URLs.
  // Accepts both legacy numeric IDs and the base62 share tokens the current
  // www search UI emits.
  const viewRegex =
    /https:\/\/www\.craigslist\.org\/view\/d\/[^\/\s"'<>)\]]+\/([A-Za-z0-9]{6,})/gi;
  while ((m = viewRegex.exec(haystack)) !== null) {
    if (!byId.has(m[1])) byId.set(m[1], cleanListingUrl(m[0], "craigslist"));
  }

  return [...new Set(byId.values())];
}

/**
 * Generic listing-URL extraction for non-Craigslist firecrawl_html feeds,
 * driven by per-feed config instead of code:
 *   search_criteria.listing_url_regex  — JS regex source, run with 'gi';
 *     each full match (m[0]) is one listing URL.
 *   search_criteria.listing_url_prefix — origin prepended to relative matches
 *     (a match not starting with http). Relative match + no prefix = dropped.
 * Bounded at 500 distinct URLs — a regex that matches more than that on one
 * search page is matching navigation, not listings.
 */
function extractListingUrlsByRegex(
  html: string | null,
  markdown: string | null,
  regexSource: string,
  prefix: string | null,
  sourceSlug: string
): string[] {
  const haystack = `${html || ""}\n${markdown || ""}`;
  let re: RegExp;
  try {
    re = new RegExp(regexSource, "gi");
  } catch (_) {
    // Invalid regex is a config error — surface it as parsed_zero (the feed
    // row's last_error will carry it via the caller's failFeed path).
    console.error(`[poll-feeds] invalid listing_url_regex for ${sourceSlug}: ${regexSource}`);
    return [];
  }
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null && out.size < 500) {
    // Zero-width match would loop forever — bump lastIndex like the spec does.
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const abs = raw.startsWith("http")
      ? raw
      : prefix
        ? `${prefix.replace(/\/+$/, "")}${raw.startsWith("/") ? "" : "/"}${raw}`
        : null;
    if (abs) out.add(cleanListingUrl(abs, sourceSlug));
  }
  return [...out];
}

/** Cost bound for rss_article_hop: max articles fetched per feed per poll. */
const MAX_ARTICLE_HOPS_PER_POLL = 8;

/**
 * Poll one rss_article_hop feed (e.g. Barn Finds): the RSS items are curated
 * ARTICLES, each covering one for-sale vehicle listed elsewhere; the article
 * body carries the ORIGINAL listing URL (CL/eBay/FB). Two hops:
 *   RSS → new article URLs → fetch article → extract target listing URL via
 *   search_criteria.article_link_regex (first capture group, or m[0] if no
 *   group) → POST the TARGET to `ingest`.
 * Ledger discipline differs from the one-hop path on purpose: the ARTICLE URL
 * is ledgered once processed regardless of the target's ingest outcome —
 * curated posts age out of the RSS within a day, and a login-walled target
 * (FB) would otherwise burn a hop slot retrying forever. One shot per article.
 */
async function pollArticleHopFeed(supabase: any, feed: any): Promise<FeedResult> {
  const result: FeedResult = {
    feed: feed.display_name,
    source: feed.source_slug,
    items_found: 0,
    new_ingested: 0,
    matched_existing: 0,
    rejected: 0,
    ingest_outcomes: [],
    error: null,
  };

  const failFeed = async (message: string): Promise<FeedResult> => {
    result.error = message;
    console.error(`[poll-feeds] ${feed.display_name}: ${message}`);
    await supabase
      .from("listing_feeds")
      .update({
        last_polled_at: new Date().toISOString(),
        last_poll_count: result.items_found,
        error_count: (feed.error_count || 0) + 1,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", feed.id);
    return result;
  };

  const linkRegexSource = feed.search_criteria?.article_link_regex;
  if (!linkRegexSource) {
    return await failFeed("config_error: rss_article_hop requires search_criteria.article_link_regex");
  }
  let linkRegex: RegExp;
  try {
    linkRegex = new RegExp(linkRegexSource, "i");
  } catch (_) {
    return await failFeed(`config_error: invalid article_link_regex ${linkRegexSource}`);
  }

  let articleUrls: string[] = [];
  try {
    const items = await fetchAndParseRssFeed(feed.feed_url);
    articleUrls = [
      ...new Set(
        items.filter((i) => i.link).map((i) => cleanListingUrl(i.link, feed.source_slug))
      ),
    ];
  } catch (err: any) {
    return await failFeed(`fetch_failed: rss ${err?.message || String(err)}`);
  }
  result.items_found = articleUrls.length;
  if (articleUrls.length === 0) return await failFeed("parsed_zero");

  // Skip articles already processed (ledgered under the ARTICLE url).
  const known = new Set<string>();
  for (let i = 0; i < articleUrls.length; i += 40) {
    const chunk = articleUrls.slice(i, i + 40);
    const { data: ledgered, error: ledgerError } = await supabase
      .from("import_queue")
      .select("listing_url")
      .in("listing_url", chunk)
      .in("status", ["complete", "skipped"]);
    if (ledgerError) return await failFeed(`fetch_failed: ledger lookup: ${ledgerError.message}`);
    for (const q of ledgered || []) known.add(q.listing_url);
  }
  result.matched_existing = known.size;
  const fresh = articleUrls.filter((u) => !known.has(u)).slice(0, MAX_ARTICLE_HOPS_PER_POLL);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  for (const articleUrl of fresh) {
    let targetUrl: string | null = null;
    let outcome = "no_target";
    let detail: string | undefined;
    try {
      const page = await archiveFetch(articleUrl, {
        platform: feed.source_slug,
        useFirecrawl: false,
        includeMarkdown: false,
        callerName: "poll-listing-feeds",
      });
      const m = page.html ? linkRegex.exec(page.html) : null;
      targetUrl = m ? (m[1] ?? m[0]) : null;

      if (targetUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 85000); // > ingest's 75s internal enrich timeout
        const resp = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: targetUrl }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const ingest = await resp.json().catch(() => ({
          status: "error",
          error: `ingest HTTP ${resp.status} (non-JSON body)`,
        }));
        outcome = ingest.status || "error";
        detail = ingest.error || ingest.reason;
        if (outcome === "created") result.new_ingested!++;
        else if (outcome === "matched" || outcome === "duplicate") result.matched_existing!++;
        else if (outcome === "rejected") result.rejected!++;
      }
    } catch (err: any) {
      outcome = "error";
      detail = (err?.message || String(err)).slice(0, 200);
    }

    result.ingest_outcomes!.push({
      url: targetUrl || articleUrl,
      status: outcome,
      ...(detail ? { error: String(detail).slice(0, 200) } : {}),
    });

    // One shot per article, whatever happened (see doc comment above).
    const { error: ledgerWriteError } = await supabase.from("import_queue").upsert(
      {
        listing_url: articleUrl,
        status: ["created", "matched", "duplicate"].includes(outcome) ? "complete" : "skipped",
        processed_at: new Date().toISOString(),
        raw_data: {
          feed_id: feed.id,
          ingested_via: "rss_article_hop",
          target_url: targetUrl,
          target_outcome: outcome,
          ...(detail ? { detail: String(detail).slice(0, 200) } : {}),
        },
      },
      { onConflict: "listing_url" }
    );
    if (ledgerWriteError) {
      console.error(`[poll-feeds] article-hop ledger write failed for ${articleUrl}: ${ledgerWriteError.message}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  await supabase
    .from("listing_feeds")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_count: articleUrls.length,
      total_items_found: (feed.total_items_found || 0) + articleUrls.length,
      error_count: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", feed.id);

  return result;
}

/**
 * Poll one firecrawl_html feed: Firecrawl-fetch the search page, extract
 * listing URLs, ingest unknown ones (capped), and write honest bookkeeping
 * to the feed row. Never throws; every failure lands in last_error.
 */
async function pollFirecrawlHtmlFeed(
  supabase: any,
  feed: any
): Promise<FeedResult> {
  const result: FeedResult = {
    feed: feed.display_name,
    source: feed.source_slug,
    items_found: 0,
    new_ingested: 0,
    matched_existing: 0,
    rejected: 0,
    ingest_outcomes: [],
    error: null,
  };

  const failFeed = async (message: string): Promise<FeedResult> => {
    result.error = message;
    console.error(`[poll-feeds] ${feed.display_name}: ${message}`);
    // Deliberately no auto-disable here: this is a curated feed, and a
    // silently-disabled feed is exactly the green lie this path exists to kill.
    await supabase
      .from("listing_feeds")
      .update({
        last_polled_at: new Date().toISOString(),
        last_poll_count: result.items_found,
        error_count: (feed.error_count || 0) + 1,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", feed.id);
    return result;
  };

  // Acquire listing URLs. Two strategies share the ingest/ledger tail below:
  //  - rss_direct_ingest: plain RSS fetch (e.g. BaT /feed/ -- publicly served,
  //    verified 2026-07-02). Item links become listing URLs and go straight
  //    through `ingest`. Bypasses import_queue entirely: nothing drains that
  //    queue (cron 420 off) and refilling it is the 2026-07-01 editorial-slop
  //    landmine.
  //  - firecrawl_html (default): Firecrawl first (renders JS when it works),
  //    but Firecrawl refuses craigslist.org at the API level (403 "we do not
  //    support this site"), so fall back to a direct fetch through
  //    archiveFetch -- the static page carries a full page of /view/d/ share
  //    links (verified 2026-07-01), and the snapshot is archived as a bonus.
  let urls: string[] = [];
  let blockNote = "";

  if (feed.search_criteria?.fetch_strategy === "rss_direct_ingest") {
    try {
      const items = await fetchAndParseRssFeed(feed.feed_url);
      urls = [
        ...new Set(
          items
            .filter((i) => i.link)
            .map((i) => cleanListingUrl(i.link, feed.source_slug))
        ),
      ];
      // Optional per-feed filter: an RSS feed that mixes listings with
      // editorial (or links out to third-party listing pages in the body)
      // can restrict what reaches `ingest` to links matching the configured
      // regex. Same config key as the firecrawl_html path.
      if (feed.search_criteria?.listing_url_regex) {
        try {
          const re = new RegExp(feed.search_criteria.listing_url_regex, "i");
          urls = urls.filter((u) => re.test(u));
        } catch (_) {
          return await failFeed(
            `config_error: invalid listing_url_regex ${feed.search_criteria.listing_url_regex}`
          );
        }
      }
    } catch (err: any) {
      return await failFeed(`fetch_failed: rss ${err?.message || String(err)}`);
    }
  } else {
    let html: string | null = null;
    let markdown: string | null = null;
    const fetchErrors: string[] = [];

    // Server-rendered sources (KSL, Hagerty, ClassicCars) carry their listing
    // links in plain HTML — fetching them through Firecrawl works but spends
    // credits for nothing. prefer_direct_fetch=true tries the free direct
    // fetch first; Firecrawl below remains the fallback either way.
    if (feed.search_criteria?.prefer_direct_fetch === true) {
      try {
        const direct = await archiveFetch(feed.feed_url, {
          platform: feed.source_slug || "unknown",
          skipCache: true,
          useFirecrawl: false,
          includeMarkdown: false,
          callerName: "poll-listing-feeds",
        });
        html = direct.html;
        if (!html && direct.error)
          fetchErrors.push(`direct-first: ${direct.error}`);
      } catch (err: any) {
        fetchErrors.push(`direct-first: ${err?.message || String(err)}`);
      }
    }

    if (!html && (Deno.env.get("FIRECRAWL_API_KEY") || "").trim()) {
      try {
        const scrape = await firecrawlScrape({
          url: feed.feed_url,
          formats: ["html", "markdown"],
          onlyMainContent: false,
          // JS-heavy SPAs (Cars & Bids, Mecum) need longer render waits;
          // bot-walled sites (Hemmings, eBay) need the stealth proxy. Both
          // are per-feed config, not code.
          waitFor: feed.search_criteria?.firecrawl_wait_for ?? 3000,
          timeout: 30000,
          ...(feed.search_criteria?.firecrawl_proxy
            ? { proxy: feed.search_criteria.firecrawl_proxy }
            : {}),
        });
        html = scrape.data.html;
        markdown = scrape.data.markdown;
        if (scrape.blocked) {
          blockNote = ` (blocked: ${scrape.blockedSignals.join(", ")})`;
        }
        if (!html && !markdown) {
          fetchErrors.push(
            `firecrawl: ${scrape.error || `HTTP ${scrape.httpStatus}, empty payload`}`
          );
        }
      } catch (err: any) {
        fetchErrors.push(`firecrawl: ${err?.message || String(err)}`);
      }
    } else {
      fetchErrors.push("firecrawl: FIRECRAWL_API_KEY missing");
    }

    if (!html && !markdown) {
      try {
        const direct = await archiveFetch(feed.feed_url, {
          platform: feed.source_slug || "craigslist",
          skipCache: true, // hourly poll needs a fresh page, not yesterday's
          useFirecrawl: false,
          includeMarkdown: false,
          callerName: "poll-listing-feeds",
        });
        html = direct.html;
        if (!html && direct.error) fetchErrors.push(`direct: ${direct.error}`);
      } catch (err: any) {
        fetchErrors.push(`direct: ${err?.message || String(err)}`);
      }
    }

    if (!html && !markdown) {
      return await failFeed(
        `fetch_failed: ${fetchErrors.join(" | ") || "empty payload"}`
      );
    }

    // Per-feed regex config generalizes this path beyond Craigslist; feeds
    // without a listing_url_regex keep the CL extractor (the original behavior).
    urls = feed.search_criteria?.listing_url_regex
      ? extractListingUrlsByRegex(
          html,
          markdown,
          feed.search_criteria.listing_url_regex,
          feed.search_criteria.listing_url_prefix || null,
          feed.source_slug
        )
      : extractCraigslistListingUrls(html, markdown);
  }

  result.items_found = urls.length;

  if (urls.length === 0) {
    return await failFeed(`parsed_zero${blockNote}`);
  }

  console.log(
    `[poll-feeds] ${feed.display_name}: ${urls.length} listing URLs on search page`
  );

  // Skip listings we already have. Two lookups, both needed:
  //  - vehicles.listing_url stores the CANONICAL regional URL, so it only
  //    matches if a feed ever emits that form directly.
  //  - import_queue.listing_url is THIS poller's ledger of share URLs already
  //    pushed through ingest (written below after each settled outcome).
  //    Without it, the share-vs-canonical mismatch made every listing look
  //    unknown and the 20-cap burned on the same page-top URLs each poll —
  //    the page tail never drained (found 2026-07-02: 24 ingested in 24h
  //    instead of ~150).
  // Chunked: 150+ long share URLs in one .in() overflows the request line
  // (HTTP/2 stream error), so query in batches of 40.
  const knownUrls = new Set<string>();
  for (let i = 0; i < urls.length; i += 40) {
    const chunk = urls.slice(i, i + 40);
    // Independent tables, neither query depends on the other's result —
    // run concurrently instead of paying two sequential round trips per chunk.
    const [
      { data: known, error: knownError },
      { data: ledgered, error: ledgerError },
    ] = await Promise.all([
      supabase.from("vehicles").select("listing_url").in("listing_url", chunk),
      supabase
        .from("import_queue")
        .select("listing_url")
        .in("listing_url", chunk)
        .in("status", ["complete", "skipped"]),
    ]);

    if (knownError) {
      return await failFeed(
        `fetch_failed: known-url lookup: ${knownError.message}`
      );
    }
    for (const v of known || []) knownUrls.add(v.listing_url);

    if (ledgerError) {
      return await failFeed(
        `fetch_failed: ledger lookup: ${ledgerError.message}`
      );
    }
    for (const q of ledgered || []) knownUrls.add(q.listing_url);
  }
  result.matched_existing = knownUrls.size;

  const newUrls = urls.filter((u) => !knownUrls.has(u));
  const toIngest = newUrls.slice(0, MAX_NEW_INGESTS_PER_POLL);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  for (const url of toIngest) {
    try {
      const controller = new AbortController();
      // ingest's own enrichment call (tryAutoEnrich) uses a 75s internal
      // timeout (ingest/index.ts), so a shorter caller-side timeout here
      // aborts mid-enrichment on any listing taking 30-75s to extract,
      // reports it back as a client "error" — which is NOT ledgered (errors
      // retry next poll, by design) — and re-burns a MAX_NEW_INGESTS_PER_POLL
      // slot on the exact same slow URL every future poll. Must exceed 75s.
      const timeout = setTimeout(() => controller.abort(), 85000);

      const resp = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const ingest = await resp.json().catch(() => ({
        status: "error",
        error: `ingest HTTP ${resp.status} (non-JSON body)`,
      }));
      const status = ingest.status || "error";

      result.ingest_outcomes!.push({
        url,
        status,
        vehicle_id: ingest.vehicle_id ?? null,
        ...(ingest.error ? { error: String(ingest.error).slice(0, 200) } : {}),
        ...(ingest.reason ? { reason: String(ingest.reason).slice(0, 200) } : {}),
      });

      if (status === "created") result.new_ingested!++;
      else if (status === "matched" || status === "duplicate")
        result.matched_existing!++;
      else if (status === "rejected") result.rejected!++;

      // Ledger the settled outcome so future polls skip this share URL
      // (vehicles stores the canonical form, which never matches the share
      // form — see the known-check above). Errors are NOT ledgered: they
      // retry next poll. Rejections only ledger when STRUCTURAL (editorial /
      // not-a-vehicle / implausible-year / quality-gate reject); identity-
      // insufficient rejects are often a transient enrichment failure and
      // deserve a retry (the 2026-07-02 VW Thing miss).
      // "quality_gate_reject" covers deterministic gate rejects (e.g.
      // vin_make_mismatch) added 2026-07-07 — the same URL fails the same
      // way every time, so without this it burns a MAX_NEW_INGESTS_PER_POLL
      // slot on every future poll forever.
      const rejectReason = String(ingest.reason || ingest.error || "");
      const structuralReject =
        status === "rejected" &&
        /editorial|not_a_vehicle|not a vehicle|implausible|quality_gate_reject/i.test(rejectReason);
      if (
        ["created", "matched", "duplicate"].includes(status) ||
        structuralReject
      ) {
        const { error: ledgerWriteError } = await supabase
          .from("import_queue")
          .upsert(
            {
              listing_url: url,
              status: status === "rejected" ? "skipped" : "complete",
              vehicle_id: ingest.vehicle_id ?? null,
              processed_at: new Date().toISOString(),
              raw_data: {
                feed_id: feed.id,
                ingested_via: "poll_firecrawl_html",
                ingest_status: status,
                ...(ingest.reason ? { reject_reason: String(ingest.reason).slice(0, 200) } : {}),
              },
            },
            { onConflict: "listing_url" }
          );
        if (ledgerWriteError) {
          // Non-fatal, but say so — a silent ledger gap re-burns cap slots.
          console.error(
            `[poll-feeds] ledger write failed for ${url}: ${ledgerWriteError.message}`
          );
        }
      }
    } catch (err: any) {
      result.ingest_outcomes!.push({
        url,
        status: "error",
        error: (err?.message || String(err)).slice(0, 200),
      });
    }

    // Small delay between ingests to be polite
    await new Promise((r) => setTimeout(r, 250));
  }

  // If every attempted ingest errored, that's a failure too -- say so.
  const ingestErrors = result.ingest_outcomes!.filter(
    (o) => o.status === "error"
  ).length;
  if (toIngest.length > 0 && ingestErrors === toIngest.length) {
    return await failFeed(
      `ingest_failed: ${ingestErrors}/${toIngest.length} ingest calls errored`
    );
  }

  // Success path bookkeeping.
  await supabase
    .from("listing_feeds")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_count: urls.length,
      total_items_found: (feed.total_items_found || 0) + urls.length,
      error_count: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", feed.id);

  return result;
}

// ─── Main Handler ──────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse options
    let source: string | null = null;
    let feedId: string | null = null;
    let batchSize = 10;
    let force = false;

    try {
      const body = await req.json();
      source = body.source || null;
      feedId = body.feed_id || null;
      batchSize = body.batch_size || 10;
      force = body.force || false;
    } catch (_) {
      /* no body is fine */
    }

    // Get feeds that are due for polling
    let query = supabase
      .from("listing_feeds")
      .select("*")
      .eq("enabled", true)
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (feedId) {
      query = query.eq("id", feedId);
    } else if (source) {
      query = query.eq("source_slug", source);
    }

    if (!force) {
      // Only poll feeds that haven't been polled recently
      // (last_polled_at is null OR older than poll_interval_minutes)
      query = query.or(
        `last_polled_at.is.null,last_polled_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`
      );
    }

    const { data: feeds, error: feedError } = await query;

    if (feedError) {
      throw new Error(`Failed to fetch feeds: ${feedError.message}`);
    }

    if (!feeds || feeds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No feeds due for polling",
          feeds_polled: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Honor each feed's own poll_interval_minutes (the SQL filter above is
    // only a coarse 10-minute gate; a 60-min feed must not poll every cron tick).
    const dueFeeds = force
      ? feeds
      : feeds.filter((f: any) => {
          if (!f.last_polled_at) return true;
          const lastPolledMs = new Date(f.last_polled_at).getTime();
          if (Number.isNaN(lastPolledMs)) {
            // Unparseable timestamp would make `Date.now() - NaN >= intervalMs`
            // false forever, silently excluding this feed from every future
            // poll with nothing to signal it's stuck. Treat as due instead.
            console.error(`[poll-feeds] ${f.display_name}: unparseable last_polled_at "${f.last_polled_at}" — treating as due`);
            return true;
          }
          const intervalMs = (f.poll_interval_minutes || 60) * 60 * 1000;
          return Date.now() - lastPolledMs >= intervalMs;
        });

    if (dueFeeds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No feeds due for polling (per-feed interval)",
          feeds_polled: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[poll-feeds] Polling ${dueFeeds.length} feeds...`);

    const results: FeedResult[] = [];

    let totalQueued = 0;
    let totalFound = 0;
    let totalIngested = 0;

    // Stay safely under the platform's edge-function wall-clock ceiling.
    // Sequential per-feed processing with an 85s-per-URL ceiling and up to
    // MAX_NEW_INGESTS_PER_POLL=20 URLs/feed has no upper bound today — a
    // busy multi-feed poll (single-feed bursts have already been observed
    // near 190s in production) can run long enough to be killed mid-loop.
    // A kill mid-loop is safe (each feed's last_polled_at/error_count is
    // only written at the clean end of its own processing, so an unfinished
    // feed simply stays "due" and gets picked up next cron tick), but
    // stopping intentionally, before the platform does it forcibly, is
    // strictly better — and this codebase has already paid for this exact
    // failure mode once (docs/library/technical/extraction-playbook.md
    // FAILURE 14: edge-function batch size too large -> 504).
    const FEED_LOOP_TIME_BUDGET_MS = 240_000;

    for (const feed of dueFeeds) {
      if (Date.now() - startTime > FEED_LOOP_TIME_BUDGET_MS) {
        console.log(`[poll-feeds] Time budget exceeded (${Date.now() - startTime}ms) — stopping early, ${dueFeeds.length - results.length} feed(s) deferred to next cron tick`);
        break;
      }
      // Curated direct-ingest strategies (Craigslist HTML via Firecrawl, BaT
      // RSS). Both bypass the legacy import_queue path entirely and route
      // through `ingest` with the share-URL ledger.
      if (feed.search_criteria?.fetch_strategy === "rss_article_hop") {
        const hopResult = await pollArticleHopFeed(supabase, feed);
        results.push(hopResult);
        totalFound += hopResult.items_found;
        totalIngested += hopResult.new_ingested || 0;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      if (
        ["firecrawl_html", "rss_direct_ingest"].includes(
          feed.search_criteria?.fetch_strategy
        )
      ) {
        const fcResult = await pollFirecrawlHtmlFeed(supabase, feed);
        results.push(fcResult);
        totalFound += fcResult.items_found;
        totalIngested += fcResult.new_ingested || 0;

        // Small delay between feeds to be polite
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      try {
        console.log(`[poll-feeds] Fetching: ${feed.display_name} (${feed.feed_url.slice(0, 80)}...)`);

        const items = await fetchAndParseRssFeed(feed.feed_url);

        console.log(`[poll-feeds] ${feed.display_name}: ${items.length} items in feed`);
        totalFound += items.length;

        // Build import_queue rows
        const rows = items
          .filter((item) => item.link) // Must have a URL
          .map((item) => {
            const url = cleanListingUrl(item.link, feed.source_slug);
            const hints = parseVehicleFromTitle(item.title || "");
            const price =
              parsePriceFromText(item.title || "") ||
              parsePriceFromText(item.description || "");

            return {
              listing_url: url,
              listing_title: (item.title || "").slice(0, 500) || null,
              listing_year: hints.year || null,
              listing_make: hints.make || null,
              listing_model: hints.model || null,
              listing_price: price || null,
              status: "pending",
              priority: 3, // Standard priority for feed items
              raw_data: {
                feed_source: feed.source_slug,
                feed_name: feed.display_name,
                feed_id: feed.id,
                feed_published: item.published || null,
                ingested_via: "feed_poll",
                ingested_at: new Date().toISOString(),
              },
            };
          });

        if (rows.length > 0) {
          // Upsert in chunks of 50 to avoid payload limits
          let newCount = 0;
          for (let i = 0; i < rows.length; i += 50) {
            const chunk = rows.slice(i, i + 50);
            const { data: inserted, error: insertError } = await supabase
              .from("import_queue")
              .upsert(chunk, {
                onConflict: "listing_url",
                ignoreDuplicates: true,
              })
              .select("id");

            if (insertError) {
              console.error(
                `[poll-feeds] Insert error for ${feed.display_name}: ${insertError.message}`
              );
            } else {
              newCount += inserted?.length || 0;
            }
          }

          totalQueued += newCount;

          results.push({
            feed: feed.display_name,
            source: feed.source_slug,
            items_found: items.length,
            new_queued: newCount,
            error: null,
          });

          // Update feed metadata
          await supabase
            .from("listing_feeds")
            .update({
              last_polled_at: new Date().toISOString(),
              last_poll_count: newCount,
              total_items_found: (feed.total_items_found || 0) + newCount,
              error_count: 0,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", feed.id);
        } else {
          results.push({
            feed: feed.display_name,
            source: feed.source_slug,
            items_found: items.length,
            new_queued: 0,
            error: null,
          });

          await supabase
            .from("listing_feeds")
            .update({
              last_polled_at: new Date().toISOString(),
              last_poll_count: 0,
              error_count: 0,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", feed.id);
        }
      } catch (feedErr: any) {
        console.error(
          `[poll-feeds] Error polling ${feed.display_name}: ${feedErr.message}`
        );

        results.push({
          feed: feed.display_name,
          source: feed.source_slug,
          items_found: 0,
          new_queued: 0,
          error: feedErr.message,
        });

        // Update error count
        await supabase
          .from("listing_feeds")
          .update({
            last_polled_at: new Date().toISOString(),
            error_count: (feed.error_count || 0) + 1,
            last_error: feedErr.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", feed.id);

        // Auto-disable feeds with too many consecutive errors
        if ((feed.error_count || 0) >= 10) {
          console.log(
            `[poll-feeds] Disabling ${feed.display_name} after 10 consecutive errors`
          );
          await supabase
            .from("listing_feeds")
            .update({ enabled: false })
            .eq("id", feed.id);
        }
      }

      // Small delay between feeds to be polite
      await new Promise((r) => setTimeout(r, 500));
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[poll-feeds] Done. ${dueFeeds.length} feeds polled, ${totalFound} items found, ${totalQueued} new queued, ${totalIngested} new ingested in ${elapsed}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        feeds_polled: dueFeeds.length,
        total_items_found: totalFound,
        total_new_queued: totalQueued,
        total_new_ingested: totalIngested,
        elapsed_ms: elapsed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[poll-feeds] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

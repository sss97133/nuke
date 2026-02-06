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
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ─── Listing Data Extraction ──────────────────────────────────────

function parseVehicleFromTitle(
  title: string
): Partial<{ year: number; make: string; model: string; price: number }> {
  // Try to match "YEAR MAKE MODEL" pattern
  const ymm = title.match(/(\d{4})\s+([A-Za-z]+(?:\s*-\s*[A-Za-z]+)?)\s+(.+)/);
  if (ymm) {
    const year = parseInt(ymm[1]);
    if (year >= 1900 && year <= 2030) {
      return {
        year,
        make: ymm[2].trim(),
        model: ymm[3].replace(/\s*[-–]\s*\$[\d,]+.*$/, "").trim(), // Remove price from title
      };
    }
  }

  // Just try year
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) {
    return { year: parseInt(yearMatch[1]) };
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

// ─── Main Handler ──────────────────────────────────────────────────

serve(async (req) => {
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

    console.log(`[poll-feeds] Polling ${feeds.length} feeds...`);

    const results: Array<{
      feed: string;
      source: string;
      items_found: number;
      new_queued: number;
      error: string | null;
    }> = [];

    let totalQueued = 0;
    let totalFound = 0;

    for (const feed of feeds) {
      try {
        console.log(`[poll-feeds] Fetching: ${feed.display_name} (${feed.feed_url.slice(0, 80)}...)`);

        // Fetch the feed with a timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(feed.feed_url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; NukeBot/1.0; vehicle-research)",
            Accept:
              "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          },
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xml = await response.text();
        const items = parseRSS(xml);

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
      `[poll-feeds] Done. ${feeds.length} feeds polled, ${totalFound} items found, ${totalQueued} new queued in ${elapsed}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        feeds_polled: feeds.length,
        total_items_found: totalFound,
        total_new_queued: totalQueued,
        elapsed_ms: elapsed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[poll-feeds] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

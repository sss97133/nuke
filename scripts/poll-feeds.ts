#!/usr/bin/env npx tsx
/**
 * POLL LISTING FEEDS - Local Script
 *
 * Polls RSS feeds from Craigslist (and other sites) using your residential IP
 * (which doesn't get blocked like cloud IPs do).
 *
 * Reads feed configs from listing_feeds table, fetches RSS, parses items,
 * and inserts new listings into import_queue.
 *
 * Usage:
 *   npx tsx scripts/poll-feeds.ts                    # Poll all due feeds
 *   npx tsx scripts/poll-feeds.ts --source craigslist # Only Craigslist
 *   npx tsx scripts/poll-feeds.ts --batch 20          # Poll 20 feeds
 *   npx tsx scripts/poll-feeds.ts --force             # Ignore poll interval
 *   npx tsx scripts/poll-feeds.ts --loop              # Run continuously every 15 min
 */

import { createClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CLI Args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sourceFilter = args.includes("--source")
  ? args[args.indexOf("--source") + 1]
  : null;
const batchSize = args.includes("--batch")
  ? parseInt(args[args.indexOf("--batch") + 1])
  : 10;
const force = args.includes("--force");
const loop = args.includes("--loop");
const LOOP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Feed Parsing ──────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  published: string | null;
  description: string | null;
  price: number | null;
  imageUrl: string | null;
  location: string | null;
}

/**
 * Parse Craigslist HTML search results page.
 * CL embeds JSON-LD structured data AND has clean HTML with listing links.
 */
function parseCraigslistHTML(html: string, feedUrl: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Extract the base domain from the feed URL for resolving relative links
  const domainMatch = feedUrl.match(/(https?:\/\/[a-z]+\.craigslist\.org)/);
  const domain = domainMatch ? domainMatch[1] : "";

  // Method 1: Parse JSON-LD structured data (richest source)
  const jsonLdMatch = html.match(
    /\{"@context":"https:\/\/schema\.org","itemListElement":\[([\s\S]*?)\],"@type":"ItemList"\}/
  );

  if (jsonLdMatch) {
    try {
      const fullJson = `{"@context":"https://schema.org","itemListElement":[${jsonLdMatch[1]}],"@type":"ItemList"}`;
      const data = JSON.parse(fullJson);

      if (data.itemListElement) {
        for (const entry of data.itemListElement) {
          const item = entry.item;
          if (!item) continue;

          const name = item.name || "";
          const price = item.offers?.price
            ? parseFloat(item.offers.price)
            : null;
          const location =
            item.offers?.availableAtOrFrom?.address?.addressLocality || null;
          const image = Array.isArray(item.image)
            ? item.image[0]
            : item.image || null;

          // We don't get the URL from JSON-LD, so we'll merge with HTML links below
          items.push({
            title: name,
            link: "", // Will be filled from HTML
            published: null,
            description: null,
            price: price && price > 0 ? price : null,
            imageUrl: image,
            location,
          });
        }
      }
    } catch (e) {
      // JSON-LD parse failed, fall through to HTML parsing
    }
  }

  // Method 2: Parse HTML listing links (always works, gives us URLs)
  const htmlItems: { url: string; title: string; price: number | null }[] = [];

  // Pattern: <li class="cl-static-search-result" title="..."><a href="URL">
  const listingRegex =
    /<li\s+class="cl-static-search-result"\s+title="([^"]*)">\s*<a\s+href="([^"]+)">/gi;
  let m;
  while ((m = listingRegex.exec(html)) !== null) {
    const title = decodeEntities(m[1]);
    const url = m[2];

    // Try to find price in the next few chars
    const afterMatch = html.slice(m.index, m.index + 500);
    const priceMatch = afterMatch.match(
      /<div\s+class="price">\$?([\d,]+)<\/div>/
    );
    const price = priceMatch
      ? parseInt(priceMatch[1].replace(/,/g, ""))
      : null;

    htmlItems.push({ url, title, price });
  }

  // Merge: if we have JSON-LD items, attach URLs from HTML. Otherwise use HTML items.
  if (items.length > 0 && htmlItems.length > 0) {
    // Match by index (they're in the same order)
    for (let i = 0; i < items.length && i < htmlItems.length; i++) {
      items[i].link = htmlItems[i].url;
      if (!items[i].price && htmlItems[i].price) {
        items[i].price = htmlItems[i].price;
      }
    }
    // Remove items without links
    return items.filter((item) => item.link);
  }

  // Fallback: just use HTML items
  if (htmlItems.length > 0) {
    return htmlItems.map((h) => ({
      title: h.title,
      link: h.url,
      published: null,
      description: null,
      price: h.price,
      imageUrl: null,
      location: null,
    }));
  }

  // Last resort: regex for any CL listing URLs
  const urlRegex =
    /https?:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/d\/[^\s"'<>]+\.html/gi;
  const urls = new Set<string>();
  while ((m = urlRegex.exec(html)) !== null) {
    urls.add(m[0]);
  }
  return [...urls].map((url) => ({
    title: "",
    link: url,
    published: null,
    description: null,
    price: null,
    imageUrl: null,
    location: null,
  }));
}

/**
 * Parse RSS 2.0 or Atom feed XML.
 */
function parseRSS(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // RSS 2.0 <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link") || extractAttr(block, "link", "href"),
      published: extractTag(block, "pubDate") || extractTag(block, "dc:date"),
      description: extractTag(block, "description"),
      price: null,
      imageUrl: null,
      location: null,
    });
  }

  // Atom <entry> blocks
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      items.push({
        title: extractTag(block, "title"),
        link: extractAttr(block, "link", "href") || extractTag(block, "link"),
        published:
          extractTag(block, "published") || extractTag(block, "updated"),
        description:
          extractTag(block, "summary") || extractTag(block, "content"),
        price: null,
        imageUrl: null,
        location: null,
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const cdataRegex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(regex);
  return m ? decodeEntities(m[1].trim()) : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = xml.match(regex);
  return m ? m[1] : "";
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
 * Decide how to parse the response based on feed source.
 */
function parseFeedResponse(
  body: string,
  sourceSlug: string,
  feedUrl: string
): FeedItem[] {
  if (sourceSlug === "craigslist") {
    return parseCraigslistHTML(body, feedUrl);
  }
  return parseRSS(body);
}

// ─── Vehicle Parsing ───────────────────────────────────────────────

function parseVehicleFromTitle(title: string) {
  const ymm = title.match(
    /(\d{4})\s+([A-Za-z]+(?:\s*-\s*[A-Za-z]+)?)\s+(.+)/
  );
  if (ymm) {
    const year = parseInt(ymm[1]);
    if (year >= 1900 && year <= 2030) {
      return {
        year,
        make: ymm[2].trim(),
        model: ymm[3].replace(/\s*[-–]\s*\$[\d,]+.*$/, "").trim(),
      };
    }
  }
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) return { year: parseInt(yearMatch[1]) };
  return {};
}

function parsePriceFromText(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+)/);
  if (m) {
    const price = parseInt(m[1].replace(/,/g, ""));
    if (price > 0 && price < 100_000_000) return price;
  }
  return null;
}

function cleanListingUrl(url: string, sourceSlug: string): string {
  let cleaned = url.replace(/&amp;/g, "&").split("#")[0].replace(/\/+$/, "");
  if (sourceSlug === "craigslist") {
    const clMatch = cleaned.match(
      /(https?:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/d\/[^?]+)/
    );
    if (clMatch) cleaned = clMatch[1];
  }
  return cleaned;
}

// ─── Polling ───────────────────────────────────────────────────────

async function pollFeeds() {
  const startTime = Date.now();

  // Get feeds due for polling
  let query = supabase
    .from("listing_feeds")
    .select("*")
    .eq("enabled", true)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (sourceFilter) {
    query = query.eq("source_slug", sourceFilter);
  }

  if (!force) {
    query = query.or(
      `last_polled_at.is.null,last_polled_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`
    );
  }

  const { data: feeds, error: feedError } = await query;

  if (feedError) {
    console.error(`❌ Failed to fetch feeds: ${feedError.message}`);
    return;
  }

  if (!feeds || feeds.length === 0) {
    console.log("✅ No feeds due for polling.");
    return;
  }

  console.log(`\n📡 Polling ${feeds.length} feeds...\n`);

  let totalQueued = 0;
  let totalFound = 0;
  let errors = 0;

  for (const feed of feeds) {
    try {
      process.stdout.write(`  ${feed.display_name}... `);

      const response = await fetch(feed.feed_url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = await response.text();
      const items = parseFeedResponse(body, feed.source_slug, feed.feed_url);
      totalFound += items.length;

      // Build import rows
      const rows = items
        .filter((item) => item.link)
        .map((item) => {
          const url = cleanListingUrl(item.link, feed.source_slug);
          const hints = parseVehicleFromTitle(item.title || "");
          // Use price from structured data first, then try parsing from text
          const price =
            item.price ||
            parsePriceFromText(item.title || "") ||
            parsePriceFromText(item.description || "");

          return {
            listing_url: url,
            listing_title: (item.title || "").slice(0, 500) || null,
            listing_year: (hints as any).year || null,
            listing_make: (hints as any).make || null,
            listing_model: (hints as any).model || null,
            listing_price: price || null,
            thumbnail_url: item.imageUrl || null,
            status: "pending",
            priority: 3,
            raw_data: {
              feed_source: feed.source_slug,
              feed_name: feed.display_name,
              feed_id: feed.id,
              feed_published: item.published || null,
              feed_location: item.location || null,
              ingested_via: "feed_poll",
              ingested_at: new Date().toISOString(),
            },
          };
        });

      let newCount = 0;
      if (rows.length > 0) {
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
            console.error(`\n    Insert error: ${insertError.message}`);
          } else {
            newCount += inserted?.length || 0;
          }
        }
      }

      totalQueued += newCount;

      console.log(
        `${items.length} items, ${newCount} new` +
          (newCount > 0 ? " ✨" : "")
      );

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
    } catch (err: any) {
      console.log(`❌ ${err.message}`);
      errors++;

      await supabase
        .from("listing_feeds")
        .update({
          last_polled_at: new Date().toISOString(),
          error_count: (feed.error_count || 0) + 1,
          last_error: err.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", feed.id);

      if ((feed.error_count || 0) >= 10) {
        console.log(`    ⚠️  Disabled after 10 consecutive errors`);
        await supabase
          .from("listing_feeds")
          .update({ enabled: false })
          .eq("id", feed.id);
      }
    }

    // Be polite between fetches
    await new Promise((r) => setTimeout(r, 800));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n📊 Done: ${feeds.length} feeds polled, ${totalFound} items found, ${totalQueued} new queued, ${errors} errors (${elapsed}s)\n`
  );
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Nuke Feed Poller");
  console.log(
    `   Source: ${sourceFilter || "all"} | Batch: ${batchSize} | Force: ${force} | Loop: ${loop}`
  );

  if (loop) {
    console.log(
      `   Running continuously, polling every ${LOOP_INTERVAL_MS / 60000} minutes. Ctrl+C to stop.\n`
    );
    while (true) {
      await pollFeeds();
      console.log(
        `⏰ Next poll at ${new Date(Date.now() + LOOP_INTERVAL_MS).toLocaleTimeString()}\n`
      );
      await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MS));
    }
  } else {
    await pollFeeds();
  }
}

main().catch(console.error);

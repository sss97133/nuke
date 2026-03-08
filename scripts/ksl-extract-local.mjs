#!/usr/bin/env node
/**
 * KSL Local Extractor
 *
 * Fetches KSL listing pages from residential IP, parses HTML locally,
 * and upserts extracted data into Supabase. KSL blocks datacenter IPs
 * but serves fine from residential connections.
 *
 * Usage:
 *   dotenvx run -- node scripts/ksl-extract-local.mjs                    # Process all pending KSL in import_queue
 *   dotenvx run -- node scripts/ksl-extract-local.mjs --url <ksl-url>    # Extract single listing
 *   dotenvx run -- node scripts/ksl-extract-local.mjs --batch 50         # Process N pending
 *   dotenvx run -- node scripts/ksl-extract-local.mjs --requeue          # Requeue skipped KSL listings first
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];
function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

const MULTI_WORD_MAKES = [
  "Land Rover", "Aston Martin", "Alfa Romeo", "Mercedes-Benz",
  "AM General", "De Tomaso", "Rolls-Royce", "Austin-Healey",
];

// ─── Parsing (same logic as edge function) ───────────────────

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/<!--.*?-->/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
}

function parseYearMakeModel(titleStr) {
  const cleaned = titleStr.replace(/\s*\|.*$/, "").replace(/\s+in\s+.+$/, "").trim();
  const m = cleaned.match(/^(\d{4})\s+(.+)/);
  if (!m) return { year: null, make: null, model: null };
  const year = parseInt(m[1], 10);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null };
  const remainder = m[2].trim();
  for (const mwm of MULTI_WORD_MAKES) {
    if (remainder.toLowerCase().startsWith(mwm.toLowerCase())) {
      return { year, make: mwm, model: remainder.slice(mwm.length).trim() || null };
    }
  }
  const parts = remainder.split(/\s+/);
  return { year, make: parts[0] || null, model: parts.slice(1).join(" ") || null };
}

function extractFromHtml(html, url) {
  const listingIdMatch = url.match(/listing\/(\d+)/);
  const kslListingId = listingIdMatch ? listingIdMatch[1] : "";

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const rawTitle = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'") : null;
  const { year, make, model } = parseYearMakeModel(rawTitle || "");

  const priceMatch = html.match(/aria-label="Price\s*\$([0-9,]+)"/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null;

  const mileageMatch = html.match(/Mileage:\s*(?:<!--\s*-->)?\s*([\d,]+)/);
  const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ""), 10) : null;

  const locationMatch = rawTitle?.match(/in\s+(.+?)\s*\|/);
  const location = locationMatch ? locationMatch[1].trim() : null;

  const imageRegex = /https:\/\/image\.ksldigital\.com\/[a-f0-9-]+\.jpg/g;
  const imageSet = new Set();
  let imgMatch;
  while ((imgMatch = imageRegex.exec(html)) !== null) imageSet.add(imgMatch[0]);
  const imageUrls = [...imageSet];

  // Description
  let description = null;
  const descStart = html.indexOf("description-tabs-section");
  if (descStart > -1) {
    const descEnd = html.indexOf("contact-card", descStart);
    const section = html.slice(descStart, descEnd > -1 ? descEnd : descStart + 5000);
    const text = stripHtml(section)
      .replace(/Description|Map|Specifications|Payment Calculator.*$/s, "")
      .trim();
    if (text.length > 20) description = text.slice(0, 2000);
  }

  // Options
  const optionsMatch = html.match(/Options:\s*<\/[^>]+>\s*<[^>]+>([^<]+)/);
  let options = [];
  if (optionsMatch) {
    options = optionsMatch[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&")
      .split(",").map((o) => o.trim()).filter((o) => o.length > 1);
  }

  const isDealer = /Trusted Dealer|dealer/i.test(html);
  const viewsMatch = html.match(/Page Views\s*<\/[^>]+>\s*<[^>]+>([\d,]+)/);
  const favMatch = html.match(/Favorited\s*<\/[^>]+>\s*<[^>]+>([\d,]+)/);
  const postedMatch = html.match(/Posted\s*<\/[^>]+>\s*<[^>]+>([^<]+)/);

  return {
    url, ksl_listing_id: kslListingId, title: rawTitle?.replace(/\s*\|.*$/, "").trim() || null,
    year, make, model, price, mileage, location, description, options, image_urls: imageUrls,
    seller_type: isDealer ? "dealer" : "private",
    page_views: viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ""), 10) : null,
    favorited: favMatch ? parseInt(favMatch[1].replace(/,/g, ""), 10) : null,
    posted_date: postedMatch ? postedMatch[1].trim() : null,
  };
}

// ─── Fetch + Extract ──────────────────────────────────────────

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

async function fetchAndExtract(url) {
  let html;
  let fetchMethod = "direct";

  if (FIRECRAWL_API_KEY) {
    // Use Firecrawl — bypasses IP bans via their proxy network
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + FIRECRAWL_API_KEY,
      },
      body: JSON.stringify({ url, formats: ["html"] }),
    });

    const result = await res.json();
    if (!result.success) {
      throw new Error(`Firecrawl error: ${result.error || JSON.stringify(result)}`);
    }
    html = result.data?.html || "";
    fetchMethod = "firecrawl";
  } else {
    // Fallback: direct fetch (needs residential IP)
    const res = await fetch(url, {
      headers: { "User-Agent": randomUA() },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    html = await res.text();
    fetchMethod = "direct";
  }

  if (html.length < 5000) {
    throw new Error(`Suspiciously small response: ${html.length} bytes`);
  }

  const data = extractFromHtml(html, url);

  // Archive HTML
  await supabase.from("listing_page_snapshots").upsert(
    { url, html, platform: "ksl", fetched_at: new Date().toISOString(), fetch_method: fetchMethod, content_length: html.length },
    { onConflict: "url" },
  ).then(() => {}, () => {});

  return data;
}

// ─── Queue Processing ─────────────────────────────────────────

async function requeue() {
  const { count } = await supabase
    .from("import_queue")
    .select("*", { count: "exact", head: true })
    .ilike("listing_url", "%ksl.com%")
    .eq("status", "skipped");

  if (!count) {
    console.log("No skipped KSL items to requeue.");
    return 0;
  }

  const { error } = await supabase
    .from("import_queue")
    .update({
      status: "pending",
      error_message: null,
      failure_category: null,
      attempts: 0,
      locked_at: null,
      locked_by: null,
    })
    .ilike("listing_url", "%ksl.com%")
    .eq("status", "skipped");

  if (error) {
    console.error("Requeue error:", error.message);
    return 0;
  }

  console.log(`Requeued ${count} KSL listings.`);
  return count;
}

async function processBatch(batchSize) {
  // Grab pending KSL items
  const { data: items, error } = await supabase
    .from("import_queue")
    .select("id, listing_url, raw_data")
    .ilike("listing_url", "%ksl.com%")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  if (!items?.length) {
    console.log("No pending KSL listings.");
    return;
  }

  console.log(`Processing ${items.length} KSL listings...\n`);

  let success = 0, failed = 0, consecutive403 = 0;

  for (const item of items) {
    try {
      // Lock it
      await supabase.from("import_queue").update({
        locked_at: new Date().toISOString(),
        locked_by: "ksl-extract-local",
        last_attempt_at: new Date().toISOString(),
      }).eq("id", item.id);

      const data = await fetchAndExtract(item.listing_url);

      // Update import_queue
      await supabase.from("import_queue").update({
        status: "completed",
        listing_title: data.title,
        listing_year: data.year,
        listing_make: data.make,
        listing_model: data.model,
        listing_price: data.price,
        thumbnail_url: data.image_urls[0] || null,
        processed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        extractor_version: "ksl-extract-local@1.0",
        raw_data: {
          ...(item.raw_data || {}),
          extraction: {
            mileage: data.mileage,
            location: data.location,
            seller_type: data.seller_type,
            image_count: data.image_urls.length,
            options_count: data.options.length,
            page_views: data.page_views,
            favorited: data.favorited,
            posted_date: data.posted_date,
            ksl_listing_id: data.ksl_listing_id,
          },
        },
      }).eq("id", item.id);

      success++;
      consecutive403 = 0; // Reset on success
      const tier = data.year && data.year < 2000 ? "vintage" : data.year && data.year < 2014 ? "modern" : "current";
      console.log(`  ✓ ${data.year} ${data.make} ${data.model} — $${data.price?.toLocaleString() || "?"} — ${data.image_urls.length} imgs — ${data.location || "?"} [${tier}]`);

      // Rate limit: 8-15s between requests (KSL temp-bans IPs after bursts)
      const delay = 8000 + Math.random() * 7000;
      await new Promise((r) => setTimeout(r, delay));

    } catch (err) {
      failed++;
      console.error(`  ✗ ${item.listing_url}: ${err.message}`);

      await supabase.from("import_queue").update({
        status: "failed",
        error_message: err.message,
        failure_category: err.message.includes("403") ? "blocked" : "fetch_error",
        attempts: (item.attempts || 0) + 1,
        locked_at: null,
        locked_by: null,
      }).eq("id", item.id);

      // Back off longer on errors (rate limit or block)
      if (err.message.includes("403")) {
        consecutive403++;
        if (consecutive403 >= 3) {
          console.log(`\n  ⛔ ${consecutive403} consecutive 403s — IP likely temp-banned. Stopping.`);
          console.log(`     Try again in a few hours. Run: dotenvx run -- node scripts/ksl-extract-local.mjs --batch ${batchSize}`);
          break;
        }
        const backoff = 30000 * consecutive403; // Escalating backoff
        console.log(`    Backing off ${backoff/1000}s (403 #${consecutive403})...`);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  console.log(`\nDone: ${success} extracted, ${failed} failed out of ${items.length}`);
}

// ─── Single URL Mode ─────────────────────────────────────────

async function extractSingle(url) {
  console.log(`Extracting: ${url}`);
  const data = await fetchAndExtract(url);
  console.log(JSON.stringify(data, null, 2));
}

// ─── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--requeue")) {
  await requeue();
}

if (args.includes("--url")) {
  const urlIdx = args.indexOf("--url");
  await extractSingle(args[urlIdx + 1]);
} else {
  const batchIdx = args.indexOf("--batch");
  const batchSize = batchIdx > -1 ? parseInt(args[batchIdx + 1], 10) : 50;
  await processBatch(batchSize);
}

#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Full Collector
 *
 * Single script that handles the complete pipeline:
 * 1. Bot UA finds listing IDs from search (works locally)
 * 2. Playwright extracts full details (description, images, seller)
 *
 * Designed for reliability:
 * - Long delays to avoid rate limits
 * - Retry logic with exponential backoff
 * - Rotates user agents
 * - Saves progress, can resume
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-marketplace-full-collector.ts
 *   dotenvx run -- npx tsx scripts/fb-marketplace-full-collector.ts --state=TX
 *   dotenvx run -- npx tsx scripts/fb-marketplace-full-collector.ts --resume
 */

import { createClient } from "@supabase/supabase-js";
import { chromium, Browser, Page } from "playwright";
import * as fs from "fs/promises";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CONFIG = {
  // User agents to rotate
  USER_AGENTS: [
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ],

  YEAR_MIN: 1960,
  YEAR_MAX: 1999,

  // Timing - conservative to avoid blocks
  DELAY_BETWEEN_LOCATIONS_MS: 45000,  // 45 sec between location searches
  DELAY_BETWEEN_DETAILS_MS: 8000,     // 8 sec between detail extractions
  DELAY_ON_ERROR_MS: 120000,          // 2 min pause on error

  MAX_RETRIES: 3,
  MAX_DETAILS_PER_RUN: 50,  // Limit Playwright extractions per run

  PROGRESS_FILE: "/Users/skylar/nuke/logs/fb-collector-progress.json",
};

interface Progress {
  last_location_index: number;
  locations_completed: string[];
  listings_needing_details: string[];
  started_at: string;
  last_updated: string;
}

interface FoundListing {
  facebook_id: string;
  title: string;
  price: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  url: string;
}

let browser: Browser | null = null;
let uaIndex = 0;

async function main() {
  const args = process.argv.slice(2);
  const stateFilter = args.find(a => a.startsWith("--state="))?.split("=")[1];
  const shouldResume = args.includes("--resume");
  const detailsOnly = args.includes("--details-only");

  console.log("🔵 Facebook Marketplace Full Collector");
  console.log("======================================");
  console.log(`State filter: ${stateFilter || "ALL"}`);
  console.log(`Year range: ${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`);
  console.log(`Resume mode: ${shouldResume}`);
  console.log(`Details only: ${detailsOnly}`);
  console.log();

  // Load or create progress
  let progress = await loadProgress();
  if (!shouldResume) {
    progress = createFreshProgress();
  }

  try {
    if (!detailsOnly) {
      // Phase 1: Discovery - find listing IDs
      await runDiscoveryPhase(progress, stateFilter);
    }

    // Phase 2: Details - extract full info via Playwright
    await runDetailsPhase(progress);

  } catch (err: any) {
    console.error(`\n❌ Fatal error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
    await saveProgress(progress);
  }

  printSummary(progress);
}

async function runDiscoveryPhase(progress: Progress, stateFilter?: string) {
  console.log("\n📡 PHASE 1: Discovery (Bot UA)");
  console.log("-------------------------------");

  // Get locations
  let query = supabase
    .from("fb_marketplace_locations")
    .select("id, name, state_code")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true });

  if (stateFilter) {
    query = query.eq("state_code", stateFilter.toUpperCase());
  }

  const { data: locations, error } = await query;
  if (error || !locations?.length) {
    console.log("No locations to process");
    return;
  }

  // Filter out completed locations
  const remaining = locations.filter(l => !progress.locations_completed.includes(l.id));
  console.log(`Locations: ${remaining.length} remaining (${progress.locations_completed.length} completed)\n`);

  for (let i = 0; i < remaining.length; i++) {
    const location = remaining[i];
    const progress_str = `[${i + 1}/${remaining.length}]`;

    try {
      process.stdout.write(`${progress_str} ${location.name}, ${location.state_code}... `);

      const listings = await discoverListings(location.name);

      // Check which are new
      let newCount = 0;
      for (const listing of listings) {
        const { data: existing } = await supabase
          .from("marketplace_listings")
          .select("id, description")
          .eq("facebook_id", listing.facebook_id)
          .single();

        if (!existing) {
          // Store new listing
          await supabase.from("marketplace_listings").insert({
            facebook_id: listing.facebook_id,
            platform: "facebook_marketplace",
            url: listing.url,
            title: listing.title,
            price: listing.price,
            current_price: listing.price,
            extracted_year: listing.year,
            parsed_year: listing.year,
            parsed_make: listing.make?.toLowerCase(),
            parsed_model: listing.model?.toLowerCase(),
            status: "active",
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          });
          newCount++;
          progress.listings_needing_details.push(listing.facebook_id);
        } else if (!existing.description) {
          // Exists but needs details
          if (!progress.listings_needing_details.includes(listing.facebook_id)) {
            progress.listings_needing_details.push(listing.facebook_id);
          }
        }
      }

      console.log(`${listings.length} found, ${newCount} new`);

      // Update location
      await supabase
        .from("fb_marketplace_locations")
        .update({ last_sweep_at: new Date().toISOString(), last_sweep_listings: listings.length })
        .eq("id", location.id);

      progress.locations_completed.push(location.id);
      progress.last_updated = new Date().toISOString();

      // Save progress periodically
      if (i % 10 === 0) await saveProgress(progress);

      // Delay
      if (i < remaining.length - 1) {
        await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS_MS);
      }

    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);

      // Longer pause on error
      console.log(`   Pausing ${CONFIG.DELAY_ON_ERROR_MS / 1000}s...`);
      await sleep(CONFIG.DELAY_ON_ERROR_MS);
    }
  }
}

async function runDetailsPhase(progress: Progress) {
  if (progress.listings_needing_details.length === 0) {
    console.log("\n✅ No listings need detail extraction");
    return;
  }

  console.log(`\n🎭 PHASE 2: Details (Playwright)`);
  console.log("----------------------------------");
  console.log(`Listings needing details: ${progress.listings_needing_details.length}`);
  console.log(`Will extract up to: ${CONFIG.MAX_DETAILS_PER_RUN}\n`);

  // Launch browser
  browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  const toExtract = progress.listings_needing_details.slice(0, CONFIG.MAX_DETAILS_PER_RUN);
  let extracted = 0;

  for (let i = 0; i < toExtract.length; i++) {
    const fbId = toExtract[i];
    const progress_str = `[${i + 1}/${toExtract.length}]`;

    try {
      process.stdout.write(`${progress_str} ${fbId}... `);

      const url = `https://www.facebook.com/marketplace/item/${fbId}/`;
      const details = await extractDetails(page, url);

      if (details && (details.description || details.images.length > 0)) {
        await supabase
          .from("marketplace_listings")
          .update({
            description: details.description,
            all_images: details.images.length > 0 ? details.images : null,
            image_url: details.images[0] || null,
            seller_name: details.seller_name,
            seller_profile_url: details.seller_profile_url,
            location: details.location,
            mileage: details.mileage,
          })
          .eq("facebook_id", fbId);

        console.log(`✓ ${details.images.length} imgs, ${details.description?.length || 0} chars`);
        extracted++;

        // Remove from needing details
        progress.listings_needing_details = progress.listings_needing_details.filter(id => id !== fbId);
      } else {
        console.log(`- no data (login wall?)`);
      }

      if (i < toExtract.length - 1) {
        await sleep(CONFIG.DELAY_BETWEEN_DETAILS_MS);
      }

    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log(`\nExtracted details for ${extracted}/${toExtract.length} listings`);
}

async function discoverListings(locationName: string): Promise<FoundListing[]> {
  const slug = locationName.split(",")[0].toLowerCase().replace(/\s+/g, "");
  const url = `https://www.facebook.com/marketplace/${slug}/vehicles?minYear=${CONFIG.YEAR_MIN}&maxYear=${CONFIG.YEAR_MAX}&sortBy=creation_time_descend`;

  // Rotate user agent
  const ua = CONFIG.USER_AGENTS[uaIndex % CONFIG.USER_AGENTS.length];
  uaIndex++;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();

      if (!html.includes("marketplace_listing_title")) {
        if (html.includes("login")) {
          throw new Error("Login wall");
        }
        return []; // No listings found
      }

      // Parse listings
      const titleMatches = html.match(/"marketplace_listing_title":"([^"]+)"/g) || [];
      const priceMatches = html.match(/"amount_with_offset_in_currency":"(\d+)"/g) || [];
      const idMatches = html.match(/"id":"(\d{10,})"/g) || [];

      const listings: FoundListing[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < titleMatches.length; i++) {
        const titleMatch = titleMatches[i].match(/"marketplace_listing_title":"([^"]+)"/);
        const priceMatch = priceMatches[i]?.match(/"amount_with_offset_in_currency":"(\d+)"/);
        const idMatch = idMatches[i]?.match(/"id":"(\d+)"/);

        if (titleMatch && idMatch && !seenIds.has(idMatch[1])) {
          seenIds.add(idMatch[1]);
          const title = decodeUnicode(titleMatch[1]);
          const price = priceMatch ? parseInt(priceMatch[1]) / 100 : null;
          const parsed = parseTitle(title);

          if (parsed.year && parsed.year >= CONFIG.YEAR_MIN && parsed.year <= CONFIG.YEAR_MAX) {
            listings.push({
              facebook_id: idMatch[1],
              title,
              price,
              year: parsed.year,
              make: parsed.make,
              model: parsed.model,
              url: `https://www.facebook.com/marketplace/item/${idMatch[1]}/`,
            });
          }
        }
      }

      return listings;

    } catch (err: any) {
      lastError = err;
      if (attempt < CONFIG.MAX_RETRIES - 1) {
        await sleep(5000 * (attempt + 1)); // Exponential backoff
      }
    }
  }

  throw lastError || new Error("Discovery failed");
}

async function extractDetails(page: Page, url: string): Promise<{
  description: string | null;
  images: string[];
  seller_name: string | null;
  seller_profile_url: string | null;
  location: string | null;
  mileage: number | null;
} | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    // Dismiss login modal
    await page.keyboard.press("Escape");
    await sleep(500);

    try {
      const closeBtn = await page.$('[aria-label="Close"]');
      if (closeBtn) await closeBtn.click();
    } catch {}

    await sleep(1000);

    // Extract
    return await page.evaluate(() => {
      const result: any = {
        description: null,
        images: [],
        seller_name: null,
        seller_profile_url: null,
        location: null,
        mileage: null,
      };

      // Description
      const bodyText = document.body.innerText;
      const descPatterns = [
        /(?:Description|About this vehicle|Details)[\s\S]{0,30}?([\s\S]{50,3000}?)(?=Seller information|See less|Message|Listed|Location|$)/i,
      ];
      for (const pattern of descPatterns) {
        const match = bodyText.match(pattern);
        if (match && match[1].length > 30) {
          result.description = match[1].trim().substring(0, 5000);
          break;
        }
      }

      // Images
      const imgs = new Set<string>();
      document.querySelectorAll('img[src*="scontent"]').forEach((img: any) => {
        if (img.src && !img.src.includes('_s.') && !img.src.includes('_t.') && !img.src.includes('emoji')) {
          imgs.add(img.src);
        }
      });
      result.images = Array.from(imgs).slice(0, 30);

      // Location
      const locMatch = bodyText.match(/(?:Listed in|Location)[:\s]*([A-Za-z\s]+,\s*[A-Z]{2})/i);
      if (locMatch) result.location = locMatch[1];

      // Mileage
      const mileMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi)\b/i);
      if (mileMatch) result.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

      // Seller
      const sellerMatch = bodyText.match(/(?:Seller|Listed by)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
      if (sellerMatch) result.seller_name = sellerMatch[1];

      const profileLink = document.querySelector('a[href*="/marketplace/profile/"]') as HTMLAnchorElement;
      if (profileLink) result.seller_profile_url = profileLink.href;

      return result;
    });

  } catch (err) {
    return null;
  }
}

// Helpers
function parseTitle(title: string) {
  const yearMatch = title.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  if (!yearMatch) return { year: null, make: null, model: null };
  const year = parseInt(yearMatch[1]);
  const after = title.split(String(year))[1]?.trim() || "";
  const words = after.split(/\s+/).filter(w => w.length > 0);
  return { year, make: words[0] || null, model: words.slice(1, 3).join(" ") || null };
}

function decodeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function loadProgress(): Promise<Progress> {
  try {
    const data = await fs.readFile(CONFIG.PROGRESS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return createFreshProgress();
  }
}

function createFreshProgress(): Progress {
  return {
    last_location_index: 0,
    locations_completed: [],
    listings_needing_details: [],
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

async function saveProgress(progress: Progress) {
  progress.last_updated = new Date().toISOString();
  await fs.writeFile(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function printSummary(progress: Progress) {
  console.log("\n======================================");
  console.log("📊 Summary");
  console.log("======================================");
  console.log(`Locations completed: ${progress.locations_completed.length}`);
  console.log(`Listings still needing details: ${progress.listings_needing_details.length}`);
  console.log(`Progress saved to: ${CONFIG.PROGRESS_FILE}`);
  console.log(`\nTo continue: dotenvx run -- npx tsx scripts/fb-marketplace-full-collector.ts --resume`);
}

main().catch(console.error);

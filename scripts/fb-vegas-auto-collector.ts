#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Vegas Automatic Collector
 *
 * Automated collection of all vintage vehicles (1960-1999) within 200 miles of Vegas.
 * Runs autonomously after initial login. Tracks sellers and listings.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-vegas-auto-collector.ts
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as readline from "readline";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const COOKIES_FILE = "/Users/skylar/nuke/logs/fb-session-cookies.json";
const PROGRESS_FILE = "/Users/skylar/nuke/logs/vegas-collector-progress.json";
const SELLERS_FILE = "/Users/skylar/nuke/logs/vegas-sellers.json";

const CONFIG = {
  // Vegas coordinates: 36.1699° N, 115.1398° W
  VEGAS_LAT: 36.1699,
  VEGAS_LNG: -115.1398,
  RADIUS_MILES: 200,

  YEAR_MIN: 1960,
  YEAR_MAX: 1999,

  // Delays
  SCROLL_DELAY_MS: 2000,
  BETWEEN_LISTINGS_MS: 3000,
  BETWEEN_SCROLLS_MS: 1500,
  SAVE_INTERVAL_MS: 60000, // Save progress every minute

  // Limits
  MAX_SCROLL_ATTEMPTS: 100, // Keep scrolling until no new listings
  MAX_LISTINGS_PER_SESSION: 2000,
};

interface Listing {
  id: string;
  title: string;
  price: string | null;
  url: string;
  year: number | null;
  make: string | null;
  model: string | null;
  location: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_url: string | null;
  images: string[];
  description: string | null;
  first_seen: string;
  last_seen: string;
  details_extracted: boolean;
}

interface Seller {
  id: string;
  name: string;
  url: string;
  listings_count: number;
  listing_ids: string[];
  first_seen: string;
  last_seen: string;
  notes: string;
}

interface Progress {
  total_scrolls: number;
  listings_discovered: number;
  listings_with_details: number;
  sellers_tracked: number;
  started_at: string;
  last_updated: string;
  last_listing_id: string | null;
}

let browser: Browser;
let context: BrowserContext;
let page: Page;
let listings: Record<string, Listing> = {};
let sellers: Record<string, Seller> = {};
let progress: Progress = {
  total_scrolls: 0,
  listings_discovered: 0,
  listings_with_details: 0,
  sellers_tracked: 0,
  started_at: new Date().toISOString(),
  last_updated: new Date().toISOString(),
  last_listing_id: null,
};

async function main() {
  console.log("===========================================");
  console.log("  VEGAS VINTAGE VEHICLE AUTO-COLLECTOR");
  console.log("===========================================");
  console.log(`Year range: ${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`);
  console.log(`Search radius: ${CONFIG.RADIUS_MILES} miles from Vegas`);
  console.log();

  // Load existing progress
  await loadProgress();

  // Launch browser
  console.log("Launching browser...");
  browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    slowMo: 50,
  });

  context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });

  // Try to load saved cookies
  let needsLogin = true;
  try {
    const cookies = JSON.parse(await fs.readFile(COOKIES_FILE, "utf-8"));
    await context.addCookies(cookies);
    console.log("Loaded saved session cookies");
    needsLogin = false;
  } catch {
    console.log("No saved cookies - you'll need to log in");
  }

  page = await context.newPage();

  // Navigate to Vegas Marketplace with vintage filter
  const url = buildSearchUrl();
  console.log(`\nNavigating to: ${url}\n`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // Check if logged in - auto-detect, no ENTER needed
  let isLoggedIn = await checkLoggedIn();

  if (!isLoggedIn) {
    console.log("\n========================================");
    console.log("  LOGIN REQUIRED - AUTO-DETECTING");
    console.log("========================================");
    console.log("Please log into Facebook in the browser window.");
    console.log("Will auto-continue when login is detected...\n");

    // Poll for login instead of waiting for ENTER
    let attempts = 0;
    while (!isLoggedIn && attempts < 120) { // 10 min max wait
      await sleep(5000);
      attempts++;
      isLoggedIn = await checkLoggedIn();
      if (attempts % 6 === 0) {
        console.log(`  Waiting for login... (${attempts * 5}s)`);
      }
    }

    if (!isLoggedIn) {
      console.log("Login timeout. Exiting.");
      await browser.close();
      process.exit(1);
    }

    console.log("Login detected!");

    // Save cookies
    const cookies = await context.cookies();
    await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("Session cookies saved!\n");

    // Navigate back to marketplace
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(3000);
  }

  console.log("Logged in! Starting collection...\n");
  console.log("========================================");
  console.log("  COLLECTION IN PROGRESS");
  console.log("========================================");
  console.log("Press Ctrl+C to stop gracefully.\n");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\nShutting down gracefully...");
    await saveProgress();
    await saveSellersToDb();
    await saveListingsToDb();
    await browser.close();
    process.exit(0);
  });

  // Start auto-save interval
  const saveInterval = setInterval(async () => {
    await saveProgress();
    printStatus();
  }, CONFIG.SAVE_INTERVAL_MS);

  // Main collection loop
  try {
    await collectAllListings();
    await extractDetails();
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
  }

  clearInterval(saveInterval);
  await saveProgress();
  await saveSellersToDb();
  await saveListingsToDb();
  await browser.close();

  console.log("\n========================================");
  console.log("  COLLECTION COMPLETE");
  console.log("========================================");
  printFinalStats();
}

function buildSearchUrl(): string {
  // Facebook Marketplace Vegas vehicles URL with year filter
  const params = new URLSearchParams({
    minYear: CONFIG.YEAR_MIN.toString(),
    maxYear: CONFIG.YEAR_MAX.toString(),
    sortBy: "creation_time_descend",
    exact: "false",
  });

  return `https://www.facebook.com/marketplace/lasvegas/vehicles?${params.toString()}`;
}

async function checkLoggedIn(): Promise<boolean> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    // If we see "Log In" prominently but no marketplace content, we're logged out
    const hasLoginPrompt = text.includes("Log in to Facebook") ||
                           text.includes("Create new account");
    const hasMarketplace = text.includes("Marketplace") &&
                           (text.includes("$") || text.includes("vehicles"));
    return hasMarketplace && !hasLoginPrompt;
  } catch {
    return false;
  }
}

async function collectAllListings() {
  let consecutiveNoNew = 0;
  let scrollCount = 0;

  while (consecutiveNoNew < 5 && scrollCount < CONFIG.MAX_SCROLL_ATTEMPTS) {
    scrollCount++;
    progress.total_scrolls = scrollCount;

    // Scan visible listings
    const newListings = await scanVisibleListings();

    if (newListings === 0) {
      consecutiveNoNew++;
      console.log(`  Scroll ${scrollCount}: No new listings (${consecutiveNoNew}/5)`);
    } else {
      consecutiveNoNew = 0;
      console.log(`  Scroll ${scrollCount}: +${newListings} new (${Object.keys(listings).length} total)`);
    }

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(CONFIG.BETWEEN_SCROLLS_MS);

    // Wait for new content to load
    await sleep(CONFIG.SCROLL_DELAY_MS);

    if (Object.keys(listings).length >= CONFIG.MAX_LISTINGS_PER_SESSION) {
      console.log(`\nReached max listings limit (${CONFIG.MAX_LISTINGS_PER_SESSION})`);
      break;
    }
  }

  console.log(`\nDiscovery complete: ${Object.keys(listings).length} listings found`);
}

async function scanVisibleListings(): Promise<number> {
  const data = await page.evaluate(() => {
    const results: any[] = [];

    // Find all listing cards
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((el: any) => {
      const href = el.href;
      const listingId = href.match(/\/item\/(\d+)/)?.[1];
      if (!listingId) return;

      const text = el.innerText || "";
      const lines = text.split("\n").filter((l: string) => l.trim());

      // Extract price (usually first line with $)
      const priceLine = lines.find((l: string) => l.includes("$"));

      // Extract title/year/make/model from text
      let title = "";
      let year: number | null = null;
      let make = "";
      let model = "";

      for (const line of lines) {
        const yearMatch = line.match(/\b(19[6-9]\d)\b/);
        if (yearMatch) {
          year = parseInt(yearMatch[1]);
          title = line;
          // Try to extract make/model
          const afterYear = line.substring(line.indexOf(yearMatch[1]) + 4).trim();
          const parts = afterYear.split(/\s+/);
          if (parts.length >= 1) make = parts[0];
          if (parts.length >= 2) model = parts.slice(1).join(" ");
          break;
        }
      }

      // Location is usually one of the lines
      const locationLine = lines.find((l: string) =>
        l.includes(",") && (l.includes("NV") || l.includes("CA") || l.includes("AZ") || l.includes("UT"))
      );

      // Try to find seller info
      const parent = el.closest('[data-testid]') || el.parentElement?.parentElement?.parentElement;
      const sellerLink = parent?.querySelector('a[href*="/marketplace/profile/"]') as HTMLAnchorElement;

      // Get first image
      const img = el.querySelector('img');
      const imageUrl = img?.src;

      results.push({
        id: listingId,
        url: href,
        title: title || lines[0] || "",
        price: priceLine?.match(/\$[\d,]+/)?.[0] || null,
        year,
        make,
        model,
        location: locationLine || null,
        seller_id: sellerLink?.href?.match(/\/profile\/(\d+)/)?.[1] || null,
        seller_name: sellerLink?.innerText?.trim() || null,
        seller_url: sellerLink?.href || null,
        images: imageUrl ? [imageUrl] : [],
      });
    });

    return results;
  });

  let newCount = 0;
  const now = new Date().toISOString();

  for (const item of data) {
    if (!item.id) continue;

    if (!listings[item.id]) {
      listings[item.id] = {
        ...item,
        description: null,
        first_seen: now,
        last_seen: now,
        details_extracted: false,
      };
      newCount++;
      progress.listings_discovered++;
      progress.last_listing_id = item.id;

      // Track seller
      if (item.seller_id && item.seller_name) {
        if (!sellers[item.seller_id]) {
          sellers[item.seller_id] = {
            id: item.seller_id,
            name: item.seller_name,
            url: item.seller_url,
            listings_count: 1,
            listing_ids: [item.id],
            first_seen: now,
            last_seen: now,
            notes: "",
          };
          progress.sellers_tracked++;
        } else {
          sellers[item.seller_id].listings_count++;
          sellers[item.seller_id].last_seen = now;
          if (!sellers[item.seller_id].listing_ids.includes(item.id)) {
            sellers[item.seller_id].listing_ids.push(item.id);
          }
        }
      }
    } else {
      listings[item.id].last_seen = now;
    }
  }

  return newCount;
}

async function extractDetails() {
  const needDetails = Object.values(listings).filter(l => !l.details_extracted);

  if (needDetails.length === 0) {
    console.log("All listings have details already.");
    return;
  }

  console.log(`\nExtracting details for ${needDetails.length} listings...`);

  for (let i = 0; i < needDetails.length; i++) {
    const listing = needDetails[i];
    console.log(`  [${i + 1}/${needDetails.length}] ${listing.title || listing.id}`);

    try {
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      await sleep(2000);

      const details = await page.evaluate(() => {
        const result: any = { images: [], description: null };

        // Get all images
        document.querySelectorAll('img').forEach((img: HTMLImageElement) => {
          const src = img.src;
          if (src &&
              (src.includes("scontent") || src.includes("fbcdn")) &&
              !src.includes("emoji") &&
              img.width > 100 && img.height > 100) {
            result.images.push(src);
          }
        });

        // Get description - look for the main text block
        const textBlocks = document.querySelectorAll('[data-ad-comet-preview="message"]');
        if (textBlocks.length > 0) {
          result.description = (textBlocks[0] as HTMLElement).innerText;
        } else {
          // Fallback: look for long text blocks
          document.querySelectorAll('span').forEach((el: HTMLSpanElement) => {
            const text = el.innerText;
            if (text && text.length > 100 && !result.description) {
              result.description = text;
            }
          });
        }

        // Get seller info if not already captured
        const sellerLink = document.querySelector('a[href*="/marketplace/profile/"]') as HTMLAnchorElement;
        if (sellerLink) {
          result.seller_url = sellerLink.href;
          result.seller_id = sellerLink.href.match(/\/profile\/(\d+)/)?.[1];
          result.seller_name = sellerLink.innerText?.trim();
        }

        return result;
      });

      // Update listing
      if (details.images.length > 0) {
        listing.images = [...new Set([...listing.images, ...details.images])];
      }
      if (details.description) {
        listing.description = details.description;
      }
      if (details.seller_id && !listing.seller_id) {
        listing.seller_id = details.seller_id;
        listing.seller_name = details.seller_name;
        listing.seller_url = details.seller_url;
      }

      listing.details_extracted = true;
      progress.listings_with_details++;

      await sleep(CONFIG.BETWEEN_LISTINGS_MS);

    } catch (err: any) {
      console.log(`    Error: ${err.message}`);
    }

    // Save periodically
    if (i % 10 === 0) {
      await saveProgress();
    }
  }
}

async function loadProgress() {
  try {
    const data = JSON.parse(await fs.readFile(PROGRESS_FILE, "utf-8"));
    progress = { ...progress, ...data };
    console.log(`Resuming: ${progress.listings_discovered} listings, ${progress.sellers_tracked} sellers tracked`);
  } catch {
    console.log("Starting fresh collection");
  }

  try {
    listings = JSON.parse(await fs.readFile("/Users/skylar/nuke/logs/vegas-listings.json", "utf-8"));
    console.log(`Loaded ${Object.keys(listings).length} existing listings`);
  } catch {
    listings = {};
  }

  try {
    sellers = JSON.parse(await fs.readFile(SELLERS_FILE, "utf-8"));
    console.log(`Loaded ${Object.keys(sellers).length} existing sellers`);
  } catch {
    sellers = {};
  }
}

async function saveProgress() {
  progress.last_updated = new Date().toISOString();

  await Promise.all([
    fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2)),
    fs.writeFile("/Users/skylar/nuke/logs/vegas-listings.json", JSON.stringify(listings, null, 2)),
    fs.writeFile(SELLERS_FILE, JSON.stringify(sellers, null, 2)),
  ]);
}

async function saveSellersToDb() {
  console.log("\nSaving sellers to database...");

  let saved = 0;
  for (const seller of Object.values(sellers)) {
    const { error } = await supabase
      .from("fb_marketplace_sellers")
      .upsert({
        fb_user_id: seller.id,
        fb_profile_url: seller.url,
        display_name: seller.name,
        total_listings_seen: seller.listings_count,
        first_seen_at: seller.first_seen,
        last_seen_at: seller.last_seen,
        location_pattern: {
          notes: seller.notes,
          listing_ids: seller.listing_ids,
          region: "vegas_200mi"
        },
      }, { onConflict: "fb_user_id" });

    if (!error) saved++;
  }

  console.log(`Saved ${saved} sellers to database`);
}

async function saveListingsToDb() {
  console.log("\nSaving listings to database...");

  let saved = 0;
  let errors = 0;

  for (const listing of Object.values(listings)) {
    try {
      // Parse price
      const priceNum = listing.price ? parseInt(listing.price.replace(/[$,]/g, "")) : null;

      const { error } = await supabase
        .from("marketplace_listings")
        .upsert({
          facebook_id: listing.id,
          title: listing.title,
          price: priceNum,
          year: listing.year,
          make: listing.make,
          model: listing.model,
          location: listing.location,
          description: listing.description,
          images: listing.images,
          seller_id: listing.seller_id,
          seller_name: listing.seller_name,
          source_url: listing.url,
          platform: "facebook_marketplace",
          region: "vegas_200mi",
          first_seen_at: listing.first_seen,
          last_seen_at: listing.last_seen,
          status: "active",
        }, { onConflict: "facebook_id" });

      if (!error) saved++;
      else errors++;
    } catch {
      errors++;
    }
  }

  console.log(`Saved ${saved} listings to database (${errors} errors)`);
}

function printStatus() {
  const elapsed = Date.now() - new Date(progress.started_at).getTime();
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);

  console.log(`\n[${hours}h ${minutes}m] Listings: ${progress.listings_discovered} | Details: ${progress.listings_with_details} | Sellers: ${progress.sellers_tracked}`);
}

function printFinalStats() {
  console.log(`Total listings discovered: ${progress.listings_discovered}`);
  console.log(`Listings with details: ${progress.listings_with_details}`);
  console.log(`Unique sellers tracked: ${progress.sellers_tracked}`);

  // Show top sellers
  const topSellers = Object.values(sellers)
    .sort((a, b) => b.listings_count - a.listings_count)
    .slice(0, 10);

  if (topSellers.length > 0) {
    console.log("\nTop sellers by listing count:");
    topSellers.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.name} - ${s.listings_count} listings`);
    });
  }
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);

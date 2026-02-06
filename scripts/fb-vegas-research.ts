#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Vegas Research Tool
 *
 * Interactive browser session to research the Vegas car scene.
 * Identifies key sellers, junkers, parts guys as data sources.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-vegas-research.ts
 */

import { chromium, Browser, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as readline from "readline";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const COOKIES_FILE = "/Users/skylar/nuke/logs/fb-session-cookies.json";
const SELLERS_FILE = "/Users/skylar/nuke/logs/vegas-sellers-research.json";

interface SellerProfile {
  fb_user_id: string;
  name: string;
  profile_url: string;
  seller_type: "junker" | "parts" | "dealer" | "flipper" | "private" | "unknown";
  notes: string;
  listings_seen: number;
  first_seen: string;
  last_seen: string;
  sample_listings: string[];
}

let browser: Browser;
let page: Page;
let sellers: Record<string, SellerProfile> = {};

async function main() {
  console.log("🎰 Facebook Marketplace Vegas Research Tool");
  console.log("============================================");
  console.log("Goal: Identify key sellers in Vegas car scene");
  console.log("- Junkers / parts guys (Juan Reglados, Luis Alberto, etc.)");
  console.log("- Regular flippers");
  console.log("- Dealers");
  console.log();

  // Load existing seller data
  try {
    const data = await fs.readFile(SELLERS_FILE, "utf-8");
    sellers = JSON.parse(data);
    console.log(`Loaded ${Object.keys(sellers).length} known sellers\n`);
  } catch {
    sellers = {};
  }

  // Launch browser (visible so user can log in)
  console.log("🚀 Launching browser (visible mode)...");
  browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    slowMo: 100,
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });

  // Try to load saved cookies
  try {
    const cookies = JSON.parse(await fs.readFile(COOKIES_FILE, "utf-8"));
    await context.addCookies(cookies);
    console.log("Loaded saved session cookies");
  } catch {
    console.log("No saved cookies - you'll need to log in");
  }

  page = await context.newPage();

  // Navigate to Vegas Marketplace
  console.log("\n📍 Navigating to Vegas Marketplace...\n");
  await page.goto("https://www.facebook.com/marketplace/lasvegas/vehicles?sortBy=creation_time_descend", {
    waitUntil: "domcontentloaded",
  });

  await sleep(3000);

  // Check if logged in
  const isLoggedIn = await page.evaluate(() => {
    return !document.body.innerText.includes("Log in") ||
           document.body.innerText.includes("Marketplace");
  });

  if (!isLoggedIn) {
    console.log("⚠️  Not logged in. Please log in manually in the browser window.");
    console.log("   After logging in, press ENTER here to continue...\n");
    await waitForEnter();

    // Save cookies after login
    const cookies = await context.cookies();
    await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("✅ Session cookies saved\n");

    // Navigate back to marketplace
    await page.goto("https://www.facebook.com/marketplace/lasvegas/vehicles?sortBy=creation_time_descend");
    await sleep(3000);
  }

  console.log("✅ Logged in and on Vegas Marketplace\n");
  console.log("============================================");
  console.log("COMMANDS:");
  console.log("  scan     - Scan visible listings and extract sellers");
  console.log("  scroll   - Scroll down to load more listings");
  console.log("  seller <name> - Search for a specific seller");
  console.log("  tag <id> <type> - Tag a seller (junker/parts/dealer/flipper/private)");
  console.log("  note <id> <text> - Add note to a seller");
  console.log("  list     - Show all identified sellers");
  console.log("  save     - Save seller data to DB");
  console.log("  vintage  - Filter to vintage vehicles only");
  console.log("  quit     - Exit");
  console.log("============================================\n");

  // Interactive command loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("fb-vegas> ", async (input) => {
      const [cmd, ...args] = input.trim().split(" ");

      try {
        switch (cmd) {
          case "scan":
            await scanListings();
            break;
          case "scroll":
            await scrollPage();
            break;
          case "seller":
            await searchSeller(args.join(" "));
            break;
          case "tag":
            tagSeller(args[0], args[1] as any);
            break;
          case "note":
            addNote(args[0], args.slice(1).join(" "));
            break;
          case "list":
            listSellers();
            break;
          case "save":
            await saveSellers();
            break;
          case "vintage":
            await filterVintage();
            break;
          case "quit":
          case "exit":
            await cleanup();
            process.exit(0);
          default:
            console.log("Unknown command. Type 'help' for commands.");
        }
      } catch (err: any) {
        console.log(`Error: ${err.message}`);
      }

      prompt();
    });
  };

  prompt();
}

async function scanListings() {
  console.log("Scanning visible listings...\n");

  const listings = await page.evaluate(() => {
    const results: any[] = [];

    // Find all listing links
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((el: any) => {
      const href = el.href;
      const listingId = href.match(/\/item\/(\d+)/)?.[1];
      const text = el.innerText || "";

      // Try to find seller info nearby
      const parent = el.closest('[data-testid]') || el.parentElement?.parentElement?.parentElement;
      const sellerLink = parent?.querySelector('a[href*="/marketplace/profile/"]') as HTMLAnchorElement;

      results.push({
        listing_id: listingId,
        title: text.split("\n")[0]?.substring(0, 100),
        price: text.match(/\$[\d,]+/)?.[0],
        seller_name: sellerLink?.innerText?.trim(),
        seller_url: sellerLink?.href,
        seller_id: sellerLink?.href?.match(/\/profile\/(\d+)/)?.[1],
      });
    });

    return results;
  });

  console.log(`Found ${listings.length} listings\n`);

  // Process sellers
  let newSellers = 0;
  for (const listing of listings) {
    if (listing.seller_id && listing.seller_name) {
      if (!sellers[listing.seller_id]) {
        sellers[listing.seller_id] = {
          fb_user_id: listing.seller_id,
          name: listing.seller_name,
          profile_url: listing.seller_url,
          seller_type: "unknown",
          notes: "",
          listings_seen: 1,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          sample_listings: [listing.title],
        };
        newSellers++;
        console.log(`  NEW: ${listing.seller_name} (${listing.seller_id})`);
      } else {
        sellers[listing.seller_id].listings_seen++;
        sellers[listing.seller_id].last_seen = new Date().toISOString();
        if (!sellers[listing.seller_id].sample_listings.includes(listing.title)) {
          sellers[listing.seller_id].sample_listings.push(listing.title);
        }
      }
    }
  }

  console.log(`\n${newSellers} new sellers identified`);
  console.log(`${Object.keys(sellers).length} total sellers tracked\n`);

  // Show top sellers by listing count
  const sorted = Object.values(sellers).sort((a, b) => b.listings_seen - a.listings_seen);
  console.log("Top sellers by listings:");
  sorted.slice(0, 10).forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} - ${s.listings_seen} listings [${s.seller_type}]`);
  });

  // Auto-save
  await fs.writeFile(SELLERS_FILE, JSON.stringify(sellers, null, 2));
}

async function scrollPage() {
  console.log("Scrolling to load more...");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2000);
  console.log("Done. Run 'scan' to extract new listings.\n");
}

async function searchSeller(name: string) {
  if (!name) {
    console.log("Usage: seller <name>");
    return;
  }

  console.log(`Searching for seller: ${name}`);

  // Navigate to search
  await page.goto(`https://www.facebook.com/marketplace/lasvegas/search?query=${encodeURIComponent(name)}`);
  await sleep(3000);

  console.log("Search results loaded. Run 'scan' to extract.\n");
}

function tagSeller(sellerId: string, type: "junker" | "parts" | "dealer" | "flipper" | "private") {
  if (!sellerId || !type) {
    console.log("Usage: tag <seller_id> <type>");
    console.log("Types: junker, parts, dealer, flipper, private");
    return;
  }

  const seller = sellers[sellerId];
  if (!seller) {
    // Try to find by name
    const found = Object.values(sellers).find(s =>
      s.name.toLowerCase().includes(sellerId.toLowerCase())
    );
    if (found) {
      found.seller_type = type;
      console.log(`Tagged ${found.name} as ${type}`);
      return;
    }
    console.log("Seller not found");
    return;
  }

  seller.seller_type = type;
  console.log(`Tagged ${seller.name} as ${type}`);
}

function addNote(sellerId: string, note: string) {
  if (!sellerId || !note) {
    console.log("Usage: note <seller_id> <text>");
    return;
  }

  const seller = sellers[sellerId] || Object.values(sellers).find(s =>
    s.name.toLowerCase().includes(sellerId.toLowerCase())
  );

  if (!seller) {
    console.log("Seller not found");
    return;
  }

  seller.notes += (seller.notes ? " | " : "") + note;
  console.log(`Added note to ${seller.name}`);
}

function listSellers() {
  const sorted = Object.values(sellers).sort((a, b) => b.listings_seen - a.listings_seen);

  console.log("\n=== IDENTIFIED SELLERS ===\n");

  // Group by type
  const byType: Record<string, SellerProfile[]> = {};
  for (const s of sorted) {
    if (!byType[s.seller_type]) byType[s.seller_type] = [];
    byType[s.seller_type].push(s);
  }

  for (const [type, list] of Object.entries(byType)) {
    console.log(`\n[${type.toUpperCase()}] (${list.length})`);
    list.slice(0, 10).forEach(s => {
      console.log(`  ${s.name} - ${s.listings_seen} listings`);
      if (s.notes) console.log(`    Notes: ${s.notes}`);
    });
  }

  console.log();
}

async function saveSellers() {
  console.log("Saving sellers to database...");

  let saved = 0;
  for (const seller of Object.values(sellers)) {
    if (seller.seller_type === "unknown") continue;

    const { error } = await supabase
      .from("fb_marketplace_sellers")
      .upsert({
        fb_user_id: seller.fb_user_id,
        fb_profile_url: seller.profile_url,
        display_name: seller.name,
        seller_type: seller.seller_type,
        total_listings_seen: seller.listings_seen,
        first_seen_at: seller.first_seen,
        last_seen_at: seller.last_seen,
        location_pattern: { notes: seller.notes, sample_listings: seller.sample_listings },
      }, { onConflict: "fb_profile_url" });

    if (!error) saved++;
  }

  console.log(`Saved ${saved} tagged sellers to DB\n`);
}

async function filterVintage() {
  console.log("Filtering to vintage vehicles (1960-1999)...");
  await page.goto("https://www.facebook.com/marketplace/lasvegas/vehicles?minYear=1960&maxYear=1999&sortBy=creation_time_descend");
  await sleep(3000);
  console.log("Done. Run 'scan' to extract.\n");
}

async function cleanup() {
  await fs.writeFile(SELLERS_FILE, JSON.stringify(sellers, null, 2));
  console.log("\nSeller data saved.");
  await browser.close();
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

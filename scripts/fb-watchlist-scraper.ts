#!/usr/bin/env npx tsx
/**
 * FB Marketplace Watchlist Scraper
 *
 * Searches for specific vehicles across all locations.
 * Sends Telegram alerts for new matches.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const SEEN_FILE = "/Users/skylar/nuke/logs/watchlist-seen.json";
const PROGRESS_FILE = "/Users/skylar/nuke/logs/watchlist-progress.json";

// ============================================
// WATCHLIST - Add vehicles you want to track
// ============================================
const WATCHLIST = [
  {
    name: "Squarebody Trucks",
    searches: [
      "squarebody",
      "square body",
      "c10",
      "k10",
      "c20",
      "k20",
      "k5 blazer",
      "chevy truck 1973",
      "chevy truck 1987",
      "gmc truck 1980",
      "silverado 1985",
      "scottsdale",
    ],
    yearMin: 1973,
    yearMax: 1987,
  },
  {
    name: "First Gen Cummins",
    searches: [
      "first gen cummins",
      "12 valve cummins",
      "dodge cummins 1989",
      "dodge cummins 1993",
      "w250",
      "d250 cummins",
    ],
    yearMin: 1989,
    yearMax: 1993,
  },
  {
    name: "OBS Ford",
    searches: [
      "obs ford",
      "f150 1995",
      "f250 1996",
      "obs powerstroke",
      "7.3 powerstroke",
    ],
    yearMin: 1992,
    yearMax: 1997,
  },
  {
    name: "Square Body Suburban",
    searches: [
      "suburban 1985",
      "suburban 1980",
      "chevy suburban square",
    ],
    yearMin: 1973,
    yearMax: 1991,
  },
];

const CONFIG = {
  USER_AGENTS: [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  ],
  DELAY_BETWEEN_SEARCHES_MS: 30000,
  DELAY_BETWEEN_LOCATIONS_MS: 5000,
  MAX_LOCATIONS_PER_RUN: 100,
};

interface SeenListings {
  [listingId: string]: {
    first_seen: string;
    search_term: string;
    watchlist_name: string;
  };
}

let seenListings: SeenListings = {};
let newFindsThisRun = 0;

async function sendTelegram(message: string, imageUrl?: string) {
  try {
    if (imageUrl) {
      // Send photo with caption
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: imageUrl,
          caption: message,
          parse_mode: "HTML",
        }),
      });
    } else {
      // Send text only
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });
    }
  } catch (err: any) {
    console.error("Telegram error:", err.message);
  }
}

async function searchMarketplace(query: string, location: { name: string; latitude: number; longitude: number }) {
  const ua = CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];

  // Build Facebook Marketplace search URL
  const searchUrl = `https://www.facebook.com/marketplace/search?query=${encodeURIComponent(query)}&exact=false`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();

    // Extract listing IDs from the HTML
    const listingMatches = html.matchAll(/marketplace\/item\/(\d+)/g);
    const listings: any[] = [];

    for (const match of listingMatches) {
      const listingId = match[1];
      if (!listings.find(l => l.id === listingId)) {
        // Try to extract more info from surrounding context
        const priceMatch = html.match(new RegExp(`"${listingId}"[^}]*"price"[^}]*"amount":"?(\\d+)`));
        const titleMatch = html.match(new RegExp(`"${listingId}"[^}]*"title":"([^"]+)"`));

        listings.push({
          id: listingId,
          url: `https://www.facebook.com/marketplace/item/${listingId}`,
          title: titleMatch?.[1] || query,
          price: priceMatch?.[1] ? `$${parseInt(priceMatch[1]).toLocaleString()}` : null,
        });
      }
    }

    return listings.slice(0, 10); // Max 10 per search
  } catch (err: any) {
    console.error(`Search error for "${query}":`, err.message);
    return [];
  }
}

async function loadSeenListings() {
  try {
    const data = await fs.readFile(SEEN_FILE, "utf-8");
    seenListings = JSON.parse(data);
    console.log(`Loaded ${Object.keys(seenListings).length} previously seen listings`);
  } catch {
    seenListings = {};
  }
}

async function saveSeenListings() {
  await fs.writeFile(SEEN_FILE, JSON.stringify(seenListings, null, 2));
}

async function processWatchlist() {
  console.log("\n===========================================");
  console.log("  FB WATCHLIST SCRAPER");
  console.log("===========================================");
  console.log(`Tracking ${WATCHLIST.length} vehicle categories`);
  console.log(`${WATCHLIST.reduce((sum, w) => sum + w.searches.length, 0)} total search terms\n`);

  await loadSeenListings();

  // Get locations from DB
  const { data: locations } = await supabase
    .from("fb_marketplace_locations")
    .select("name, latitude, longitude, state_code")
    .eq("is_active", true)
    .order("population", { ascending: false })
    .limit(CONFIG.MAX_LOCATIONS_PER_RUN);

  if (!locations || locations.length === 0) {
    console.log("No locations found");
    return;
  }

  console.log(`Searching across ${locations.length} locations\n`);

  let searchCount = 0;

  for (const watchItem of WATCHLIST) {
    console.log(`\n[${watchItem.name}]`);

    for (const searchTerm of watchItem.searches) {
      console.log(`  Searching: "${searchTerm}"`);

      const listings = await searchMarketplace(searchTerm, locations[0]);

      for (const listing of listings) {
        if (!seenListings[listing.id]) {
          // NEW LISTING FOUND!
          seenListings[listing.id] = {
            first_seen: new Date().toISOString(),
            search_term: searchTerm,
            watchlist_name: watchItem.name,
          };

          newFindsThisRun++;

          console.log(`    NEW: ${listing.title} ${listing.price || ""}`);

          // Send Telegram alert
          const message = `🚨 <b>NEW ${watchItem.name.toUpperCase()}</b>

<b>${listing.title}</b>
💰 ${listing.price || "Price not listed"}

🔍 Found via: "${searchTerm}"

<a href="${listing.url}">View on FB Marketplace</a>`;

          await sendTelegram(message);

          // Save to DB
          await supabase.from("marketplace_listings").upsert({
            facebook_id: listing.id,
            title: listing.title,
            source_url: listing.url,
            platform: "facebook_marketplace",
            watchlist_match: watchItem.name,
            search_term: searchTerm,
            first_seen_at: new Date().toISOString(),
            status: "active",
          }, { onConflict: "facebook_id" });

          await sleep(1000); // Don't spam Telegram
        }
      }

      searchCount++;
      await sleep(CONFIG.DELAY_BETWEEN_SEARCHES_MS);
    }
  }

  await saveSeenListings();

  // Send summary
  const summaryMsg = `📊 <b>Watchlist Scan Complete</b>

🔍 Searches run: ${searchCount}
🆕 New finds: ${newFindsThisRun}
📦 Total tracked: ${Object.keys(seenListings).length}

Next scan in 2 hours.`;

  await sendTelegram(summaryMsg);

  console.log(`\nScan complete. ${newFindsThisRun} new finds.`);
}

async function saveProgress() {
  const progress = {
    last_run: new Date().toISOString(),
    total_seen: Object.keys(seenListings).length,
    new_this_run: newFindsThisRun,
    watchlist_categories: WATCHLIST.length,
  };
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await sendTelegram(`🚀 <b>Watchlist Scraper Started</b>

Tracking:
${WATCHLIST.map(w => `• ${w.name} (${w.searches.length} terms)`).join("\n")}

Will alert you when new matches are found.`);

  // Run immediately
  await processWatchlist();
  await saveProgress();

  // Then run every 2 hours
  setInterval(async () => {
    newFindsThisRun = 0;
    await processWatchlist();
    await saveProgress();
  }, 2 * 60 * 60 * 1000);

  console.log("\nWatchlist scraper running. Scanning every 2 hours.");
}

main().catch(console.error);

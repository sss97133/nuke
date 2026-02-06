#!/usr/bin/env npx tsx
/**
 * Barrett-Jackson Docket Extractor
 *
 * Extracts all vehicles from BJ auction dockets.
 * Uses Playwright for JS-rendered pages.
 */

import { chromium, Browser, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// Active auctions to scrape
const AUCTIONS = [
  {
    slug: "2026-scottsdale",
    name: "2026 Scottsdale",
    docketUrl: "https://www.barrett-jackson.com/2026-scottsdale/docket",
  },
  {
    slug: "2026-palm-beach",
    name: "2026 Palm Beach",
    docketUrl: "https://www.barrett-jackson.com/2026-palm-beach/docket",
  },
];

// Results page for historical sales
const RESULTS_URL = "https://www.barrett-jackson.com/results?type=Vehicles";

let browser: Browser;

async function sendTelegram(message: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

async function extractLotPage(page: Page, url: string): Promise<any> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const getText = (selector: string) => document.querySelector(selector)?.textContent?.trim() || null;
    const getAttr = (selector: string, attr: string) => document.querySelector(selector)?.getAttribute(attr) || null;

    // Get title (usually contains year make model)
    const title = getText("h1") || getText('[class*="title"]') || "";

    // Parse year from title
    const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Get lot number
    const lotText = document.body.innerText;
    const lotMatch = lotText.match(/Lot\s*#?\s*(\d+)/i);
    const lotNumber = lotMatch ? lotMatch[1] : null;

    // Get VIN
    const vinMatch = lotText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch ? vinMatch[1] : null;

    // Get images
    const images: string[] = [];
    document.querySelectorAll("img").forEach((img) => {
      const src = img.src || img.dataset.src;
      if (src && (src.includes("cloudinary") || src.includes("barrett-jackson")) &&
          !src.includes("logo") && !src.includes("icon") && img.width > 200) {
        images.push(src);
      }
    });

    // Get specs from page text
    const specs: Record<string, string> = {};
    const specPatterns = [
      /Engine[:\s]*([^\n]+)/i,
      /Transmission[:\s]*([^\n]+)/i,
      /Mileage[:\s]*([\d,]+)/i,
      /Miles[:\s]*([\d,]+)/i,
      /Exterior[:\s]*([^\n]+)/i,
      /Interior[:\s]*([^\n]+)/i,
    ];

    specPatterns.forEach((pattern) => {
      const match = lotText.match(pattern);
      if (match) {
        const key = pattern.source.split("[")[0].toLowerCase();
        specs[key] = match[1].trim();
      }
    });

    // Get description
    const descEl = document.querySelector('[class*="description"]') ||
                   document.querySelector('[class*="highlights"]');
    const description = descEl?.textContent?.trim().slice(0, 2000) || null;

    // Get hammer price if sold
    const priceMatch = lotText.match(/\$[\d,]+(?:\.\d{2})?/g);
    const hammerPrice = priceMatch ? priceMatch[priceMatch.length - 1] : null;

    return {
      title,
      year,
      lotNumber,
      vin,
      images: [...new Set(images)].slice(0, 20),
      specs,
      description,
      hammerPrice,
      url: window.location.href,
    };
  });

  return data;
}

async function scrapeDocket(auction: typeof AUCTIONS[0]): Promise<any[]> {
  console.log(`\n=== ${auction.name} ===`);
  console.log(`Docket: ${auction.docketUrl}`);

  const page = await browser.newPage();
  await page.goto(auction.docketUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Scroll to load all items
  console.log("  Loading full docket...");
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);

  // Extract lot URLs
  const lotUrls = await page.evaluate(() => {
    const links: string[] = [];
    document.querySelectorAll('a[href*="/docket/vehicle/"]').forEach((a: any) => {
      if (a.href && !links.includes(a.href)) {
        links.push(a.href.split("?")[0]);
      }
    });
    return links;
  });

  console.log(`  Found ${lotUrls.length} lots`);
  await page.close();

  // Extract each lot
  const lots: any[] = [];
  const lotPage = await browser.newPage();

  for (let i = 0; i < lotUrls.length; i++) {
    const url = lotUrls[i];
    console.log(`  [${i + 1}/${lotUrls.length}] Extracting...`);

    try {
      const lot = await extractLotPage(lotPage, url);
      lot.auction = auction.name;
      lot.auctionSlug = auction.slug;
      lots.push(lot);

      // Save to DB
      await saveLot(lot);

      await lotPage.waitForTimeout(1500); // Rate limit
    } catch (err: any) {
      console.log(`    Error: ${err.message}`);
    }
  }

  await lotPage.close();
  return lots;
}

async function saveLot(lot: any) {
  // Parse make/model from title
  let make = "";
  let model = "";

  if (lot.title) {
    const titleParts = lot.title.replace(/^\d{4}\s*/, "").split(/\s+/);
    if (titleParts.length >= 1) make = titleParts[0];
    if (titleParts.length >= 2) model = titleParts.slice(1).join(" ").slice(0, 100);
  }

  // Parse mileage
  const mileage = lot.specs?.mileage ? parseInt(lot.specs.mileage.replace(/,/g, "")) : null;

  // Parse price
  const price = lot.hammerPrice ? parseInt(lot.hammerPrice.replace(/[$,]/g, "")) : null;

  const { error } = await supabase.from("vehicles").insert({
    title: lot.title?.slice(0, 200),
    year: lot.year,
    make,
    model,
    vin: lot.vin,
    mileage,
    sale_price: price,
    engine: lot.specs?.engine,
    transmission: lot.specs?.transmission,
    color: lot.specs?.exterior,
    interior_color: lot.specs?.interior,
    description: lot.description,
    discovery_source: "barrett-jackson",
    discovery_url: lot.url,
    platform_url: `https://www.barrett-jackson.com/${lot.auctionSlug}/docket`,
    status: price ? "sold" : "active",
    is_public: true,
    notes: `BJ ${lot.auction} - Lot #${lot.lotNumber || "TBD"}`,
  });

  if (error) {
    console.log(`    DB error: ${error.message}`);
  }
}

async function main() {
  console.log("======================================");
  console.log("  BARRETT-JACKSON DOCKET EXTRACTOR");
  console.log("======================================\n");

  await sendTelegram(`🔨 <b>Barrett-Jackson Extraction Started</b>

Scraping auction dockets:
${AUCTIONS.map(a => `• ${a.name}`).join("\n")}`);

  browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  let totalLots = 0;

  for (const auction of AUCTIONS) {
    try {
      const lots = await scrapeDocket(auction);
      totalLots += lots.length;
      console.log(`\n  ${auction.name}: ${lots.length} lots extracted`);
    } catch (err: any) {
      console.error(`  Error with ${auction.name}: ${err.message}`);
    }
  }

  await browser.close();

  await sendTelegram(`✅ <b>Barrett-Jackson Extraction Complete</b>

📦 Total lots extracted: ${totalLots}
${AUCTIONS.map(a => `• ${a.name}`).join("\n")}

Data saved to database.`);

  console.log("\n======================================");
  console.log("  COMPLETE");
  console.log("======================================");
  console.log(`Total lots: ${totalLots}`);
}

main().catch(console.error);

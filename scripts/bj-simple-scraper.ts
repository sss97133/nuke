#!/usr/bin/env npx tsx
/**
 * Simple Barrett-Jackson Scraper
 * Just gets the page text and extracts vehicle info
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function sendTelegram(message: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function main() {
  console.log("=== BARRETT-JACKSON SCRAPER ===\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    slowMo: 100,
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Go to docket
  console.log("Loading 2026 Scottsdale docket...");
  await page.goto("https://www.barrett-jackson.com/2026-scottsdale/docket", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scroll aggressively to load all (infinite scroll)
  console.log("Scrolling to load all vehicles...");
  let lastCount = 0;
  for (let i = 0; i < 50; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // Check if new content loaded
    const currentLinks = await page.locator('a[href*="/docket/vehicle/"]').count();
    if (currentLinks > lastCount) {
      console.log(`  Loaded ${currentLinks} vehicles...`);
      lastCount = currentLinks;
    } else if (i > 10 && currentLinks === lastCount) {
      console.log("  No more vehicles loading, done scrolling");
      break;
    }
  }

  // Get all links to vehicle pages
  const links = await page.locator('a[href*="/docket/vehicle/"]').all();
  const urls: string[] = [];

  for (const link of links) {
    const href = await link.getAttribute("href");
    if (href && !urls.includes(href)) {
      const fullUrl = href.startsWith("http") ? href : `https://www.barrett-jackson.com${href}`;
      urls.push(fullUrl.split("?")[0]);
    }
  }

  console.log(`Found ${urls.length} vehicle URLs\n`);

  // Extract each vehicle
  let saved = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url.split("/").pop()}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      // Get page text
      const text = await page.locator("body").innerText();
      const title = await page.locator("h1").first().innerText().catch(() => "");

      // Parse year
      const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      // Parse make/model from title
      const titleParts = title.replace(/^\d{4}\s*/, "").split(/\s+/);
      const make = titleParts[0] || "";
      const model = titleParts.slice(1).join(" ").slice(0, 100);

      // Get lot number
      const lotMatch = text.match(/Lot\s*#?\s*(\d+)/i);
      const lotNumber = lotMatch ? lotMatch[1] : null;

      // Get VIN
      const vinMatch = text.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const vin = vinMatch ? vinMatch[1] : null;

      // Get price if sold
      const priceMatch = text.match(/Sold\s*(?:for\s*)?\$?([\d,]+)/i) || text.match(/Hammer\s*Price[:\s]*\$?([\d,]+)/i);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

      // Get images
      const images = await page.locator("img").evaluateAll((imgs) =>
        imgs.map((img: any) => img.src).filter((src: string) =>
          src && (src.includes("cloudinary") || src.includes("barrett-jackson")) &&
          !src.includes("logo") && !src.includes("icon")
        ).slice(0, 10)
      );

      console.log(`  ${year || "?"} ${make} ${model} - Lot #${lotNumber || "?"} ${price ? `$${price.toLocaleString()}` : ""}`);

      // Save to DB
      const { error } = await supabase.from("vehicles").insert({
        title: title.slice(0, 200),
        year,
        make,
        model,
        vin,
        sale_price: price,
        discovery_source: "barrett-jackson",
        discovery_url: url,
        status: price ? "sold" : "active",
        is_public: true,
        notes: `BJ 2026 Scottsdale - Lot #${lotNumber || "TBD"}`,
      });

      if (!error) saved++;

      await page.waitForTimeout(1000);

    } catch (err: any) {
      console.log(`  Error: ${err.message.slice(0, 50)}`);
    }
  }

  await browser.close();

  console.log(`\n=== COMPLETE ===`);
  console.log(`Saved: ${saved}/${urls.length} vehicles`);

  await sendTelegram(`✅ <b>Barrett-Jackson Extraction Complete</b>\n\n📦 ${saved} vehicles saved from 2026 Scottsdale docket`);
}

main().catch(console.error);

#!/usr/bin/env npx tsx
/**
 * Niche Builder Inventory Extractor (Playwright version)
 * Free scraping - no API credits needed
 */

import { chromium, Browser, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const anthropic = new Anthropic({ apiKey: process.env.NUKE_CLAUDE_API });

const BUILDERS = [
  {
    name: "Velocity Restorations",
    slug: "velocity-restorations",
    inventoryUrl: "https://www.velocityrestorations.com/inventory",
    specialties: ["Classic Ford Bronco", "Land Rover Defender"],
  },
  {
    name: "ICON 4x4",
    slug: "icon-4x4",
    inventoryUrl: "https://www.icon4x4.com/inventory",
    specialties: ["Toyota Land Cruiser", "Ford Bronco"],
  },
  {
    name: "Gateway Bronco",
    slug: "gateway-bronco",
    inventoryUrl: "https://gatewaybronco.com/inventory/",
    specialties: ["Classic Ford Bronco"],
  },
  {
    name: "East Coast Defender",
    slug: "east-coast-defender",
    inventoryUrl: "https://www.eastcoastdefender.com/inventory/",
    specialties: ["Land Rover Defender"],
  },
  {
    name: "Arkonik",
    slug: "arkonik",
    inventoryUrl: "https://arkonik.com/defenders/for-sale/",
    specialties: ["Land Rover Defender"],
  },
  {
    name: "Legacy Classic Trucks",
    slug: "legacy-classic-trucks",
    inventoryUrl: "https://legacyclassictrucks.com/available-builds/",
    specialties: ["Power Wagon", "Classic trucks"],
  },
  {
    name: "Kindred Motorworks",
    slug: "kindred-motorworks",
    inventoryUrl: "https://kindredmotorworks.com/vehicles/",
    specialties: ["Classic trucks", "Broncos"],
  },
  {
    name: "Ringbrothers",
    slug: "ringbrothers",
    inventoryUrl: "https://ringbrothers.com/builds/",
    specialties: ["Pro-touring muscle cars"],
  },
];

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

async function scrapeWithPlaywright(url: string): Promise<{ text: string; images: string[] }> {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000); // Wait longer for JS to render

    // Scroll to load lazy content
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(2000);

    // Get page text
    const text = await page.evaluate(() => document.body.innerText);

    // Get all images
    const images = await page.evaluate(() => {
      return Array.from(document.images)
        .map(img => img.src)
        .filter(src => src && src.startsWith("http") && !src.includes("logo") && !src.includes("icon"));
    });

    return { text, images };
  } catch (err: any) {
    console.error(`  Playwright error: ${err.message}`);
    return { text: "", images: [] };
  } finally {
    await page.close();
    await context.close();
  }
}

async function extractVehiclesWithAI(text: string, builderName: string): Promise<any[]> {
  if (!text || text.length < 100) return [];

  const prompt = `Extract all vehicles from this ${builderName} inventory page.

For each vehicle, provide:
- title: full vehicle name
- year: number or null
- make: manufacturer (Ford, Land Rover, Toyota, Chevrolet, etc.)
- model: model name (Bronco, Defender, Land Cruiser, etc.)
- price: number in dollars (no $ or commas), or null
- status: "for_sale", "sold", "in_build", or "coming_soon"
- description: brief 1-2 sentence description if available

Return ONLY a valid JSON array. No other text.

Page content:
${text.slice(0, 12000)}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err: any) {
    console.error(`  AI error: ${err.message}`);
    return [];
  }
}

async function processBuilder(builder: typeof BUILDERS[0]) {
  console.log(`\n=== ${builder.name} ===`);
  console.log(`URL: ${builder.inventoryUrl}`);

  const { text, images } = await scrapeWithPlaywright(builder.inventoryUrl);

  if (!text || text.length < 200) {
    console.log("  Failed to scrape or empty page");
    return { builder: builder.name, vehicles: [], saved: 0, error: "scrape_failed" };
  }

  console.log(`  Scraped: ${text.length} chars, ${images.length} images`);

  const vehicles = await extractVehiclesWithAI(text, builder.name);
  console.log(`  Found: ${vehicles.length} vehicles`);

  // Save to database
  let saved = 0;
  for (const vehicle of vehicles) {
    if (!vehicle.title) continue;

    try {
      const { error } = await supabase.from("vehicles").insert({
        title: vehicle.title,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        sale_price: vehicle.price,
        description: vehicle.description,
        // Use vehicle's specific URL if available, otherwise null (to avoid dupe constraint)
        discovery_url: vehicle.url || null,
        discovery_source: builder.slug,
        platform_url: builder.inventoryUrl,
        status: vehicle.status === "sold" ? "sold" : "active",
        is_public: true,
      });

      if (!error) {
        saved++;
        console.log(`    + ${vehicle.year || "?"} ${vehicle.make || ""} ${vehicle.model || ""} - ${vehicle.price ? "$" + vehicle.price.toLocaleString() : "Price TBD"}`);
      } else {
        console.log(`    Error: ${error.message}`);
      }
    } catch (err: any) {
      console.log(`    Exception: ${err.message}`);
    }
  }

  console.log(`  Saved: ${saved} to DB`);

  return { builder: builder.name, vehicles, saved };
}

async function main() {
  console.log("======================================");
  console.log("  NICHE BUILDER EXTRACTOR (Playwright)");
  console.log("======================================");
  console.log(`Processing ${BUILDERS.length} builders\n`);

  await sendTelegram(`🔧 <b>Niche Builder Extraction Started</b>

Processing ${BUILDERS.length} specialty builders:
${BUILDERS.map(b => `• ${b.name}`).join("\n")}

Using Playwright (free, no API credits).`);

  browser = await chromium.launch({
    headless: false, // Visible so we can handle Cloudflare if needed
    args: ["--disable-blink-features=AutomationControlled"],
    slowMo: 100,
  });

  const results: any[] = [];

  for (const builder of BUILDERS) {
    try {
      const result = await processBuilder(builder);
      results.push(result);
      await new Promise(r => setTimeout(r, 3000));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      results.push({ builder: builder.name, error: err.message, vehicles: [], saved: 0 });
    }
  }

  await browser.close();

  // Summary
  const totalFound = results.reduce((sum, r) => sum + (r.vehicles?.length || 0), 0);
  const totalSaved = results.reduce((sum, r) => sum + (r.saved || 0), 0);

  const summaryMsg = `✅ <b>Niche Builder Extraction Complete</b>

${results.map(r => `• ${r.builder}: ${r.saved || 0} saved ${r.error ? `(${r.error})` : ""}`).join("\n")}

<b>Total: ${totalFound} found, ${totalSaved} saved to DB</b>`;

  await sendTelegram(summaryMsg);

  console.log("\n======================================");
  console.log("  COMPLETE");
  console.log("======================================");
  console.log(`Found: ${totalFound} | Saved: ${totalSaved}`);
}

main().catch(console.error);

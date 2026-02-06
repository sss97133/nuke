#!/usr/bin/env npx tsx
/**
 * Niche Builder Inventory Extractor
 *
 * Extracts vehicle inventory from specialty restoration shops and builders.
 * Uses Firecrawl for JS-heavy/protected sites.
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const anthropic = new Anthropic({ apiKey: process.env.OPENAI_API_KEY?.includes("sk-ant") ? process.env.OPENAI_API_KEY : process.env.NUKE_CLAUDE_API });

// ============================================
// NICHE BUILDERS LIST
// ============================================
const BUILDERS = [
  {
    name: "Velocity Restorations",
    slug: "velocity-restorations",
    website: "https://www.velocityrestorations.com",
    inventoryUrl: "https://www.velocityrestorations.com/inventory",
    specialties: ["Classic Ford Bronco", "Classic Land Rover Defender", "Vintage SUVs"],
    category: "restomod",
  },
  {
    name: "Ringbrothers",
    slug: "ringbrothers",
    website: "https://ringbrothers.com",
    inventoryUrl: "https://ringbrothers.com/builds",
    specialties: ["Pro-touring muscle cars", "Custom builds", "SEMA builds"],
    category: "restomod",
  },
  {
    name: "ICON 4x4",
    slug: "icon-4x4",
    website: "https://www.icon4x4.com",
    inventoryUrl: "https://www.icon4x4.com/vehicles",
    specialties: ["Toyota Land Cruiser", "Ford Bronco", "Classic 4x4"],
    category: "restomod",
  },
  {
    name: "Legacy Classic Trucks",
    slug: "legacy-classic-trucks",
    website: "https://legacyclassictrucks.com",
    inventoryUrl: "https://legacyclassictrucks.com/inventory",
    specialties: ["Power Wagon", "Classic trucks"],
    category: "restomod",
  },
  {
    name: "Gateway Bronco",
    slug: "gateway-bronco",
    website: "https://gatewaybronco.com",
    inventoryUrl: "https://gatewaybronco.com/inventory",
    specialties: ["Classic Ford Bronco"],
    category: "restomod",
  },
  {
    name: "East Coast Defender",
    slug: "east-coast-defender",
    website: "https://www.eastcoastdefender.com",
    inventoryUrl: "https://www.eastcoastdefender.com/inventory",
    specialties: ["Land Rover Defender"],
    category: "restomod",
  },
  {
    name: "Arkonik",
    slug: "arkonik",
    website: "https://arkonik.com",
    inventoryUrl: "https://arkonik.com/defenders",
    specialties: ["Land Rover Defender"],
    category: "restomod",
  },
  {
    name: "Kindred Motorworks",
    slug: "kindred-motorworks",
    website: "https://kindredmotorworks.com",
    inventoryUrl: "https://kindredmotorworks.com/inventory",
    specialties: ["Classic trucks", "Broncos"],
    category: "restomod",
  },
  {
    name: "Roadster Shop",
    slug: "roadster-shop",
    website: "https://roadstershop.com",
    inventoryUrl: "https://roadstershop.com/builds",
    specialties: ["Pro-touring", "Chassis", "Custom builds"],
    category: "restomod",
  },
  {
    name: "LS3 Customs (LegendaryMotorcar)",
    slug: "legendary-motorcar",
    website: "https://www.legendarymotorcar.com",
    inventoryUrl: "https://www.legendarymotorcar.com/vehicles",
    specialties: ["Classic restorations", "Muscle cars"],
    category: "restomod",
  },
];

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

async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        waitFor: 3000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Firecrawl error for ${url}: ${errorText}`);
      return null;
    }

    const data = await response.json();
    return data.data?.markdown || null;
  } catch (err: any) {
    console.error(`Firecrawl error: ${err.message}`);
    return null;
  }
}

async function extractVehiclesWithAI(markdown: string, builderName: string): Promise<any[]> {
  const prompt = `Extract all vehicles/inventory from this content from ${builderName}.

For each vehicle found, extract:
- title (full vehicle name/description)
- year (number or null)
- make (Ford, Land Rover, Chevrolet, etc.)
- model (Bronco, Defender, Camaro, etc.)
- price (number in dollars, or null if not listed)
- url (direct link to the vehicle if available)
- status (for_sale, sold, in_build, coming_soon)
- description (brief description)
- image_url (main image if visible)

Return as JSON array. Only include actual vehicles, not generic content.

Content:
${markdown.slice(0, 15000)}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err: any) {
    console.error(`AI extraction error: ${err.message}`);
    return [];
  }
}

async function processBuilder(builder: typeof BUILDERS[0]) {
  console.log(`\n=== ${builder.name} ===`);
  console.log(`URL: ${builder.inventoryUrl}`);

  // Scrape inventory page
  const markdown = await scrapeWithFirecrawl(builder.inventoryUrl);

  if (!markdown) {
    console.log("  Failed to scrape");
    return { builder: builder.name, vehicles: [], error: "scrape_failed" };
  }

  console.log(`  Scraped ${markdown.length} chars`);

  // Extract vehicles with AI
  const vehicles = await extractVehiclesWithAI(markdown, builder.name);
  console.log(`  Found ${vehicles.length} vehicles`);

  // Save to database
  let saved = 0;
  for (const vehicle of vehicles) {
    try {
      // Create a unique ID for this vehicle
      const externalId = `${builder.slug}-${vehicle.year || "unknown"}-${vehicle.make || ""}-${vehicle.model || ""}-${Date.now()}`.toLowerCase().replace(/\s+/g, "-");

      const { error } = await supabase.from("vehicles").upsert({
        external_id: externalId,
        title: vehicle.title,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        sale_price: vehicle.price,
        description: vehicle.description,
        source_url: vehicle.url || builder.inventoryUrl,
        discovery_source: builder.slug,
        status: vehicle.status === "sold" ? "sold" : "active",
        is_public: true,
      }, { onConflict: "external_id" });

      if (!error) saved++;
    } catch (err) {
      // Ignore individual errors
    }
  }

  console.log(`  Saved ${saved} vehicles to DB`);

  return { builder: builder.name, vehicles, saved };
}

async function main() {
  console.log("======================================");
  console.log("  NICHE BUILDER INVENTORY EXTRACTOR");
  console.log("======================================");
  console.log(`Processing ${BUILDERS.length} builders\n`);

  await sendTelegram(`🔧 <b>Niche Builder Extraction Started</b>

Processing ${BUILDERS.length} specialty builders:
${BUILDERS.map(b => `• ${b.name}`).join("\n")}

Will notify when complete.`);

  const results: any[] = [];

  for (const builder of BUILDERS) {
    try {
      const result = await processBuilder(builder);
      results.push(result);

      // Rate limit
      await new Promise(r => setTimeout(r, 5000));
    } catch (err: any) {
      console.error(`Error processing ${builder.name}: ${err.message}`);
      results.push({ builder: builder.name, error: err.message });
    }
  }

  // Summary
  const totalVehicles = results.reduce((sum, r) => sum + (r.vehicles?.length || 0), 0);
  const totalSaved = results.reduce((sum, r) => sum + (r.saved || 0), 0);

  const summaryMsg = `✅ <b>Niche Builder Extraction Complete</b>

📊 Results:
${results.map(r => `• ${r.builder}: ${r.vehicles?.length || 0} vehicles ${r.error ? `(${r.error})` : ""}`).join("\n")}

<b>Total: ${totalVehicles} vehicles found, ${totalSaved} saved</b>`;

  await sendTelegram(summaryMsg);

  console.log("\n======================================");
  console.log("  EXTRACTION COMPLETE");
  console.log("======================================");
  console.log(`Total vehicles: ${totalVehicles}`);
  console.log(`Saved to DB: ${totalSaved}`);
}

main().catch(console.error);

#!/usr/bin/env npx tsx
/**
 * SCRAPE BARRETT-JACKSON LOT PAGES FOR REAL DATA
 *
 * Processes pending import_queue records with barrett-jackson URLs.
 * Uses Playwright to load each lot page (BJ is client-rendered, no __NEXT_DATA__)
 * and extracts: title, year, make, model, VIN, sale price, lot number, images.
 * Writes to vehicles with source=barrett-jackson; marks queue complete/failed.
 *
 * Usage:
 *   npx tsx scripts/scrape-barrett-jackson-lots.ts              # one batch
 *   npx tsx scripts/scrape-barrett-jackson-lots.ts --batch 20
 *   npx tsx scripts/scrape-barrett-jackson-lots.ts --loop        # run continuously
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const batchSize = args.includes("--batch") ? parseInt(args[args.indexOf("--batch") + 1]) : 20;
const loop = args.includes("--loop");

interface BJLotData {
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  salePrice: number | null;
  lotNumber: string | null;
  color: string | null;
  transmission: string | null;
  mileage: number | null;
  engineSize: string | null;
  notesExtra: string;
  imageUrls: string[];
}

async function parseBJPage(page: any, url: string): Promise<BJLotData | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2000);

    const title = await page.locator("h1").first().innerText().catch(() => "");
    if (!title || title.length < 5) return null;
    // Reject nav/generic text mistaken for title
    if (/^Vehicle\s+Details\s*Page$/i.test(title.trim()) || /^Lot\s*#?\d+$/i.test(title)) return null;

    const text = await page.locator("body").innerText();

    const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    const titleWithoutYear = title.replace(/^\d{4}\s*/, "").trim();
    const parts = titleWithoutYear.split(/\s+/).filter(Boolean);
    let make = parts[0] || null;
    let model = parts.slice(1).join(" ").slice(0, 150) || null;
    if (make === "Vehicle" || (model && /^Details\s*Page$/i.test(model))) return null;

    const lotMatch = text.match(/Lot\s*#?\s*(\d+)/i);
    const lotNumber = lotMatch ? lotMatch[1] : null;

    const vinMatch = text.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch ? vinMatch[1] : null;

    const priceMatch =
      text.match(/Sold\s*(?:for\s*)?\$?\s*([\d,]+)/i) ||
      text.match(/Hammer\s*Price[:\s]*\$?\s*([\d,]+)/i);
    const salePriceRaw = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null;
    // Ignore tiny numbers (wrong regex hit) or unrealistic
    const salePrice =
      salePriceRaw != null && salePriceRaw >= 100 && salePriceRaw <= 50_000_000 ? salePriceRaw : null;

    const colorMatch = text.match(/(?:Exterior\s*)?Color[:\s]*([^\n\r]+?)(?:\n|$)/i);
    const color = colorMatch ? colorMatch[1].trim().slice(0, 80) : null;

    const transMatch = text.match(/Transmission[:\s]*([^\n\r]+?)(?:\n|$)/i);
    const transRaw = transMatch ? transMatch[1].trim().slice(0, 80) : null;
    // Exclude engine-size-like values (e.g. "4.0 L")
    const transmission =
      transRaw && !/^\d+(\.\d+)?\s*[LC]\.?I\.?$/i.test(transRaw) ? transRaw : null;

    const milesMatch = text.match(/(?:Odometer|Mileage|Miles)[:\s]*([\d,]+)/i);
    const mileage = milesMatch ? parseInt(milesMatch[1].replace(/,/g, ""), 10) : null;

    const engineMatch = text.match(/(?:Engine)[:\s]*([^\n\r]+?)(?:\n|$)/i);
    const engineSize = engineMatch ? engineMatch[1].trim().slice(0, 120) : null;

    const notesBits: string[] = [];
    if (lotNumber) notesBits.push(`Lot #${lotNumber}`);
    if (engineSize) notesBits.push(`Engine: ${engineSize}`);

    const imageUrls = await page
      .locator("img")
      .evaluateAll((imgs: HTMLImageElement[]) =>
        imgs
          .map((img) => img.src)
          .filter(
            (src) =>
              src &&
              (src.includes("cloudinary") || src.includes("barrett-jackson")) &&
              !src.includes("logo") &&
              !src.includes("icon")
          )
          .slice(0, 20)
      );

    return {
      title: title.slice(0, 300),
      year,
      make,
      model,
      vin,
      salePrice: salePrice != null && salePrice > 0 ? salePrice : null,
      lotNumber,
      color,
      transmission,
      mileage: mileage != null && !isNaN(mileage) ? mileage : null,
      engineSize,
      notesExtra: notesBits.join(" | "),
      imageUrls,
    };
  } catch {
    return null;
  }
}

async function processBatch(): Promise<{ processed: number; errors: number }> {
  const { data: items, error } = await supabase
    .from("import_queue")
    .select("id, listing_url")
    .eq("status", "pending")
    .ilike("listing_url", "%barrett-jackson%")
    .order("priority", { ascending: false })
    .limit(batchSize);

  if (error || !items?.length) return { processed: 0, errors: 0 };

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const lot = await parseBJPage(page, item.listing_url);

      if (!lot) {
        await supabase
          .from("import_queue")
          .update({ status: "failed", error_message: "Could not parse page", attempts: 1 })
          .eq("id", item.id);
        errors++;
        continue;
      }

      const notesStr = [lot.title, lot.notesExtra].filter(Boolean).join(" | ");
      const payload = {
        year: lot.year,
        make: lot.make,
        model: lot.model,
        vin: lot.vin || undefined,
        sale_price: lot.salePrice,
        color: lot.color || undefined,
        transmission: lot.transmission || undefined,
        mileage: lot.mileage != null ? lot.mileage : undefined,
        engine_size: lot.engineSize || undefined,
        source: "barrett-jackson",
        notes: notesStr,
      };

      const { data: existing } = await supabase
        .from("vehicles")
        .select("id")
        .eq("listing_url", item.listing_url)
        .limit(1)
        .maybeSingle();

      let vehicleId: string | null = null;
      if (existing) {
        await supabase.from("vehicles").update(payload).eq("id", existing.id);
        vehicleId = existing.id;
      } else {
        const { data: vehicle } = await supabase
          .from("vehicles")
          .insert({ ...payload, listing_url: item.listing_url })
          .select("id")
          .single();
        vehicleId = vehicle?.id || null;
      }

      await supabase
        .from("import_queue")
        .update({
          status: "complete",
          vehicle_id: vehicleId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      processed++;
    } catch (e: any) {
      await supabase
        .from("import_queue")
        .update({
          status: "failed",
          error_message: e.message?.slice(0, 200),
          attempts: 1,
        })
        .eq("id", item.id);
      errors++;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  await browser.close();
  return { processed, errors };
}

async function main() {
  console.log("Barrett-Jackson lot scraper (queue-based, real data)\n");
  do {
    const { processed, errors } = await processBatch();
    console.log(`  Processed: ${processed}, Errors: ${errors}`);
    if (!loop || (processed === 0 && errors === 0)) break;
    await new Promise((r) => setTimeout(r, 2000));
  } while (loop);
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Broad Arrow Full Backfill Extractor
 * 
 * Crawls all ~2,064 auction results across 21 pages, extracts structured
 * vehicle data from each listing, and inserts into import_queue.
 *
 * Usage:
 *   npx tsx scripts/backfill-broadarrow-full.ts                    # discover URLs only
 *   npx tsx scripts/backfill-broadarrow-full.ts --extract          # discover + extract
 *   npx tsx scripts/backfill-broadarrow-full.ts --extract --batch 20  # extract 20 at a time
 *   npx tsx scripts/backfill-broadarrow-full.ts --extract --page 5    # start from page 5
 *   npx tsx scripts/backfill-broadarrow-full.ts --extract --batch 20 --pages 3  # 3 pages of 20
 *   npx tsx scripts/backfill-broadarrow-full.ts --resume           # resume from saved progress
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_RESULTS_URL = "https://www.broadarrowauctions.com/vehicles/results";
const TOTAL_PAGES = 21;
const PROGRESS_FILE = path.resolve(process.cwd(), "data/broadarrow-backfill-progress.json");
const URLS_FILE = path.resolve(process.cwd(), "data/broadarrow-all-urls.json");
const RATE_LIMIT_MS = 1500; // 1.5s between Firecrawl requests
const ORG_ID = "bf7f8e55-4abc-45dc-aae0-1df86a9f365a"; // Broad Arrow org ID

// ─── Env ─────────────────────────────────────────────────────────────────────
function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "nuke_frontend/.env.local"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch { /* ignore */ }
  }
}

function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface VehicleListing {
  url: string;
  title: string;
  lot_number: string | null;
  auction_event: string | null;
  extracted: boolean;
}

interface ExtractedVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  sale_price: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  sold: boolean;
  lot_number: string | null;
  auction_event: string | null;
  auction_date: string | null;
  auction_location: string | null;
  image_urls: string[];
  description: string | null;
  highlights: string[];
  history_file_url: string | null;
  specialist_name: string | null;
  specialist_email: string | null;
  specialist_phone: string | null;
  coachbuilder: string | null;
}

interface Progress {
  phase: "discovery" | "extraction";
  pages_crawled: number[];
  urls_discovered: string[];
  urls_extracted: string[];
  urls_failed: string[];
  last_updated: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    extract: args.includes("--extract"),
    resume: args.includes("--resume"),
    startPage: getArgValue(args, "--page", 1),
    maxPages: getArgValue(args, "--pages", TOTAL_PAGES),
    batchSize: getArgValue(args, "--batch", 50),
    dryRun: args.includes("--dry-run"),
  };
}

function getArgValue(args: string[], flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultVal;
}

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {
    phase: "discovery",
    pages_crawled: [],
    urls_discovered: [],
    urls_extracted: [],
    urls_failed: [],
    last_updated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress): void {
  progress.last_updated = new Date().toISOString();
  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── Phase 1: Discover all vehicle URLs from paginated results ───────────────
async function discoverUrls(
  firecrawlKey: string,
  startPage: number,
  maxPages: number,
  progress: Progress
): Promise<string[]> {
  console.log("\n🔍 Phase 1: Discovering vehicle URLs from results pages\n");

  const allUrls = new Set<string>(progress.urls_discovered);
  const endPage = Math.min(startPage + maxPages - 1, TOTAL_PAGES);

  for (let page = startPage; page <= endPage; page++) {
    if (progress.pages_crawled.includes(page)) {
      console.log(`   ⏭  Page ${page}/${TOTAL_PAGES} - already crawled`);
      continue;
    }

    const pageUrl = `${BASE_RESULTS_URL}?page=${page}`;
    console.log(`   📄 Page ${page}/${TOTAL_PAGES} - ${pageUrl}`);

    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pageUrl,
          formats: ["links"],
          onlyMainContent: true,
        }),
      });

      const json = await resp.json();
      const links: string[] = json.data?.links || [];

      // Extract vehicle listing URLs
      const vehicleUrls = links.filter(
        (l: string) =>
          l.includes("/vehicles/") &&
          !l.includes("/results") &&
          !l.includes("/sold") &&
          !l.includes("/still-for-sale") &&
          !l.includes("?q%5B") &&
          !l.includes("?page=") &&
          !l.includes("/news") &&
          l.match(/\/vehicles\/[a-z]{2,4}\d{2}/)
      );

      // Deduplicate
      const uniqueNew = vehicleUrls.filter((u: string) => !allUrls.has(u));
      uniqueNew.forEach((u: string) => allUrls.add(u));

      console.log(`      Found ${vehicleUrls.length} listings (${uniqueNew.length} new)`);
      progress.pages_crawled.push(page);
      progress.urls_discovered = Array.from(allUrls);
      saveProgress(progress);

      await sleep(RATE_LIMIT_MS);
    } catch (err: any) {
      console.error(`      ❌ Error crawling page ${page}: ${err.message}`);
    }
  }

  const urls = Array.from(allUrls);
  console.log(`\n   📊 Total unique vehicle URLs discovered: ${urls.length}`);

  // Save URL list
  const dir = path.dirname(URLS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 2));
  console.log(`   💾 Saved to ${URLS_FILE}`);

  return urls;
}

// ─── Phase 2: Extract structured data from each listing ──────────────────────
async function extractListing(
  url: string,
  firecrawlKey: string
): Promise<ExtractedVehicle | null> {
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: [
          "markdown",
          {
            type: "json",
            prompt:
              "Extract all vehicle auction data from this Broad Arrow Auctions listing page. " +
              "Include year, make, model, VIN or chassis number, sale price, estimate range, " +
              "lot number, auction event name, date, location, mileage, colors, engine, " +
              "transmission, description highlights, whether it sold, coachbuilder, " +
              "specialist contact info, image URLs (first 10 from CDN), and any history file PDF URLs.",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                year: { type: "number" },
                make: { type: "string" },
                model: { type: "string" },
                vin: { type: "string" },
                chassis_number: { type: "string" },
                mileage: { type: "number" },
                exterior_color: { type: "string" },
                interior_color: { type: "string" },
                transmission: { type: "string" },
                engine: { type: "string" },
                sale_price: { type: "number" },
                estimate_low: { type: "number" },
                estimate_high: { type: "number" },
                sold: { type: "boolean" },
                lot_number: { type: "string" },
                auction_event: { type: "string" },
                auction_date: { type: "string" },
                auction_location: { type: "string" },
                description: { type: "string" },
                highlights: { type: "array", items: { type: "string" } },
                coachbuilder: { type: "string" },
                specialist_name: { type: "string" },
                specialist_email: { type: "string" },
                specialist_phone: { type: "string" },
                history_file_url: { type: "string" },
                image_urls: { type: "array", items: { type: "string" } },
              },
            },
          },
        ],
        onlyMainContent: true,
      }),
    });

    const json = await resp.json();
    const extracted = json.data?.json || {};
    const markdown = json.data?.markdown || "";

    // Also extract image URLs from markdown if json extraction missed them
    const cdnImages: string[] = [];
    const imgRegex = /https:\/\/cdn\.dealeraccelerate\.com\/bagauction\/[^\s"')]+/g;
    let match;
    while ((match = imgRegex.exec(markdown)) !== null) {
      const imgUrl = match[0].replace(/\.webp.*$/, ".webp");
      if (imgUrl.includes("1920x1440") && !cdnImages.includes(imgUrl)) {
        cdnImages.push(imgUrl);
      }
    }

    // Merge images: prefer extracted, supplement with CDN regex
    const allImages = [...new Set([...(extracted.image_urls || []), ...cdnImages])].slice(0, 20);

    // Parse year/make/model from title if not extracted
    const titleMatch = (extracted.title || "")?.match(/^(\d{4})\s+(.+?)$/);
    let year = extracted.year;
    let make = extracted.make;
    let model = extracted.model;

    if (!year && titleMatch) {
      year = parseInt(titleMatch[1], 10);
    }

    // Parse sale price from markdown if not extracted
    let salePrice = extracted.sale_price;
    if (!salePrice) {
      const priceMatch = markdown.match(/Sold\s*Price:\s*\$([0-9,]+)/);
      if (priceMatch) {
        salePrice = parseInt(priceMatch[1].replace(/,/g, ""), 10);
      }
    }

    // Parse lot number
    let lotNumber = extracted.lot_number;
    if (!lotNumber) {
      const lotMatch = markdown.match(/Lot\s+(\d+[A-Za-z]?)\s/);
      if (lotMatch) lotNumber = lotMatch[1];
    }

    return {
      url,
      title: extracted.title || null,
      year: year || null,
      make: make || null,
      model: model || null,
      vin: extracted.vin || null,
      chassis_number: extracted.chassis_number || null,
      mileage: extracted.mileage || null,
      exterior_color: extracted.exterior_color || null,
      interior_color: extracted.interior_color || null,
      transmission: extracted.transmission || null,
      engine: extracted.engine || null,
      sale_price: salePrice || null,
      estimate_low: extracted.estimate_low || null,
      estimate_high: extracted.estimate_high || null,
      sold: extracted.sold ?? (salePrice ? true : false),
      lot_number: lotNumber || null,
      auction_event: extracted.auction_event || null,
      auction_date: extracted.auction_date || null,
      auction_location: extracted.auction_location || null,
      image_urls: allImages,
      description: extracted.description || null,
      highlights: extracted.highlights || [],
      history_file_url: extracted.history_file_url || null,
      specialist_name: extracted.specialist_name || null,
      specialist_email: extracted.specialist_email || null,
      specialist_phone: extracted.specialist_phone || null,
      coachbuilder: extracted.coachbuilder || null,
    };
  } catch (err: any) {
    console.error(`      ❌ Extract error for ${url}: ${err.message}`);
    return null;
  }
}

async function insertToQueue(
  vehicle: ExtractedVehicle,
  supabaseUrl: string,
  serviceKey: string
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/import_queue`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify({
          source_url: vehicle.url,
          source_type: "broad_arrow",
          status: "pending",
          raw_data: vehicle,
          title: vehicle.title,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin || vehicle.chassis_number,
          sale_price: vehicle.sale_price,
          image_urls: vehicle.image_urls,
          auction_source: "Broad Arrow",
          lot_number: vehicle.lot_number,
          auction_event: vehicle.auction_event,
          created_at: new Date().toISOString(),
        }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`      ❌ Queue insert failed: ${resp.status} ${text.slice(0, 100)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`      ❌ Queue insert error: ${err.message}`);
    return false;
  }
}

async function extractAndInsert(
  urls: string[],
  firecrawlKey: string,
  supabaseUrl: string,
  serviceKey: string,
  batchSize: number,
  progress: Progress,
  dryRun: boolean
): Promise<void> {
  console.log("\n🚗 Phase 2: Extracting vehicle data from listings\n");

  // Filter out already-extracted URLs
  const pending = urls.filter(
    (u) => !progress.urls_extracted.includes(u) && !progress.urls_failed.includes(u)
  );
  const batch = pending.slice(0, batchSize);

  console.log(`   Total URLs: ${urls.length}`);
  console.log(`   Already extracted: ${progress.urls_extracted.length}`);
  console.log(`   Failed: ${progress.urls_failed.length}`);
  console.log(`   Pending: ${pending.length}`);
  console.log(`   This batch: ${batch.length}`);
  if (dryRun) console.log(`   ⚠️  DRY RUN - no database writes`);
  console.log();

  let extracted = 0;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const url = batch[i];
    const slug = url.split("/vehicles/")[1] || url;
    process.stdout.write(
      `   [${i + 1}/${batch.length}] ${slug.slice(0, 60).padEnd(60)} `
    );

    const vehicle = await extractListing(url, firecrawlKey);
    if (!vehicle) {
      process.stdout.write("❌ extract failed\n");
      progress.urls_failed.push(url);
      failed++;
      saveProgress(progress);
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    extracted++;
    const priceStr = vehicle.sale_price
      ? `$${vehicle.sale_price.toLocaleString()}`
      : "no price";
    const imgStr = `${vehicle.image_urls.length} imgs`;

    if (!dryRun) {
      const ok = await insertToQueue(vehicle, supabaseUrl, serviceKey);
      if (ok) {
        inserted++;
        process.stdout.write(`✅ ${priceStr}, ${imgStr}\n`);
      } else {
        process.stdout.write(`⚠️ extracted but insert failed\n`);
      }
    } else {
      process.stdout.write(`🔍 ${priceStr}, ${imgStr} (dry-run)\n`);
    }

    progress.urls_extracted.push(url);
    saveProgress(progress);
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n   📊 Batch Results:`);
  console.log(`      Extracted: ${extracted}`);
  console.log(`      Inserted:  ${inserted}`);
  console.log(`      Failed:    ${failed}`);
  console.log(`      Remaining: ${pending.length - batch.length}`);

  if (pending.length > batch.length) {
    console.log(
      `\n   💡 Run again to process more: npx tsx scripts/backfill-broadarrow-full.ts --extract --resume --batch ${batchSize}`
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs();

  const firecrawlKey = requireEnv("FIRECRAWL_API_KEY");
  const supabaseUrl = requireEnv("VITE_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log("═".repeat(70));
  console.log("  🏛️  Broad Arrow Auctions - Full Backfill Extractor");
  console.log("═".repeat(70));
  console.log(`  Mode: ${opts.extract ? "Discover + Extract" : "Discover only"}`);
  console.log(`  Pages: ${opts.startPage} to ${Math.min(opts.startPage + opts.maxPages - 1, TOTAL_PAGES)}`);
  if (opts.extract) console.log(`  Batch size: ${opts.batchSize}`);
  if (opts.resume) console.log(`  Resuming from saved progress`);
  if (opts.dryRun) console.log(`  ⚠️  DRY RUN mode`);

  // Load or initialize progress
  const progress = opts.resume ? loadProgress() : loadProgress();

  // Phase 1: Discover URLs
  let urls: string[];
  if (opts.resume && progress.urls_discovered.length > 0) {
    urls = progress.urls_discovered;
    console.log(`\n📂 Loaded ${urls.length} previously discovered URLs`);
  } else {
    urls = await discoverUrls(firecrawlKey, opts.startPage, opts.maxPages, progress);
  }

  // Check which URLs are already in our database
  console.log("\n🔎 Checking existing vehicles in database...");
  const existingResp = await fetch(
    `${supabaseUrl}/rest/v1/vehicles?auction_source=eq.Broad%20Arrow&select=id,year,make,model,sale_price`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  const existing = existingResp.ok ? await existingResp.json() : [];
  console.log(`   Existing Broad Arrow vehicles in DB: ${existing.length}`);
  console.log(`   New to extract: ${urls.length - progress.urls_extracted.length}`);

  // Phase 2: Extract (if requested)
  if (opts.extract) {
    await extractAndInsert(
      urls,
      firecrawlKey,
      supabaseUrl,
      serviceKey,
      opts.batchSize,
      progress,
      opts.dryRun
    );
  } else {
    console.log(
      "\n💡 To start extracting, run: npx tsx scripts/backfill-broadarrow-full.ts --extract --batch 20"
    );
  }

  console.log("\n═".repeat(70));
  console.log("  ✅ Done!");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});

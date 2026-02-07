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
/**
 * Parse structured vehicle data from Broad Arrow listing markdown.
 * 
 * Consistent structure:
 * - Title:  `# 2002 Ferrari 360 Spider`
 * - Lot:    `Lot 161 \|`
 * - Event:  next line after lot
 * - Price:  `Sold Price:$2,205,000` or `Sold Price:€88.000` or `Not Sold` or `Estimate:...`
 * - Images: `cdn.dealeraccelerate.com/bagauction/.../1920x1440/...`
 * - Highlights: bullet points (lines starting with `- `)
 * - Specialist: name + phone + email near bottom
 */
function parseMarkdown(markdown: string, url: string): ExtractedVehicle {
  // ── Title ──
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const rawTitle = titleMatch?.[1]?.trim() || null;

  // ── Year / Make / Model from title ──
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  if (rawTitle) {
    const ymm = rawTitle.match(/^(\d{4})\s+(\S+(?:\s+\S+)?)\s+(.+)$/);
    if (ymm) {
      year = parseInt(ymm[1], 10);
      // Common multi-word makes
      const multiWordMakes = [
        "Alfa Romeo", "Aston Martin", "Austin Healey", "Austin-Healey",
        "De La Chapelle", "Diamond T", "Dual-Ghia", "Frazer Nash",
        "Graham-Paige", "Harley-Davidson", "Hispano Suiza", "Hispano-Suiza",
        "Iso Grifo", "Isotta Fraschini", "Land Rover", "Mercedes-Benz",
        "Mercedes-AMG", "Mercedes-Maybach", "Meyers Manx", "Nash-Healey",
        "NSU Prinz", "Panhard et Levassor", "Pierce-Arrow", "Porsche-Diesel",
        "Porsche-Kremer", "Rolls-Royce", "S.S. Cars Ltd.", "Talbot-Lago",
        "De Tomaso", "DeTomaso",
      ];
      const rest = rawTitle.slice(5); // after "YYYY "
      const foundMake = multiWordMakes.find((m) =>
        rest.toLowerCase().startsWith(m.toLowerCase())
      );
      if (foundMake) {
        make = foundMake;
        model = rest.slice(foundMake.length).trim() || null;
      } else {
        const parts = rest.split(/\s+/);
        make = parts[0] || null;
        model = parts.slice(1).join(" ") || null;
      }
    } else {
      const simpleYear = rawTitle.match(/^(\d{4})\s/);
      if (simpleYear) year = parseInt(simpleYear[1], 10);
    }
  }

  // ── Lot number ──
  const lotMatch = markdown.match(/Lot\s+(\d+[A-Za-z]?)\s*\\?\|/);
  const lotNumber = lotMatch?.[1] || null;

  // ── Auction event ──
  // Usually the line right after "Lot NNN |"
  const eventMatch = markdown.match(/Lot\s+\d+[A-Za-z]?\s*\\?\|\s*\n+(.+)/);
  const auctionEvent = eventMatch?.[1]?.trim().replace(/^\\n/, "").trim() || null;

  // ── Sale price ──
  // Formats: "Sold Price:$2,205,000" or "Sold Price:€88.000" or "Sold for $X"
  let salePrice: number | null = null;
  let sold = false;

  // USD price
  const usdMatch = markdown.match(/Sold\s*Price:\s*\$([0-9,]+)/);
  if (usdMatch) {
    salePrice = parseInt(usdMatch[1].replace(/,/g, ""), 10);
    sold = true;
  }

  // EUR price (€88.000 format where . is thousands separator)
  if (!salePrice) {
    const eurMatch = markdown.match(/Sold\s*Price:\s*€([0-9.]+)/);
    if (eurMatch) {
      salePrice = parseInt(eurMatch[1].replace(/\./g, ""), 10);
      sold = true;
    }
  }

  // GBP price
  if (!salePrice) {
    const gbpMatch = markdown.match(/Sold\s*Price:\s*£([0-9,]+)/);
    if (gbpMatch) {
      salePrice = parseInt(gbpMatch[1].replace(/,/g, ""), 10);
      sold = true;
    }
  }

  // CHF price
  if (!salePrice) {
    const chfMatch = markdown.match(/Sold\s*Price:\s*CHF\s*([0-9',]+)/);
    if (chfMatch) {
      salePrice = parseInt(chfMatch[1].replace(/[',]/g, ""), 10);
      sold = true;
    }
  }

  // "Not Sold" check
  if (!sold && markdown.includes("Not Sold")) {
    sold = false;
  }

  // ── Estimate ──
  let estimateLow: number | null = null;
  let estimateHigh: number | null = null;
  const estMatch = markdown.match(
    /Estimate:\s*\$([0-9,]+)\s*[-–]\s*\$([0-9,]+)/
  );
  if (estMatch) {
    estimateLow = parseInt(estMatch[1].replace(/,/g, ""), 10);
    estimateHigh = parseInt(estMatch[2].replace(/,/g, ""), 10);
  }

  // ── Images ──
  const cdnImages: string[] = [];
  const imgRegex = /https:\/\/cdn\.dealeraccelerate\.com\/bagauction\/[^\s"')]+/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(markdown)) !== null) {
    let imgUrl = imgMatch[0];
    // Clean up trailing chars
    imgUrl = imgUrl.replace(/[)\]]+$/, "");
    if (imgUrl.includes("1920x1440") && !cdnImages.includes(imgUrl)) {
      cdnImages.push(imgUrl);
    }
  }

  // ── Highlights (bullet points) ──
  const highlights: string[] = [];
  const bulletRegex = /^[-*]\s+(.+)$/gm;
  let bulletMatch;
  while ((bulletMatch = bulletRegex.exec(markdown)) !== null) {
    const text = bulletMatch[1].trim();
    // Filter out navigation items, keep vehicle highlights
    if (
      text.length > 20 &&
      !text.startsWith("[") &&
      !text.includes("Privacy") &&
      !text.includes("Cookie") &&
      !text.includes("ALL")
    ) {
      highlights.push(text);
    }
  }

  // ── VIN / Chassis ──
  const vinMatch = markdown.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
  const chassisMatch = markdown.match(
    /[Cc]hassis\s*(?:[Nn]o\.?|[Nn]umber)?[:\s]+([A-Za-z0-9\s-]+?)(?:\n|$)/
  );

  // ── Specialist ──
  const specialistNameMatch = markdown.match(
    /(?:Specialist|Contact|VP of|Director of|Senior Specialist)\s*\n+([A-Z][a-z]+ [A-Z][a-z]+)/
  );
  const emailMatch = markdown.match(
    /\[([a-z.]+@(?:hagerty|broadarrow)[.\w]+)\]/
  );
  const phoneMatch = markdown.match(
    /\[(\+?1?[-.]?\d{3}[-.]?\d{3}[-.]?\d{4})\]/
  );

  // ── History file ──
  const historyMatch = markdown.match(
    /https:\/\/www\.broadarrowauctions\.com\/files\/[^\s"')]+/
  );

  // ── Mileage ──
  const mileageMatch = markdown.match(
    /([0-9,]+)\s*(?:miles|mi\b|km\b|kilometers)/i
  );
  let mileage: number | null = null;
  if (mileageMatch) {
    mileage = parseInt(mileageMatch[1].replace(/,/g, ""), 10);
  }

  // ── Colors ──
  const extColorMatch = markdown.match(
    /(?:exterior|finish(?:ed)?|painted|color)[:\s]+(?:in\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)*(?:\s+(?:over|with|and)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)/i
  );
  const intColorMatch = markdown.match(
    /(?:interior|upholster(?:y|ed)|trim)[:\s]+(?:in\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
  );

  // ── Engine ──
  const engineMatch = markdown.match(
    /(\d[\d.,]+[-\s]*(?:liter|litre|L|cc|ci|cubic)[^\n]{0,80})/i
  );

  // ── Transmission ──
  const transMatch = markdown.match(
    /((?:\d[-\s]*speed\s+)?(?:manual|automatic|sequential|PDK|tiptronic|dual[- ]clutch|DCT|F1|semi-automatic)[^\n]{0,40})/i
  );

  return {
    url,
    title: rawTitle,
    year,
    make,
    model,
    vin: vinMatch?.[1] || null,
    chassis_number: chassisMatch?.[1]?.trim() || null,
    mileage,
    exterior_color: extColorMatch?.[1]?.trim() || null,
    interior_color: intColorMatch?.[1]?.trim() || null,
    transmission: transMatch?.[1]?.trim() || null,
    engine: engineMatch?.[1]?.trim() || null,
    sale_price: salePrice,
    estimate_low: estimateLow,
    estimate_high: estimateHigh,
    sold,
    lot_number: lotNumber,
    auction_event: auctionEvent,
    auction_date: null, // Would need event page lookup
    auction_location: null,
    image_urls: cdnImages.slice(0, 20),
    description: highlights.join(" | ") || null,
    highlights,
    history_file_url: historyMatch?.[0] || null,
    specialist_name: specialistNameMatch?.[1] || null,
    specialist_email: emailMatch?.[1] || null,
    specialist_phone: phoneMatch?.[1] || null,
    coachbuilder: null,
  };
}

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
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    const json = await resp.json();
    const markdown = json.data?.markdown || "";

    if (!markdown || markdown.length < 100) {
      console.error(`      ⚠️  Empty/short markdown for ${url}`);
      return null;
    }

    return parseMarkdown(markdown, url);
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
    // Check for existing entry by URL
    const checkResp = await fetch(
      `${supabaseUrl}/rest/v1/import_queue?listing_url=eq.${encodeURIComponent(vehicle.url)}&select=id`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    const existing = checkResp.ok ? await checkResp.json() : [];
    if (existing.length > 0) {
      // Already in queue, skip
      return true;
    }

    const resp = await fetch(
      `${supabaseUrl}/rest/v1/import_queue`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          listing_url: vehicle.url,
          listing_title: vehicle.title,
          listing_price: vehicle.sale_price,
          listing_year: vehicle.year,
          listing_make: vehicle.make,
          listing_model: vehicle.model,
          thumbnail_url: vehicle.image_urls[0] || null,
          status: "pending",
          priority: 5,
          raw_data: {
            ...vehicle,
            source: "broad_arrow",
            auction_source: "Broad Arrow",
            extractor: "backfill-broadarrow-full",
            extracted_at: new Date().toISOString(),
          },
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

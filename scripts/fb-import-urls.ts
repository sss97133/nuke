#!/usr/bin/env npx tsx
/**
 * FB Marketplace Batch URL Importer
 *
 * Paste a list of FB Marketplace URLs and they get ingested into
 * marketplace_listings using the Bingbot UA approach (same as the collector).
 *
 * Usage:
 *   # Inline URLs as arguments:
 *   dotenvx run -- npx tsx scripts/fb-import-urls.ts \
 *     "https://www.facebook.com/marketplace/item/123" \
 *     "https://www.facebook.com/marketplace/item/456"
 *
 *   # From a file (one URL per line):
 *   dotenvx run -- npx tsx scripts/fb-import-urls.ts urls.txt
 *
 *   # From stdin (paste URLs, then Ctrl+D):
 *   dotenvx run -- npx tsx scripts/fb-import-urls.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as readline from "readline";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const DELAY_MS = 4000;

// ─── URL UTILITIES ────────────────────────────────────────────────────

function extractFbId(url: string): string | null {
  // Direct item: /marketplace/item/1234567890/
  const itemMatch = url.match(/marketplace\/item\/(\d{10,})/);
  if (itemMatch) return itemMatch[1];
  return null;
}

async function resolveShareLink(shareUrl: string): Promise<string | null> {
  try {
    // Follow redirect with Bingbot UA, grab final URL
    const res = await fetch(shareUrl.replace(/\?.*$/, ""), {
      headers: { "User-Agent": BOT_UA, Accept: "text/html" },
      redirect: "follow",
    });
    const finalUrl = res.url;
    const id = extractFbId(finalUrl);
    if (id) return `https://www.facebook.com/marketplace/item/${id}/`;
    // Try parsing from HTML if redirect didn't land on item URL
    const html = await res.text();
    const itemMatch = html.match(/marketplace\/item\/(\d{10,})/);
    if (itemMatch) return `https://www.facebook.com/marketplace/item/${itemMatch[1]}/`;
    return null;
  } catch {
    return null;
  }
}

function isFbUrl(url: string): boolean {
  return /facebook\.com|fb\.com/.test(url) && (
    url.includes("marketplace") || url.includes("/share/")
  );
}

function parseUrls(input: string): string[] {
  return input
    .split(/[\n\r]+/)
    .map((u) => u.trim().replace(/,$/, ""))
    .filter((u) => u.length > 0 && isFbUrl(u));
}

// ─── SCRAPING ─────────────────────────────────────────────────────────

function decodeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

interface ParsedListing {
  facebook_id: string;
  url: string;
  title: string | null;
  price: number | null;
  parsed_year: number | null;
  parsed_make: string | null;
  parsed_model: string | null;
  image_url: string | null;
  all_images: string[];
  location: string | null;
  description: string | null;
  mileage: number | null;
}

function parseVehicleTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = title.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  if (!year) return { year: null, make: null, model: null };

  const afterYear = title.split(String(year))[1]?.trim() || "";
  const words = afterYear.split(/\s+/).filter((w) => w.length > 0);

  const makeMap: Record<string, string> = {
    chevy: "Chevrolet", chevrolet: "Chevrolet", ford: "Ford",
    dodge: "Dodge", gmc: "GMC", toyota: "Toyota", honda: "Honda",
    nissan: "Nissan", jeep: "Jeep", ram: "Ram", chrysler: "Chrysler",
    plymouth: "Plymouth", pontiac: "Pontiac", buick: "Buick",
    oldsmobile: "Oldsmobile", cadillac: "Cadillac", mercury: "Mercury",
    lincoln: "Lincoln", amc: "AMC", studebaker: "Studebaker",
    packard: "Packard", desoto: "DeSoto", kaiser: "Kaiser",
    hudson: "Hudson", willys: "Willys", nash: "Nash",
    bmw: "BMW", mercedes: "Mercedes-Benz", porsche: "Porsche",
    volkswagen: "Volkswagen", vw: "Volkswagen", volvo: "Volvo",
    jaguar: "Jaguar", triumph: "Triumph", mg: "MG", austin: "Austin",
  };

  const make = words[0] ? (makeMap[words[0].toLowerCase()] || words[0]) : null;
  const model = words.slice(1, 3).join(" ") || null;

  return { year, make, model };
}

async function fetchListing(url: string): Promise<ParsedListing | null> {
  let fbId = extractFbId(url);
  let canonicalUrl: string;

  if (!fbId) {
    // Share link — resolve to real item URL
    process.stdout.write("(resolving share link) ");
    const resolved = await resolveShareLink(url);
    if (!resolved) {
      console.log("could not resolve share link");
      return null;
    }
    fbId = extractFbId(resolved)!;
    canonicalUrl = resolved;
  } else {
    canonicalUrl = `https://www.facebook.com/marketplace/item/${fbId}/`;
  }

  try {
    const response = await fetch(canonicalUrl, {
      headers: {
        "User-Agent": BOT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/"marketplace_listing_title":"([^"]+)"/);
    const rawTitle = titleMatch ? decodeUnicode(titleMatch[1]) : null;

    // Extract price
    const priceMatch = html.match(/"amount_with_offset_in_currency":"(\d+)"/);
    const offsetMatch = html.match(/"offset":(\d+)/);
    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 100;
    const price = priceMatch ? Math.round(parseInt(priceMatch[1]) / offset) : null;

    // Extract images (FB CDN URLs)
    const imageMatches = [...html.matchAll(/"uri":"(https:\/\/[^"]*scontent[^"]*\.jpg[^"]*)"/g)];
    const images = [...new Set(imageMatches.map((m) => decodeUnicode(m[1])))].slice(0, 20);

    // Extract description
    const descMatch = html.match(/"redacted_description":\{"text":"([^"]{10,500})"/);
    const description = descMatch ? decodeUnicode(descMatch[1]) : null;

    // Extract location
    const locMatch = html.match(/"location_text":\{"text":"([^"]+)"/);
    const location = locMatch ? decodeUnicode(locMatch[1]) : null;

    // Extract mileage
    const mileageMatch = (description || rawTitle || "").match(/(\d[\d,]+)\s*(?:miles?|mi\b)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, "")) : null;

    const parsed = rawTitle ? parseVehicleTitle(rawTitle) : { year: null, make: null, model: null };

    return {
      facebook_id: fbId,
      url: canonicalUrl,
      title: rawTitle,
      price: price && price > 0 && price < 5000000 ? price : null,
      parsed_year: parsed.year,
      parsed_make: parsed.make,
      parsed_model: parsed.model,
      image_url: images[0] || null,
      all_images: images,
      location,
      description,
      mileage,
    };
  } catch (err: any) {
    throw new Error(`Fetch failed: ${err.message}`);
  }
}

// ─── DATABASE ─────────────────────────────────────────────────────────

async function checkExisting(fbIds: string[]): Promise<Set<string>> {
  if (!fbIds.length) return new Set();
  const { data } = await supabase
    .from("marketplace_listings")
    .select("facebook_id")
    .in("facebook_id", fbIds);
  return new Set((data || []).map((r) => r.facebook_id));
}

async function insertListing(listing: ParsedListing): Promise<void> {
  const { error } = await supabase.from("marketplace_listings").insert({
    facebook_id: listing.facebook_id,
    url: listing.url,
    title: listing.title,
    price: listing.price,
    current_price: listing.price,
    parsed_year: listing.parsed_year,
    parsed_make: listing.parsed_make,
    parsed_model: listing.parsed_model,
    image_url: listing.image_url,
    all_images: listing.all_images,
    location: listing.location,
    description: listing.description,
    mileage: listing.mileage,
    platform: "facebook_marketplace",
    status: "active",
    priority: "manual_import",
    scraped_at: new Date().toISOString(),
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

// ─── MAIN ─────────────────────────────────────────────────────────────

async function readStdin(): Promise<string[]> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    const lines: string[] = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => resolve(lines));
  });
}

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Run with: dotenvx run -- npx tsx scripts/fb-import-urls.ts");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let urls: string[];

  if (args.length === 0) {
    console.log("Paste FB Marketplace URLs (one per line), then Ctrl+D:\n");
    const lines = await readStdin();
    urls = parseUrls(lines.join("\n"));
  } else if (args.length === 1 && fs.existsSync(args[0]) && !isFbUrl(args[0])) {
    urls = parseUrls(fs.readFileSync(args[0], "utf-8"));
  } else {
    urls = args.filter(isFbUrl);
  }

  if (!urls.length) {
    console.error("No valid Facebook Marketplace URLs found.");
    process.exit(1);
  }

  // Dedup by FB ID
  const uniqueUrls = [...new Map(
    urls.map((u) => [extractFbId(u) || u, u])
  ).values()];

  console.log(`\nFound ${uniqueUrls.length} unique URLs`);

  const fbIds = uniqueUrls.map(extractFbId).filter(Boolean) as string[];
  const existing = await checkExisting(fbIds);
  const toImport = uniqueUrls.filter((u) => {
    const id = extractFbId(u);
    return !id || !existing.has(id);
  });

  if (uniqueUrls.length - toImport.length > 0) {
    console.log(`Skipping ${uniqueUrls.length - toImport.length} already in DB`);
  }

  if (!toImport.length) {
    console.log("All URLs already imported.");
    return;
  }

  console.log(`Importing ${toImport.length}...\n`);

  const stats = { ok: 0, failed: 0 };
  const tierCounts: Record<string, number> = {};

  for (let i = 0; i < toImport.length; i++) {
    const url = toImport[i];
    const fbId = extractFbId(url) || "?";
    process.stdout.write(`[${i + 1}/${toImport.length}] ${fbId}  `);

    try {
      const listing = await fetchListing(url);
      if (!listing) {
        stats.failed++;
        continue;
      }

      await insertListing(listing);
      stats.ok++;

      const year = listing.parsed_year;
      const tier = !year ? "unknown"
        : year < 1955 ? "pre-55"
        : year <= 1963 ? "55-63"
        : year <= 1972 ? "64-72"
        : year <= 1987 ? "73-87"
        : year <= 2000 ? "88-00"
        : year <= 2007 ? "01-07"
        : year <= 2013 ? "08-13"
        : "modern";

      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      console.log(`✓  [${tier}]  ${listing.title || "(no title)"}${listing.price ? "  $" + listing.price.toLocaleString() : ""}`);
    } catch (err: any) {
      if (err.message?.includes("duplicate key") || err.message?.includes("unique constraint")) {
        console.log(`(already in DB)`);
        // Not a real failure - already imported
      } else {
        stats.failed++;
        console.log(`✗  ${err.message}`);
      }
    }

    if (i < toImport.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Imported: ${stats.ok}   Failed: ${stats.failed}`);
  if (Object.keys(tierCounts).length) {
    console.log("\nBy tier:");
    const tierOrder = ["64-72", "55-63", "pre-55", "73-87", "88-00", "01-07", "08-13", "modern", "unknown"];
    for (const tier of tierOrder) {
      if (tierCounts[tier]) console.log(`  ${tier}: ${tierCounts[tier]}`);
    }
  }
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Backfill missing make/model by re-scraping URLs with Firecrawl.
 *
 * This script:
 *  1) Finds vehicles with missing make that have discovery_url or listing_url
 *  2) Re-scrapes those URLs using Firecrawl API
 *  3) Extracts make/model from Firecrawl's markdown/HTML output
 *  4) Updates vehicles in the database
 *
 * Usage:
 *   tsx scripts/backfill-make-model-from-firecrawl.ts --dry-run
 *   tsx scripts/backfill-make-model-from-firecrawl.ts --limit 100
 *   tsx scripts/backfill-make-model-from-firecrawl.ts --verbose
 *
 * Env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (required for updates)
 *   FIRECRAWL_API_KEY (required for scraping)
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type CliOptions = {
  dryRun: boolean;
  limit: number;
  verbose: boolean;
  excludeMerged: boolean;
  batchSize: number;
};

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), "nuke_frontend/.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    limit: 0,
    verbose: false,
    excludeMerged: true,
    batchSize: 10,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") opts.limit = parseInt(argv[++i] || "0", 10);
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--include-merged") opts.excludeMerged = false;
    else if (a === "--batch-size") opts.batchSize = parseInt(argv[++i] || "10", 10);
    else if (a === "--help" || a === "-h") {
      console.log(`Backfill Make/Model from Firecrawl

Usage:
  tsx scripts/backfill-make-model-from-firecrawl.ts [--dry-run] [--limit <n>] [--verbose] [--batch-size <n>]

Flags:
  --dry-run          Preview what would be extracted/updated (no DB writes, no API calls)
  --limit <n>        Process only first N vehicles (default: all)
  --verbose          More logging
  --include-merged   Include vehicles with status='merged' (default: excluded)
  --batch-size <n>   Process N vehicles in parallel (default: 10)
`);
      process.exit(0);
    }
  }

  return opts;
}

function requireAnyEnv(names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  throw new Error(`Missing required env var. Provide one of: ${names.join(", ")}`);
}

async function fetchVehiclesMissingMake(
  supabaseUrl: string,
  key: string,
  excludeMerged: boolean,
  limit: number,
  offset: number = 0
): Promise<{ vehicles: any[]; hasMore: boolean }> {
  const statusFilter = excludeMerged ? `status=neq.merged&` : ``;
  const batchSize = 1000;
  const limitParam = limit > 0 ? Math.min(limit, batchSize) : batchSize;
  const selectFields = `select=id,make,model,discovery_url,listing_url,bat_auction_url,platform_url`;

  const filter = `or=(make.is.null,make.eq.)&${statusFilter}order=created_at.desc&limit=${limitParam}&offset=${offset}`;

  const resp = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?${selectFields}&${filter}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  );

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
    throw new Error(String(data.error));
  }
  const vehicles = Array.isArray(data) ? data : [];

  // Filter out vehicles that have non-empty make
  const missingMake = vehicles.filter((v) => !v.make || v.make.trim() === "");

  // Check if there are more results
  const hasMore = vehicles.length === limitParam && (limit <= 0 || offset + vehicles.length < limit);

  return { vehicles: missingMake, hasMore };
}

async function execUpdate(
  supabaseUrl: string,
  key: string,
  vehicleId: string,
  make: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      make,
      model,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 500)}` };
  }

  return { ok: true };
}

/**
 * Scrape URL with Firecrawl and extract make/model
 */
async function scrapeWithFirecrawl(
  url: string,
  firecrawlApiKey: string
): Promise<{ make: string | null; model: string | null; markdown?: string; error?: string }> {
  try {
    const extractionSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        trim: { type: "string" },
        vin: { type: "string" },
        asking_price: { type: "number" },
        price: { type: "number" },
        mileage: { type: "number" },
        location: { type: "string" },
        description: { type: "string" },
      },
    };

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["extract", "markdown", "html"],
        extract: { schema: extractionSchema },
        onlyMainContent: false,
        waitFor: 5000,
      }),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { make: null, model: null, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const result = await resp.json();

    if (!result.success) {
      return {
        make: null,
        model: null,
        error: result.error || "Firecrawl extraction failed",
      };
    }

    // Try structured extraction first
    const extracted = result.data?.extract;
    if (extracted?.make && extracted?.model) {
      return {
        make: cleanMakeName(extracted.make),
        model: cleanModelName(extracted.model),
        markdown: result.data?.markdown,
      };
    }

    // Fallback: Parse from markdown/HTML
    const markdown = result.data?.markdown || "";
    const html = result.data?.html || "";
    const combined = `${markdown}\n${html}`;

    // Extract from title patterns in markdown
    const titleMatch = combined.match(/(\d{4})\s+([A-Za-z][A-Za-z\s&-]+?)\s+(.+?)(?:\s|$|\n|#|##)/);
    if (titleMatch) {
      const make = titleMatch[2].trim();
      const model = titleMatch[3].trim();
      if (make.length > 1 && make.length < 50 && model.length > 1) {
        return {
          make: cleanMakeName(make),
          model: cleanModelName(model),
          markdown,
        };
      }
    }

    // Try to find make/model in common patterns
    const makeModelPatterns = [
      /Make[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
      /Manufacturer[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
      /Brand[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
    ];

    const modelPatterns = [
      /Model[:\s]+([A-Za-z0-9][A-Za-z0-9\s&-]+)/i,
      /Vehicle[:\s]+([A-Za-z0-9][A-Za-z0-9\s&-]+)/i,
    ];

    let extractedMake: string | null = null;
    let extractedModel: string | null = null;

    for (const pattern of makeModelPatterns) {
      const match = combined.match(pattern);
      if (match && match[1]) {
        extractedMake = cleanMakeName(match[1].trim());
        break;
      }
    }

    for (const pattern of modelPatterns) {
      const match = combined.match(pattern);
      if (match && match[1]) {
        extractedModel = cleanModelName(match[1].trim());
        break;
      }
    }

    if (extractedMake && extractedModel) {
      return { make: extractedMake, model: extractedModel, markdown };
    }

    return { make: null, model: null, markdown };
  } catch (err: any) {
    return {
      make: null,
      model: null,
      error: err.message || String(err),
    };
  }
}

/**
 * Clean make name
 */
function cleanMakeName(make: string | null): string | null {
  if (!make) return null;
  const m = make.trim();
  if (m.length === 0) return null;

  if (m.toLowerCase().match(/^mercedes[-\s]?benz$/i)) return "Mercedes-Benz";
  if (m.toLowerCase() === "mercedes") return "Mercedes-Benz";

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length === 1) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Clean model name
 */
function cleanModelName(model: string | null): string | null {
  if (!model) return null;
  const m = model.trim();
  if (m.length === 0) return null;

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length <= 3 && word.match(/^[A-Z]+$/)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Process vehicles in batches with rate limiting
 */
async function processBatch(
  vehicles: any[],
  firecrawlApiKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  opts: CliOptions
): Promise<{ processed: number; extracted: number; updated: number; errors: string[] }> {
  const results = {
    processed: 0,
    extracted: 0,
    updated: 0,
    errors: [] as string[],
  };

  // Process in parallel batches
  for (let i = 0; i < vehicles.length; i += opts.batchSize) {
    const batch = vehicles.slice(i, i + opts.batchSize);
    const promises = batch.map(async (vehicle) => {
      results.processed++;

      // Get URL to scrape
      const url =
        vehicle.discovery_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.platform_url;

      if (!url) {
        if (opts.verbose) {
          console.log(`⚠️  Vehicle ${vehicle.id.slice(0, 8)}... has no URL to scrape`);
        }
        return;
      }

      if (opts.verbose) {
        console.log(`🔍 Scraping ${vehicle.id.slice(0, 8)}... from ${url.substring(0, 60)}...`);
      }

      const extracted = await scrapeWithFirecrawl(url, firecrawlApiKey);

      if (extracted.error) {
        results.errors.push(`Vehicle ${vehicle.id}: ${extracted.error}`);
        if (opts.verbose) {
          console.log(`  ❌ Error: ${extracted.error}`);
        }
        return;
      }

      if (extracted.make && extracted.model) {
        results.extracted++;

        if (!opts.dryRun) {
          const updateResult = await execUpdate(
            supabaseUrl,
            supabaseKey,
            vehicle.id,
            extracted.make,
            extracted.model
          );

          if (updateResult.ok) {
            results.updated++;
            if (opts.verbose) {
              console.log(
                `  ✓ Updated: ${vehicle.make || "[empty]"} → ${extracted.make} / ${extracted.model}`
              );
            }
          } else {
            results.errors.push(`Failed to update ${vehicle.id}: ${updateResult.error}`);
          }
        } else {
          if (opts.verbose) {
            console.log(
              `  [DRY RUN] Would update: ${vehicle.make || "[empty]"} → ${extracted.make} / ${extracted.model}`
            );
          }
        }
      } else {
        if (opts.verbose) {
          console.log(`  ⚠️  Could not extract make/model from ${url.substring(0, 60)}...`);
        }
      }

      // Rate limiting: small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    await Promise.all(promises);

    // Longer delay between batches
    if (i + opts.batchSize < vehicles.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return results;
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = requireAnyEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);
  
  // Check for Firecrawl API key
  const firecrawlApiKey = (process.env.FIRECRAWL_API_KEY || "").trim();
  if (!firecrawlApiKey) {
    console.error("❌ Missing FIRECRAWL_API_KEY environment variable");
    console.error("   Set it in .env.local or .env file");
    process.exit(1);
  }
  
  // Test the key with a simple request
  if (!opts.dryRun) {
    try {
      const testResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://example.com",
          formats: ["markdown"],
        }),
        signal: AbortSignal.timeout(10000),
      });
      
      if (testResp.status === 401) {
        console.error("❌ FIRECRAWL_API_KEY is invalid (401 Unauthorized)");
        console.error("   Please check your Firecrawl API key");
        process.exit(1);
      }
    } catch (err: any) {
      if (err.message?.includes("401")) {
        console.error("❌ FIRECRAWL_API_KEY is invalid");
        process.exit(1);
      }
      // Other errors (timeout, network) are OK for now
    }
  }

  if (opts.verbose) console.log("Fetching vehicles missing make with URLs...");

  let allVehicles: any[] = [];
  let offset = 0;
  let hasMore = true;

  // Fetch all vehicles in batches
  while (hasMore && (opts.limit <= 0 || allVehicles.length < opts.limit)) {
    const { vehicles, hasMore: more } = await fetchVehiclesMissingMake(
      supabaseUrl,
      key,
      opts.excludeMerged,
      opts.limit > 0 ? opts.limit - allVehicles.length : 0,
      offset
    );

    // Filter to only vehicles with URLs
    const withUrls = vehicles.filter(
      (v) => v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url
    );
    allVehicles.push(...withUrls);

    hasMore = more && vehicles.length > 0;
    offset += vehicles.length;

    if (opts.verbose && allVehicles.length % 100 === 0) {
      console.log(`Fetched ${allVehicles.length} vehicles with URLs so far...`);
    }

    if (opts.limit > 0 && allVehicles.length >= opts.limit) {
      allVehicles = allVehicles.slice(0, opts.limit);
      break;
    }

    if (vehicles.length === 0) break;
  }

  console.log(`Found ${allVehicles.length} vehicles missing make with URLs to scrape`);

  if (opts.dryRun) {
    console.log("\n[DRY RUN] Would scrape and extract make/model from Firecrawl");
    console.log(`Sample URLs:`);
    allVehicles.slice(0, 5).forEach((v) => {
      const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
      console.log(`  ${v.id.slice(0, 8)}...: ${url?.substring(0, 80)}`);
    });
    return;
  }

  const results = await processBatch(allVehicles, firecrawlApiKey, supabaseUrl, key, opts);

  // Summary
  console.log("\n=== Backfill Summary ===");
  console.log(`Processed: ${results.processed}`);
  console.log(`Extracted make/model: ${results.extracted}`);
  console.log(`Updated in DB: ${results.updated}`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${results.errors.length}`);
    if (opts.verbose) {
      results.errors.slice(0, 10).forEach((err) => console.log(`  - ${err}`));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

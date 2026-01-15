#!/usr/bin/env node
/**
 * Backfill missing make/model fields by extracting from URLs and titles.
 *
 * This script:
 *  1) Finds vehicles with missing or empty make fields
 *  2) Extracts make/model from listing_title, discovery_url, listing_url, bat_listing_title
 *  3) Uses patterns similar to existing extraction logic
 *  4) Updates vehicles in the database (with dry-run option)
 *
 * Usage:
 *   tsx scripts/backfill-make-model-from-urls.ts --dry-run
 *   tsx scripts/backfill-make-model-from-urls.ts --limit 100
 *   tsx scripts/backfill-make-model-from-urls.ts --verbose
 *
 * Env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (required for updates)
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type CliOptions = {
  dryRun: boolean;
  limit: number;
  verbose: boolean;
  excludeMerged: boolean;
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
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") opts.limit = parseInt(argv[++i] || "0", 10);
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--include-merged") opts.excludeMerged = false;
    else if (a === "--help" || a === "-h") {
      console.log(`Backfill Make/Model from URLs and Titles

Usage:
  tsx scripts/backfill-make-model-from-urls.ts [--dry-run] [--limit <n>] [--verbose] [--include-merged]

Flags:
  --dry-run          Preview what would be extracted/updated (no DB writes)
  --limit <n>        Process only first N vehicles (default: all)
  --verbose          More logging
  --include-merged   Include vehicles with status='merged' (default: excluded)
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
  // Build filter using PostgREST query syntax
  const statusFilter = excludeMerged ? `status=neq.merged&` : ``;
  const batchSize = 1000; // PostgREST max per request
  const limitParam = limit > 0 ? Math.min(limit, batchSize) : batchSize;
  const selectFields = `select=id,make,model,listing_title,bat_listing_title,discovery_url,listing_url,bat_auction_url,platform_url`;

  // Use PostgREST to query vehicles missing make with pagination
  const filter = `or=(make.is.null,make.eq.)&order=created_at.desc&${statusFilter}limit=${limitParam}&offset=${offset}`;

  const resp = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?${selectFields}&${filter}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + limitParam - 1}`,
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
  
  // Check if there are more results
  const contentRange = resp.headers.get("content-range");
  const hasMore = vehicles.length === limitParam && (limit <= 0 || offset + vehicles.length < limit);
  
  return { vehicles, hasMore };
}

async function execUpdate(
  supabaseUrl: string,
  key: string,
  vehicleId: string,
  make: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  // Use Supabase REST API for safer updates
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
 * Extract make/model from title (e.g., "2001 Porsche 911 Turbo")
 */
function extractFromTitle(title: string | null): { make: string | null; model: string | null } {
  if (!title || !title.trim()) return { make: null, model: null };

  const t = title.trim();

  // Pattern: "2001 Porsche 911 Turbo"
  const yearMakeModelPattern = /^(\d{4})\s+([A-Za-z][A-Za-z\s&-]+?)\s+(.+)$/;
  const match = t.match(yearMakeModelPattern);
  if (match) {
    const make = match[2].trim();
    const model = match[3].trim();
    // Filter out common false positives
    if (make.length > 1 && make.length < 50 && model.length > 1) {
      return { make: cleanMakeName(make), model: cleanModelName(model) };
    }
  }

  // Pattern: "Porsche 911 Turbo" (no year)
  const makeModelPattern = /^([A-Za-z][A-Za-z\s&-]+?)\s+(.+)$/;
  const match2 = t.match(makeModelPattern);
  if (match2) {
    const make = match2[1].trim();
    const model = match2[2].trim();
    if (make.length > 1 && make.length < 50 && model.length > 1) {
      // Skip if first word looks like a model number or common non-make word
      const skipWords = ["the", "a", "an", "used", "new", "for", "sale"];
      if (!skipWords.includes(make.toLowerCase())) {
        return { make: cleanMakeName(make), model: cleanModelName(model) };
      }
    }
  }

  return { make: null, model: null };
}

/**
 * Extract make/model from URL slug (e.g., "/2001-porsche-911-turbo", "1958-chevrolet-corvette")
 */
function extractFromUrl(url: string | null): { make: string | null; model: string | null } {
  if (!url || !url.trim()) return { make: null, model: null };

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Pattern: "/vehicles/53/2001-porsche-911-turbo"
    const vehicleSlugMatch = pathname.match(/\/(\d{4})?-?([a-z0-9-]+)$/i);
    if (vehicleSlugMatch) {
      const slug = vehicleSlugMatch[2] || vehicleSlugMatch[1];
      if (slug) {
        const parts = slug.split("-").filter((p) => p.length > 0);
        // Skip year if present
        let startIdx = parts[0]?.match(/^\d{4}$/) ? 1 : 0;
        if (parts.length >= startIdx + 2) {
          const make = parts[startIdx];
          // Stop at common non-model suffixes (id, c-, numbers that look like IDs)
          let endIdx = parts.length;
          for (let i = startIdx + 1; i < parts.length; i++) {
            if (parts[i].match(/^(c|id|v|d)-\d+$/i) || (i > startIdx + 2 && parts[i].match(/^\d+[a-z]+\d+/i))) {
              endIdx = i;
              break;
            }
          }
          const modelParts = parts.slice(startIdx + 1, endIdx);
          if (make && make.length > 1 && modelParts.length > 0) {
            const model = modelParts.join(" ");
            // Filter out models that look like garbage (too many numbers)
            if (model.match(/\d{5,}/)) return { make: null, model: null };
            return { make: cleanMakeName(make), model: cleanModelName(model) };
          }
        }
      }
    }

    // Pattern: "1958-chevrolet-corvette-c-5202.htm"
    const classicSlugMatch = pathname.match(/(\d{4})-([a-z0-9-]+)-[c|id]-\d+\./i);
    if (classicSlugMatch) {
      const makeModel = classicSlugMatch[2];
      const parts = makeModel.split("-").filter((p) => p.length > 0);
      if (parts.length >= 2) {
        const make = parts[0];
        const model = parts.slice(1).join(" ");
        return { make: cleanMakeName(make), model: cleanModelName(model) };
      }
    }
  } catch {
    // Invalid URL, skip
  }

  return { make: null, model: null };
}

/**
 * Clean make name (capitalize first letter of each word)
 */
function cleanMakeName(make: string | null): string | null {
  if (!make) return null;
  const m = make.trim();
  if (m.length === 0) return null;

  // Normalize Mercedes-Benz variations
  if (m.toLowerCase().match(/^mercedes[-\s]?benz$/i)) return "Mercedes-Benz";
  if (m.toLowerCase() === "mercedes") return "Mercedes-Benz";

  // Capitalize first letter of each word
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
 * Clean model name (capitalize appropriately)
 */
function cleanModelName(model: string | null): string | null {
  if (!model) return null;
  const m = model.trim();
  if (m.length === 0) return null;

  // For models like "911 Turbo", preserve some capitalization
  // But capitalize first letter of each word
  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      // Preserve all-caps acronyms (e.g., "GT", "RS", "S")
      if (word.length <= 3 && word.match(/^[A-Z]+$/)) return word;
      // Capitalize first letter
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Extract make/model from multiple sources (title first, then URLs)
 */
function extractMakeModel(vehicle: any): { make: string | null; model: string | null } {
  // Try listing_title first (most reliable)
  if (vehicle.listing_title) {
    const fromTitle = extractFromTitle(vehicle.listing_title);
    if (fromTitle.make && fromTitle.model) {
      return fromTitle;
    }
  }

  // Try bat_listing_title
  if (vehicle.bat_listing_title) {
    const fromBat = extractFromTitle(vehicle.bat_listing_title);
    if (fromBat.make && fromBat.model) {
      return fromBat;
    }
  }

  // Try URLs in order of preference
  const urlFields = [
    vehicle.listing_url,
    vehicle.discovery_url,
    vehicle.bat_auction_url,
    vehicle.platform_url,
  ];

  for (const url of urlFields) {
    if (url) {
      const fromUrl = extractFromUrl(url);
      if (fromUrl.make && fromUrl.model) {
        return fromUrl;
      }
    }
  }

  return { make: null, model: null };
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

  if (opts.verbose) console.log("Fetching vehicles missing make...");
  
  let allVehicles: any[] = [];
  let offset = 0;
  let hasMore = true;
  const batchSize = 1000;
  
  // Fetch all vehicles in batches
  while (hasMore && (opts.limit <= 0 || allVehicles.length < opts.limit)) {
    const remainingLimit = opts.limit > 0 ? opts.limit - allVehicles.length : 0;
    const { vehicles, hasMore: more } = await fetchVehiclesMissingMake(
      supabaseUrl,
      key,
      opts.excludeMerged,
      remainingLimit > 0 ? remainingLimit : batchSize,
      offset
    );
    
    // Filter out vehicles that have non-empty make (PostgREST filter doesn't handle empty string perfectly)
    const missingMake = vehicles.filter((v) => !v.make || v.make.trim() === "");
    allVehicles.push(...missingMake);
    
    // Update hasMore: continue if we got a full batch and haven't hit the limit
    hasMore = vehicles.length === batchSize && (opts.limit <= 0 || allVehicles.length < opts.limit);
    offset += vehicles.length;
    
    if (opts.verbose && allVehicles.length % 1000 === 0) {
      console.log(`Fetched ${allVehicles.length} vehicles so far...`);
    }
    
    if (opts.limit > 0 && allVehicles.length >= opts.limit) {
      allVehicles = allVehicles.slice(0, opts.limit);
      break;
    }
    
    // Stop if we got fewer vehicles than requested (end of results)
    if (vehicles.length < batchSize) {
      hasMore = false;
      break;
    }
    
    // Small delay to avoid rate limiting
    if (hasMore) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const vehiclesMissingMake = allVehicles;
  console.log(`Found ${vehiclesMissingMake.length} vehicles missing make`);

  const results = {
    processed: 0,
    extracted: 0,
    updated: 0,
    errors: [] as string[],
    samples: [] as Array<{
      id: string;
      old_make: string | null;
      old_model: string | null;
      new_make: string | null;
      new_model: string | null;
      source: string;
    }>,
  };

  for (const vehicle of vehiclesMissingMake) {
    results.processed++;

    const extracted = extractMakeModel(vehicle);
    if (extracted.make && extracted.model) {
      results.extracted++;

      const sample = {
        id: vehicle.id,
        old_make: vehicle.make || null,
        old_model: vehicle.model || null,
        new_make: extracted.make,
        new_model: extracted.model,
        source: vehicle.listing_title
          ? "listing_title"
          : vehicle.bat_listing_title
            ? "bat_listing_title"
            : vehicle.listing_url
              ? "listing_url"
              : vehicle.discovery_url
                ? "discovery_url"
                : "other_url",
      };

      results.samples.push(sample);

      if (!opts.dryRun) {
        // Update vehicle via REST API
        try {
          const updateResult = await execUpdate(
            supabaseUrl,
            key,
            vehicle.id,
            extracted.make,
            extracted.model
          );
          if (updateResult.ok) {
            results.updated++;
            if (opts.verbose) {
              console.log(
                `✓ Updated ${vehicle.id}: ${vehicle.make || "[empty]"} → ${extracted.make}`
              );
            }
          } else {
            results.errors.push(`Failed to update ${vehicle.id}: ${updateResult.error}`);
          }
        } catch (err: any) {
          results.errors.push(`Error updating ${vehicle.id}: ${err.message}`);
        }
      } else {
        if (opts.verbose) {
          console.log(
            `[DRY RUN] Would update ${vehicle.id}: ${vehicle.make || "[empty]"} → ${extracted.make} / ${extracted.model}`
          );
        }
      }
    }

    if (opts.verbose && results.processed % 100 === 0) {
      console.log(`Processed ${results.processed}/${vehiclesMissingMake.length}...`);
    }
  }

  // Summary
  console.log("\n=== Backfill Summary ===");
  console.log(`Processed: ${results.processed}`);
  console.log(`Extracted make/model: ${results.extracted}`);
  if (!opts.dryRun) {
    console.log(`Updated in DB: ${results.updated}`);
    if (results.errors.length > 0) {
      console.log(`Errors: ${results.errors.length}`);
      if (opts.verbose) {
        results.errors.slice(0, 10).forEach((err) => console.log(`  - ${err}`));
      }
    }
  } else {
    console.log(`[DRY RUN] Would update: ${results.extracted}`);
  }

  // Show samples
  if (results.samples.length > 0) {
    console.log("\n=== Sample Extractions ===");
    results.samples.slice(0, 10).forEach((s) => {
      console.log(
        `${s.id.slice(0, 8)}... | ${s.old_make || "[empty]"} → ${s.new_make} | ${s.new_model} (from ${s.source})`
      );
    });
  }

  if (opts.dryRun) {
    console.log("\n💡 Run without --dry-run to apply updates");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

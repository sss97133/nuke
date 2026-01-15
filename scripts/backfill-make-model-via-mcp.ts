#!/usr/bin/env node
/**
 * Backfill missing make/model using Firecrawl MCP tools.
 *
 * This script uses the Firecrawl MCP server (via the AI assistant's tools)
 * to extract make/model from vehicle URLs. It's designed to be run interactively
 * with the AI assistant calling the MCP tools.
 *
 * Usage:
 *   This script identifies vehicles and prepares them for MCP extraction.
 *   The actual scraping is done via MCP tools called by the AI assistant.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type CliOptions = {
  limit: number;
  excludeMerged: boolean;
  outputFile: string | null;
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
    limit: 100,
    excludeMerged: true,
    outputFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") opts.limit = parseInt(argv[++i] || "100", 10);
    else if (a === "--include-merged") opts.excludeMerged = false;
    else if (a === "--out") opts.outputFile = argv[++i] || null;
    else if (a === "--help" || a === "-h") {
      console.log(`Backfill Make/Model via MCP

Usage:
  tsx scripts/backfill-make-model-via-mcp.ts [options]

Options:
  --limit <n>        Maximum number of vehicles to process (default: 100)
  --include-merged   Include vehicles with status='merged' (default: false)
  --out <file>       Save vehicle list to JSON file for batch processing
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
  limit: number
): Promise<any[]> {
  let allVehicles: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (allVehicles.length < limit) {
    const statusFilter = excludeMerged ? `status=neq.merged&` : ``;
    const limitParam = Math.min(limit - allVehicles.length, batchSize);
    const selectFields = `select=id,discovery_url,listing_url,bat_auction_url,platform_url,make,model`;

    const filter = `or=(make.is.null,make.eq.)&${statusFilter}order=created_at.desc&limit=${limitParam}&offset=${offset}`;

    const resp = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?${selectFields}&${filter}`,
      {
        headers: {
          Accept: "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );

    const vehicles = await resp.json();
    if (!Array.isArray(vehicles) || vehicles.length === 0) break;

    // Filter to vehicles with URLs and still missing make
    const withUrls = vehicles.filter(
      (v) =>
        (!v.make || v.make.trim() === "") &&
        (v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url)
    );

    allVehicles.push(...withUrls);
    offset += vehicles.length;

    if (vehicles.length < batchSize) break;
    if (allVehicles.length >= limit) break;
  }

  return allVehicles.slice(0, limit);
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

  console.log(`Fetching vehicles missing make with URLs (limit: ${opts.limit})...`);
  const vehicles = await fetchVehiclesMissingMake(supabaseUrl, key, opts.excludeMerged, opts.limit);

  console.log(`\nFound ${vehicles.length} vehicles missing make with URLs\n`);

  // Group by URL type for better organization
  const vehiclesByUrlType: Record<string, any[]> = {
    discovery_url: [],
    listing_url: [],
    bat_auction_url: [],
    platform_url: [],
  };

  vehicles.forEach((v) => {
    if (v.discovery_url) vehiclesByUrlType.discovery_url.push(v);
    else if (v.listing_url) vehiclesByUrlType.listing_url.push(v);
    else if (v.bat_auction_url) vehiclesByUrlType.bat_auction_url.push(v);
    else if (v.platform_url) vehiclesByUrlType.platform_url.push(v);
  });

  console.log("Vehicles by URL type:");
  Object.entries(vehiclesByUrlType).forEach(([type, vs]) => {
    if (vs.length > 0) {
      console.log(`  ${type}: ${vs.length}`);
    }
  });

  // Show sample URLs
  console.log("\nSample URLs to extract:");
  vehicles.slice(0, 10).forEach((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    console.log(`  ${v.id.slice(0, 8)}...: ${url?.substring(0, 80)}`);
  });

  // Save to file if requested
  if (opts.outputFile) {
    const output = {
      generated_at: new Date().toISOString(),
      total_vehicles: vehicles.length,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        url: v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url,
        url_type: v.discovery_url
          ? "discovery_url"
          : v.listing_url
          ? "listing_url"
          : v.bat_auction_url
          ? "bat_auction_url"
          : "platform_url",
      })),
    };

    fs.mkdirSync(path.dirname(opts.outputFile), { recursive: true });
    fs.writeFileSync(opts.outputFile, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved vehicle list to ${opts.outputFile}`);
  }

  console.log(`\n📋 Ready for MCP extraction:`);
  console.log(`   Use firecrawl_extract with schema to extract make/model from these URLs`);
  console.log(`   Or use firecrawl_scrape to get markdown/HTML and parse manually`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

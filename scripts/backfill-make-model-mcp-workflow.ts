#!/usr/bin/env node
/**
 * Workflow script for backfilling make/model using Firecrawl MCP tools.
 *
 * This script:
 * 1. Filters vehicles to only those with actual listing URLs (not sitemap.xml)
 * 2. Prepares batches for MCP extraction
 * 3. Provides instructions for using MCP tools
 *
 * Usage:
 *   tsx scripts/backfill-make-model-mcp-workflow.ts --limit 50
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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

function requireAnyEnv(names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  throw new Error(`Missing required env var. Provide one of: ${names.join(", ")}`);
}

function isSitemapUrl(url: string): boolean {
  return url.includes("/sitemap.xml") || url.endsWith("/sitemap");
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
    const selectFields = `select=id,discovery_url,listing_url,bat_auction_url,platform_url`;

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
  const limit = parseInt(process.argv.find((a) => a.startsWith("--limit"))?.split("=")[1] || "100", 10);

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = requireAnyEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  console.log(`Fetching vehicles missing make with URLs (limit: ${limit})...`);
  const vehicles = await fetchVehiclesMissingMake(supabaseUrl, key, true, limit);

  // Filter out sitemap URLs - they won't have vehicle data
  const validVehicles = vehicles.filter((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    return url && !isSitemapUrl(url);
  });

  console.log(`\nFound ${vehicles.length} vehicles with URLs`);
  console.log(`Filtered to ${validVehicles.length} vehicles with valid listing URLs (excluded ${vehicles.length - validVehicles.length} sitemap.xml URLs)\n`);

  // Group by domain for better organization
  const byDomain: Record<string, any[]> = {};
  validVehicles.forEach((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    if (url) {
      try {
        const domain = new URL(url).hostname.replace("www.", "");
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push({ ...v, url });
      } catch {
        // invalid URL
      }
    }
  });

  console.log("Vehicles by domain:");
  Object.entries(byDomain)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([domain, vs]) => {
      console.log(`  ${domain}: ${vs.length}`);
    });

  // Save for MCP processing
  const outputFile = `data/json/vehicles-mcp-valid-${Date.now()}.json`;
  const output = {
    generated_at: new Date().toISOString(),
    total_vehicles: validVehicles.length,
    vehicles: validVehicles.map((v) => ({
      id: v.id,
      url: v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url,
    })),
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log(`\n💾 Saved ${validVehicles.length} vehicles to ${outputFile}`);
  console.log("\n📋 Next steps:");
  console.log("1. Use Firecrawl MCP tools to extract make/model from these URLs");
  console.log("2. Save results in the format expected by backfill-make-model-mcp-batch.ts");
  console.log("3. Run: npm run backfill:make-model:mcp-update -- <results-file>");
  console.log("\nSample URLs (first 10):");
  validVehicles.slice(0, 10).forEach((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    console.log(`  ${v.id.slice(0, 8)}...: ${url?.substring(0, 80)}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Analyze sources for vehicles missing make/model.
 *
 * Identifies:
 *  - Which sources (discovery_source, platform_source) vehicles came from
 *  - How many have URLs that can be scraped
 *  - Sample URLs by source
 *
 * Usage:
 *   tsx scripts/analyze-missing-make-sources.ts
 *   tsx scripts/analyze-missing-make-sources.ts --out data/json/missing_make_sources.json
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

async function fetchVehiclesMissingMake(
  supabaseUrl: string,
  key: string,
  limit: number = 10000
): Promise<any[]> {
  let allVehicles: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (allVehicles.length < limit) {
    const resp = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?select=id,discovery_source,platform_source,discovery_url,listing_url,bat_auction_url,platform_url&or=(make.is.null,make.eq.)&status=neq.merged&limit=${batchSize}&offset=${offset}`,
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

    allVehicles.push(...vehicles);
    offset += vehicles.length;

    if (vehicles.length < batchSize) break;
    if (allVehicles.length >= limit) break;
  }

  return allVehicles;
}

async function main(): Promise<void> {
  loadEnv();

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = requireAnyEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  console.log("Fetching vehicles missing make...");
  const vehicles = await fetchVehiclesMissingMake(supabaseUrl, key);

  console.log(`Found ${vehicles.length} vehicles missing make\n`);

  // Analyze by source
  const sourceStats: Record<
    string,
    {
      total: number;
      withUrls: number;
      withoutUrls: number;
      urlTypes: { discovery_url: number; listing_url: number; bat_auction_url: number; platform_url: number };
      sampleUrls: string[];
    }
  > = {};

  vehicles.forEach((v) => {
    const source = v.discovery_source || v.platform_source || "unknown";
    if (!sourceStats[source]) {
      sourceStats[source] = {
        total: 0,
        withUrls: 0,
        withoutUrls: 0,
        urlTypes: {
          discovery_url: 0,
          listing_url: 0,
          bat_auction_url: 0,
          platform_url: 0,
        },
        sampleUrls: [],
      };
    }

    sourceStats[source].total++;
    const hasUrl = !!(v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url);

    if (hasUrl) {
      sourceStats[source].withUrls++;
      if (v.discovery_url) sourceStats[source].urlTypes.discovery_url++;
      if (v.listing_url) sourceStats[source].urlTypes.listing_url++;
      if (v.bat_auction_url) sourceStats[source].urlTypes.bat_auction_url++;
      if (v.platform_url) sourceStats[source].urlTypes.platform_url++;

      if (sourceStats[source].sampleUrls.length < 5) {
        const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
        if (url) sourceStats[source].sampleUrls.push(url);
      }
    } else {
      sourceStats[source].withoutUrls++;
    }
  });

  // Sort by total count
  const sortedSources = Object.entries(sourceStats).sort((a, b) => b[1].total - a[1].total);

  console.log("=== Source Breakdown ===\n");
  sortedSources.forEach(([source, stats]) => {
    const pctWithUrls = ((stats.withUrls / stats.total) * 100).toFixed(1);
    console.log(`${source}:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  With URLs: ${stats.withUrls} (${pctWithUrls}%)`);
    console.log(`  Without URLs: ${stats.withoutUrls}`);
    console.log(`  URL types: discovery=${stats.urlTypes.discovery_url}, listing=${stats.urlTypes.listing_url}, bat=${stats.urlTypes.bat_auction_url}, platform=${stats.urlTypes.platform_url}`);
    if (stats.sampleUrls.length > 0) {
      console.log(`  Sample URLs:`);
      stats.sampleUrls.forEach((url) => console.log(`    - ${url.substring(0, 80)}`));
    }
    console.log();
  });

  // Overall stats
  const totalWithUrls = vehicles.filter(
    (v) => v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url
  ).length;
  const totalWithoutUrls = vehicles.length - totalWithUrls;

  console.log("=== Overall Summary ===");
  console.log(`Total vehicles missing make: ${vehicles.length}`);
  console.log(`With scrapeable URLs: ${totalWithUrls} (${((totalWithUrls / vehicles.length) * 100).toFixed(1)}%)`);
  console.log(`Without URLs: ${totalWithoutUrls} (${((totalWithoutUrls / vehicles.length) * 100).toFixed(1)}%)`);

  // Save to JSON if requested
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : null;

  if (outPath) {
    const output = {
      generated_at: new Date().toISOString(),
      total_vehicles_missing_make: vehicles.length,
      total_with_urls: totalWithUrls,
      total_without_urls: totalWithoutUrls,
      sources: sourceStats,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved analysis to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

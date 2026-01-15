#!/usr/bin/env node
/**
 * Prepare vehicle URLs for searching in Firecrawl logs.
 * 
 * This script creates a searchable list of URLs that can be used to:
 * 1. Search in Firecrawl logs dashboard (https://www.firecrawl.dev/app/logs)
 * 2. Download JSON data for previously scraped URLs
 * 3. Extract make/model from cached Firecrawl data
 *
 * Usage:
 *   tsx scripts/prepare-firecrawl-logs-search.ts --limit 100
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

  // Filter out sitemap URLs
  const validVehicles = vehicles.filter((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    return url && !isSitemapUrl(url);
  });

  console.log(`\nFound ${validVehicles.length} vehicles with valid listing URLs\n`);

  // Create searchable URL list
  const urlList = validVehicles.map((v) => {
    const url = v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url;
    return {
      vehicle_id: v.id,
      url: url,
      domain: url ? new URL(url).hostname.replace("www.", "") : null,
    };
  });

  // Save as JSON for easy searching
  const outputFile = `data/json/firecrawl-logs-search-${Date.now()}.json`;
  const output = {
    generated_at: new Date().toISOString(),
    total_urls: urlList.length,
    instructions: [
      "1. Go to https://www.firecrawl.dev/app/logs",
      "2. Search for each URL in the logs",
      "3. Click 'Download JSON' button for each scraped result",
      "4. Extract make/model from the downloaded JSON files",
      "5. Use backfill-make-model-mcp-batch.ts to update database"
    ],
    urls: urlList,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  // Also create a simple text file with just URLs for easy copy-paste
  const urlTextFile = outputFile.replace(".json", "-urls.txt");
  const urlText = urlList.map((item) => item.url).join("\n");
  fs.writeFileSync(urlTextFile, urlText);

  console.log(`💾 Saved ${urlList.length} URLs to:`);
  console.log(`   ${outputFile}`);
  console.log(`   ${urlTextFile} (plain text URLs)`);
  
  console.log(`\n📋 Next steps:`);
  console.log(`1. Log in to https://www.firecrawl.dev/app/logs`);
  console.log(`2. Search for URLs from ${urlTextFile}`);
  console.log(`3. Download JSON for each scraped result`);
  console.log(`4. Extract make/model from JSON and update database`);
  
  // Group by domain for easier searching
  const byDomain: Record<string, number> = {};
  urlList.forEach((item) => {
    if (item.domain) {
      byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
    }
  });

  console.log(`\nURLs by domain:`);
  Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .forEach(([domain, count]) => {
      console.log(`  ${domain}: ${count}`);
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

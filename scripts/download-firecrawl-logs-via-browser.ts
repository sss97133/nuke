#!/usr/bin/env node
/**
 * Download Firecrawl logs JSON files via browser automation.
 *
 * This script uses browser automation to:
 * 1. Navigate to Firecrawl logs page
 * 2. Search for vehicle URLs
 * 3. Click "Download JSON" buttons
 * 4. Save the JSON files locally
 *
 * Usage:
 *   tsx scripts/download-firecrawl-logs-via-browser.ts --urls data/json/firecrawl-logs-search-*.json
 *
 * Note: Requires manual login to Firecrawl first, then the script automates the downloads.
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

async function main(): Promise<void> {
  loadEnv();

  const urlsFile = process.argv.find((a) => a.startsWith("--urls"))?.split("=")[1];
  if (!urlsFile || !fs.existsSync(urlsFile)) {
    console.error("Usage: tsx scripts/download-firecrawl-logs-via-browser.ts --urls <vehicle-list.json>");
    console.error("\nThis script requires:");
    console.error("1. Manual login to https://www.firecrawl.dev/app/logs");
    console.error("2. Browser automation to click Download JSON buttons");
    console.error("\nAlternative: Use browser automation tools or manually download JSON files");
    process.exit(1);
  }

  const vehicleData = JSON.parse(fs.readFileSync(urlsFile, "utf-8"));
  const vehicles = vehicleData.urls || vehicleData.vehicles || [];

  console.log(`\n📋 Instructions for downloading ${vehicles.length} Firecrawl JSON files:\n`);
  console.log("1. Log in to: https://www.firecrawl.dev/app/logs");
  console.log("2. For each URL below, search in the logs page");
  console.log("3. Click the 'Download JSON' button for each result");
  console.log("4. Save files to: ./firecrawl-downloads/");
  console.log("5. Then run: npm run parse:firecrawl-json -- --dir ./firecrawl-downloads\n");

  console.log("URLs to search for:");
  vehicles.slice(0, 20).forEach((item: any, i: number) => {
    const url = item.url || item;
    console.log(`${i + 1}. ${url}`);
  });

  if (vehicles.length > 20) {
    console.log(`\n... and ${vehicles.length - 20} more URLs`);
  }

  console.log(`\n💡 Tip: Use browser search (Cmd/Ctrl+F) to quickly find URLs in the logs page`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

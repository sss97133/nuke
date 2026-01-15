#!/usr/bin/env node
/**
 * Automate downloading JSON files from Firecrawl logs page.
 *
 * This script uses Playwright to:
 * 1. Navigate to Firecrawl logs (assumes you're already logged in via browser)
 * 2. Search for vehicle URLs
 * 3. Click "Download JSON" buttons
 * 4. Save files locally
 *
 * Usage:
 *   tsx scripts/automate-firecrawl-logs-download.ts --urls data/json/firecrawl-logs-search-*.json
 *
 * Note: You must be logged into Firecrawl in your default browser first.
 * The script will use your existing browser session.
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright";

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), "nuke_frontend/.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) require("dotenv").config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  loadEnv();

  const urlsFile = process.argv.find((a) => a.startsWith("--urls"))?.split("=")[1];
  if (!urlsFile || !fs.existsSync(urlsFile)) {
    console.error("Usage: tsx scripts/automate-firecrawl-logs-download.ts --urls <vehicle-list.json>");
    process.exit(1);
  }

  const vehicleData = JSON.parse(fs.readFileSync(urlsFile, "utf-8"));
  const vehicles = vehicleData.urls || vehicleData.vehicles || [];

  console.log(`Will download JSON for ${vehicles.length} URLs\n`);

  // Launch browser with user data (to use existing login session)
  const browser = await chromium.launch({
    headless: false, // Show browser so user can see what's happening
    channel: "chrome", // Use Chrome if available
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to logs page
    console.log("Navigating to Firecrawl logs...");
    await page.goto("https://www.firecrawl.dev/app/logs", { waitUntil: "networkidle" });

    // Wait a bit for page to load
    await page.waitForTimeout(2000);

    // Check if we're logged in
    const isLoggedIn = !page.url().includes("/signin");
    if (!isLoggedIn) {
      console.log("\n⚠️  Not logged in. Please log in to Firecrawl in the browser window.");
      console.log("   The script will wait for you to log in...");
      await page.waitForURL("**/logs", { timeout: 120000 }); // Wait up to 2 minutes
    }

    const downloadDir = path.resolve(process.cwd(), "firecrawl-downloads");
    fs.mkdirSync(downloadDir, { recursive: true });

    // Set up download handling
    const downloads: string[] = [];
    page.on("download", async (download) => {
      const fileName = download.suggestedFilename() || `download-${Date.now()}.json`;
      const filePath = path.join(downloadDir, fileName);
      await download.saveAs(filePath);
      downloads.push(filePath);
      console.log(`  ✓ Downloaded: ${fileName}`);
    });

    let downloaded = 0;
    let notFound = 0;

    // Process each URL
    for (let i = 0; i < vehicles.length; i++) {
      const item = vehicles[i];
      const url = item.url || item;
      const vehicleId = item.vehicle_id || item.id || `vehicle-${i}`;

      console.log(`\n[${i + 1}/${vehicles.length}] Searching for: ${url.substring(0, 60)}...`);

      try {
        // Use browser search (Cmd/Ctrl+F) to find the URL
        // Or try to find it in the page
        const searchInput = await page.locator('input[type="search"], input[placeholder*="search" i]').first();
        if (await searchInput.isVisible()) {
          await searchInput.fill(url);
          await page.waitForTimeout(1000);
        }

        // Look for the Download JSON button
        // The button has class with "file-json" and text "Download JSON"
        const downloadButton = page.locator('button:has-text("Download JSON"), button:has([class*="file-json"])').first();

        if (await downloadButton.isVisible({ timeout: 5000 })) {
          await downloadButton.click();
          await page.waitForTimeout(1000); // Wait for download to start
          downloaded++;
          console.log(`  ✓ Found and downloaded`);
        } else {
          console.log(`  ⚠️  Not found in logs (may not have been scraped yet)`);
          notFound++;
        }
      } catch (err: any) {
        console.log(`  ✗ Error: ${err.message}`);
        notFound++;
      }

      // Small delay between searches
      await page.waitForTimeout(500);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total URLs: ${vehicles.length}`);
    console.log(`Downloaded: ${downloaded}`);
    console.log(`Not found: ${notFound}`);
    console.log(`\n💾 Files saved to: ${downloadDir}`);
    console.log(`\n📋 Next step:`);
    console.log(`   npm run parse:firecrawl-json -- --dir ${downloadDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

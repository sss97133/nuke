#!/usr/bin/env npx tsx
/**
 * Find Barrett-Jackson API endpoints by intercepting network traffic
 */

import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const apiCalls: any[] = [];

  // Intercept network requests
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("api") || url.includes("graphql") || url.includes(".json")) {
      console.log("REQUEST:", request.method(), url.slice(0, 150));
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if ((url.includes("api") || url.includes("graphql") || url.includes(".json")) &&
        response.status() === 200) {
      try {
        const text = await response.text();
        if (text.includes("vehicle") || text.includes("lot") || text.includes("docket")) {
          console.log("\n=== FOUND VEHICLE DATA ===");
          console.log("URL:", url);
          console.log("Preview:", text.slice(0, 500));
          apiCalls.push({ url, data: text.slice(0, 2000) });
        }
      } catch {}
    }
  });

  console.log("Navigating to BJ docket...\n");
  await page.goto("https://www.barrett-jackson.com/2026-scottsdale/docket", { waitUntil: "networkidle" });

  // Scroll to trigger more API calls
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(5000);

  console.log("\n\n=== API CALLS FOUND ===");
  apiCalls.forEach((call, i) => {
    console.log(`\n[${i + 1}] ${call.url}`);
  });

  // Also check the results page
  console.log("\n\nChecking results page...\n");
  await page.goto("https://www.barrett-jackson.com/results?type=Vehicles", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  await browser.close();
}

main().catch(console.error);

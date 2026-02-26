#!/usr/bin/env npx tsx
/**
 * View FB Marketplace listings using saved Chrome session
 * Opens each listing in a headed browser so you can actually see them
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-view-listings.ts
 *   dotenvx run -- npx tsx scripts/fb-view-listings.ts --tier=64-72
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as readline from "readline";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FB_SESSION_DIR = path.resolve("/Users/skylar/nuke/fb-session-1");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const tierFilter = args.find(a => a.startsWith("--tier="))?.split("=")[1];

  let query = supabase
    .from("marketplace_listings")
    .select("id, facebook_id, url, title, parsed_year, parsed_make, parsed_model, price, location, year_tier")
    .eq("priority", "manual_import")
    .order("year_tier")
    .order("parsed_year");

  if (tierFilter) query = query.eq("year_tier", tierFilter);

  const { data: listings, error } = await query;
  if (error || !listings?.length) {
    console.error("No listings found:", error?.message);
    process.exit(1);
  }

  console.log(`Found ${listings.length} listings. Opening browser with saved session...\n`);

  const browser = await chromium.launchPersistentContext(FB_SESSION_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1400, height: 900 },
  });

  const page = await browser.newPage();

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const label = `[${i + 1}/${listings.length}]  [${l.year_tier || "?"}]  ${l.parsed_year || "?"} ${l.parsed_make || ""} ${l.parsed_model || ""}  $${l.price?.toLocaleString() || "?"}  ${l.location || ""}`;
    console.log(label);
    console.log(`  ${l.url}`);

    await page.goto(l.url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (i < listings.length - 1) {
      const ans = await prompt(`  → next / skip / quit? [Enter=next] `);
      if (ans.trim().toLowerCase() === "q" || ans.trim().toLowerCase() === "quit") break;
    }
  }

  console.log("\nDone. Close the browser window when finished.");
  await prompt("Press Enter to close browser...");
  await browser.close();
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Invoke extract-gooding to backfill the Ferrari Daytona (and optionally other Gooding lots).
 * Ensures chassis, coachwork, estimate, highlights, specs, saleroom addendum, and calendar position are saved.
 *
 * Usage:
 *   npx tsx scripts/backfill-gooding-now.ts
 *   npx tsx scripts/backfill-gooding-now.ts --single   # only the Ferrari URL
 *   npx tsx scripts/backfill-gooding-now.ts --dry-run   # no save_to_db
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const FERRARI_URL =
  "https://www.goodingco.com/lot/1973-ferrari-365-gtb-4-daytona-competizione-series-iii";

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "nuke_frontend/.env.local"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const singleOnly = args.includes("--single");

  const supabaseUrl = requireEnv("VITE_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const functionUrl = `${supabaseUrl}/functions/v1/extract-gooding`;

  if (singleOnly) {
    // Single URL (Ferrari) – re-extract and save
    const body: Record<string, unknown> = {
      url: FERRARI_URL,
      save_to_db: !dryRun,
    };
    console.log("Invoking extract-gooding (single):", body.url);
    if (dryRun) console.log("(dry-run: save_to_db=false)");

    const resp = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("Error:", data);
      process.exit(1);
    }

    console.log("\n=== Result ===");
    console.log("Success:", data.success);
    if (data.extracted) {
      const e = data.extracted;
      console.log("VIN/Chassis:", e.vin ?? "N/A");
      console.log("Coachwork:", e.coachwork ?? "N/A");
      console.log("Estimate:", e.estimate_low != null && e.estimate_high != null ? `${e.estimate_low} - ${e.estimate_high}` : "N/A");
      console.log("Calendar:", e.auction_calendar_position ?? "N/A");
      console.log("Highlights:", Array.isArray(e.highlights) ? e.highlights.length : 0);
      console.log("Specs:", Array.isArray(e.specifications) ? e.specifications.length : 0);
    }
    if (data._db) {
      console.log("Vehicle ID:", data._db.vehicle_id);
      console.log("Images saved:", data._db.images_saved);
      console.log("New vehicle:", data._db.is_new);
    }
    return;
  }

  // Backfill action: Ferrari + any other URLs you add here
  const urls = [FERRARI_URL];
  const body = {
    action: "backfill",
    urls,
    limit: urls.length,
  };
  console.log("Invoking extract-gooding (backfill):", urls.length, "URL(s)");
  if (dryRun) console.log("(dry-run: still saves – use --single --dry-run to skip DB)");

  const resp = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Error:", data);
    process.exit(1);
  }

  console.log("\n=== Backfill Result ===");
  console.log(JSON.stringify(data.results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

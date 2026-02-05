#!/usr/bin/env node
/**
 * Invoke extract-gooding to backfill Gooding lots (chassis, coachwork, estimate, calendar, SRA, full highlights/specs).
 *
 * Usage:
 *   npx tsx scripts/backfill-gooding-now.ts --single           # Ferrari only
 *   npx tsx scripts/backfill-gooding-now.ts --batch 20          # discover + backfill 20 lots per chunk
 *   npx tsx scripts/backfill-gooding-now.ts --batch 20 --chunks 5   # run 5 chunks (100 lots)
 *   npx tsx scripts/backfill-gooding-now.ts --batch 20 --offset 100  # chunk starting at offset 100
 *   npx tsx scripts/backfill-gooding-now.ts --dry-run          # no save_to_db (single only)
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
  const batchArg = args.find((a) => a === "--batch");
  const batchIdx = batchArg ? args.indexOf(batchArg) : -1;
  const chunkSize = batchIdx >= 0 && args[batchIdx + 1] ? parseInt(args[batchIdx + 1], 10) : 0;
  const chunksArg = args.find((a) => a === "--chunks");
  const chunksIdx = chunksArg ? args.indexOf(chunksArg) : -1;
  const numChunks = chunksIdx >= 0 && args[chunksIdx + 1] ? parseInt(args[chunksIdx + 1], 10) : 1;
  const offsetArg = args.find((a) => a === "--offset");
  const offsetIdx = offsetArg ? args.indexOf(offsetArg) : -1;
  const startOffset = offsetIdx >= 0 && args[offsetIdx + 1] ? parseInt(args[offsetIdx + 1], 10) : 0;

  const supabaseUrl = requireEnv("VITE_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const functionUrl = `${supabaseUrl}/functions/v1/extract-gooding`;

  const invoke = async (body: Record<string, unknown>): Promise<any> => {
    const resp = await fetch(functionUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    try {
      return { ok: resp.ok, data: JSON.parse(text) };
    } catch {
      return { ok: false, data: { error: text.slice(0, 200) } };
    }
  };

  if (singleOnly) {
    // Single URL (Ferrari) – re-extract and save
    const body: Record<string, unknown> = {
      url: FERRARI_URL,
      save_to_db: !dryRun,
    };
    console.log("Invoking extract-gooding (single):", body.url);
    if (dryRun) console.log("(dry-run: save_to_db=false)");

    const { ok, data } = await invoke(body);
    if (!ok) {
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

  // Chunked batch: call extract-gooding action "batch" with offset/limit (function discovers sitemap internally)
  if (chunkSize > 0) {
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    for (let c = 0; c < numChunks; c++) {
      const offset = startOffset + c * chunkSize;
      console.log(`[Gooding] Chunk ${c + 1}/${numChunks} offset=${offset} limit=${chunkSize}...`);
      const { ok, data } = await invoke({
        action: "batch",
        limit: chunkSize,
        offset,
        save_to_db: true,
      });
      if (!ok) {
        console.error("[Gooding] Chunk error:", data);
        totalFailed += chunkSize;
        continue;
      }
      const r = data?.results ?? {};
      totalProcessed += r.processed ?? 0;
      totalSucceeded += r.succeeded ?? 0;
      totalFailed += r.failed ?? 0;
      console.log(`  -> processed ${r.processed ?? 0} succeeded ${r.succeeded ?? 0} failed ${r.failed ?? 0}`);
      if (c < numChunks - 1) await new Promise((res) => setTimeout(res, 2000));
    }
    console.log("\n=== Batch Result ===");
    console.log("Total processed:", totalProcessed, "succeeded:", totalSucceeded, "failed:", totalFailed);
    return;
  }

  // Legacy: backfill Ferrari only
  const urls = [FERRARI_URL];
  const { ok, data } = await invoke({
    action: "backfill",
    urls,
    limit: urls.length,
  });
  console.log("Invoking extract-gooding (backfill):", urls.length, "URL(s)");
  if (!ok) {
    console.error("Error:", data);
    process.exit(1);
  }
  console.log("\n=== Backfill Result ===");
  console.log(JSON.stringify(data?.results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

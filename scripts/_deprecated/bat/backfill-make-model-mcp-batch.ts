#!/usr/bin/env node
/**
 * Process vehicles using Firecrawl MCP tools and update database.
 *
 * This script reads a prepared vehicle list and processes them in batches.
 * The actual extraction is done via MCP tools (called by AI assistant).
 * This script handles the database updates.
 *
 * Usage:
 *   # Prepare vehicle list first
 *   npm run backfill:make-model:mcp-prep -- --limit 50 --out data/json/batch.json
 *
 *   # Then process with MCP (AI assistant will call MCP tools)
 *   tsx scripts/backfill-make-model-mcp-batch.ts data/json/batch.json
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

async function updateVehicle(
  supabaseUrl: string,
  key: string,
  vehicleId: string,
  make: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      make,
      model,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 500)}` };
  }

  return { ok: true };
}

interface ExtractionResult {
  vehicleId: string;
  url: string;
  make: string | null;
  model: string | null;
  year?: number | null;
  error?: string;
}

async function main(): Promise<void> {
  loadEnv();

  const inputFile = process.argv[2];
  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error("Usage: tsx scripts/backfill-make-model-mcp-batch.ts <vehicle-list.json>");
    console.error("First prepare the list with: npm run backfill:make-model:mcp-prep");
    process.exit(1);
  }

  const vehicleData = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  const vehicles = vehicleData.vehicles || [];

  console.log(`Processing ${vehicles.length} vehicles from ${inputFile}\n`);

  // Read extraction results (will be populated by MCP tools)
  const resultsFile = inputFile.replace(".json", "-results.json");
  let results: ExtractionResult[] = [];

  if (fs.existsSync(resultsFile)) {
    results = JSON.parse(fs.readFileSync(resultsFile, "utf-8"));
    console.log(`Found ${results.length} existing extraction results\n`);
  } else {
    console.log("No extraction results found. Use MCP tools to extract make/model first.");
    console.log("\nTo extract using MCP tools:");
    console.log("1. Use firecrawl_extract with schema on the URLs");
    console.log("2. Save results to:", resultsFile);
    console.log("\nExpected format:");
    console.log(JSON.stringify({
      vehicleId: "vehicle-id",
      url: "https://example.com/vehicle",
      make: "Ford",
      model: "Mustang",
      year: 1965
    }, null, 2));
    process.exit(0);
  }

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = requireAnyEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  // Update vehicles with extracted make/model
  let updated = 0;
  let errors = 0;

  for (const result of results) {
    if (!result.make || !result.model) {
      console.log(`⚠️  Skipping ${result.vehicleId.slice(0, 8)}... (missing make/model)`);
      continue;
    }

    if (result.error) {
      console.log(`❌ Skipping ${result.vehicleId.slice(0, 8)}... (error: ${result.error})`);
      errors++;
      continue;
    }

    const updateResult = await updateVehicle(
      supabaseUrl,
      key,
      result.vehicleId,
      result.make,
      result.model
    );

    if (updateResult.ok) {
      updated++;
      console.log(`✓ Updated ${result.vehicleId.slice(0, 8)}...: ${result.make} ${result.model}`);
    } else {
      errors++;
      console.log(`✗ Failed ${result.vehicleId.slice(0, 8)}...: ${updateResult.error}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${results.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

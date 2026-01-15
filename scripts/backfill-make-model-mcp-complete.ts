#!/usr/bin/env node
/**
 * Complete workflow: Extract make/model using Firecrawl MCP and update database.
 *
 * This script processes vehicles in batches:
 * 1. Reads vehicle list
 * 2. Uses Firecrawl MCP tools to extract make/model (via AI assistant)
 * 3. Updates database automatically
 *
 * Usage:
 *   # Process a prepared batch
 *   tsx scripts/backfill-make-model-mcp-complete.ts data/json/vehicles-mcp-valid-*.json
 *
 *   # Or prepare and process in one go
 *   npm run backfill:make-model:mcp-workflow -- --limit=100
 *   # Then use MCP tools to extract, save results, and run this script
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
}

async function main(): Promise<void> {
  loadEnv();

  const inputFile = process.argv[2];
  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error("Usage: tsx scripts/backfill-make-model-mcp-complete.ts <vehicle-list.json>");
    console.error("\nFirst prepare the list:");
    console.error("  npm run backfill:make-model:mcp-workflow -- --limit=100");
    process.exit(1);
  }

  const vehicleData = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  const vehicles = vehicleData.vehicles || vehicleData.urls || [];

  console.log(`\n📋 Processing ${vehicles.length} vehicles\n`);
  console.log("This script expects extraction results from Firecrawl MCP tools.");
  console.log("\nTo extract make/model:");
  console.log("1. Use firecrawl_extract MCP tool on the URLs");
  console.log("2. Save results to a JSON file");
  console.log("3. Run this script with the results file\n");

  // Check for results file
  const resultsFile = inputFile.replace(".json", "-mcp-results.json");
  if (!fs.existsSync(resultsFile)) {
    console.log("No extraction results found.");
    console.log(`\nExpected file: ${resultsFile}`);
    console.log("\nExpected format:");
    console.log(JSON.stringify(
      {
        vehicleId: "vehicle-uuid",
        url: "https://example.com/vehicle",
        make: "Ford",
        model: "Mustang",
        year: 1965
      },
      null,
      2
    ));
    console.log("\n💡 Use Firecrawl MCP tools (firecrawl_extract) to extract make/model");
    console.log("   Then save the results to the expected file format.");
    process.exit(0);
  }

  const results: ExtractionResult[] = JSON.parse(fs.readFileSync(resultsFile, "utf-8"));

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = requireAnyEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  // Update vehicles
  let updated = 0;
  let errors = 0;

  for (const result of results) {
    if (!result.make || !result.model) {
      console.log(`⚠️  Skipping ${result.vehicleId?.slice(0, 8) || "unknown"}... (missing make/model)`);
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

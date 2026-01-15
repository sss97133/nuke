#!/usr/bin/env node
/**
 * Invoke the Supabase Edge Function to backfill make/model from Firecrawl.
 *
 * Usage:
 *   tsx scripts/invoke-backfill-make-model-firecrawl.ts --dry-run
 *   tsx scripts/invoke-backfill-make-model-firecrawl.ts --limit 100
 *   tsx scripts/invoke-backfill-make-model-firecrawl.ts --limit 100 --batch-size 5
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type CliOptions = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  includeMerged: boolean;
  verbose: boolean;
};

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

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    limit: 0,
    batchSize: 10,
    includeMerged: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") opts.limit = parseInt(argv[++i] || "0", 10);
    else if (a === "--batch-size") opts.batchSize = parseInt(argv[++i] || "10", 10);
    else if (a === "--include-merged") opts.includeMerged = true;
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Invoke Backfill Make/Model from Firecrawl Edge Function

Usage:
  tsx scripts/invoke-backfill-make-model-firecrawl.ts [options]

Options:
  --dry-run          Preview what would be processed (no changes)
  --limit <n>        Maximum number of vehicles to process (default: all)
  --batch-size <n>   Number of vehicles to process in parallel (default: 10)
  --include-merged   Include vehicles with status='merged' (default: false)
  --verbose          Show detailed output
`);
      process.exit(0);
    }
  }

  return opts;
}

function requireAnyEnv(names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  throw new Error(`Missing required env var. Provide one of: ${names.join(", ")}`);
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const anonKey = requireAnyEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);

  const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/backfill-make-model-firecrawl`;

  // Build query parameters
  const params = new URLSearchParams();
  if (opts.dryRun) params.append("dry-run", "true");
  if (opts.limit > 0) params.append("limit", String(opts.limit));
  if (opts.batchSize > 0) params.append("batch-size", String(opts.batchSize));
  if (opts.includeMerged) params.append("include-merged", "true");

  const url = `${functionUrl}?${params.toString()}`;

  if (opts.verbose) {
    console.log(`Invoking Edge Function: ${url}`);
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("❌ Edge Function error:", data);
      process.exit(1);
    }

    // Pretty print results
    console.log("\n=== Backfill Results ===");
    console.log(`Message: ${data.message}`);
    if (data.total_vehicles !== undefined) {
      console.log(`Total vehicles missing make: ${data.total_vehicles}`);
    }
    if (data.vehicles_with_urls !== undefined) {
      console.log(`Vehicles with scrapeable URLs: ${data.vehicles_with_urls}`);
    }
    if (data.processed !== undefined) {
      console.log(`Processed: ${data.processed}`);
    }
    if (data.extracted !== undefined) {
      console.log(`Extracted make/model: ${data.extracted}`);
    }
    if (data.updated !== undefined) {
      console.log(`Updated in DB: ${data.updated}`);
    }
    if (data.error_count !== undefined && data.error_count > 0) {
      console.log(`Errors: ${data.error_count}`);
      if (opts.verbose && data.errors) {
        data.errors.forEach((err: string) => console.log(`  - ${err}`));
      }
    }

    if (opts.dryRun && data.sample_urls) {
      console.log("\nSample URLs that would be scraped:");
      data.sample_urls.forEach((item: any) => {
        console.log(`  ${item.id.slice(0, 8)}...: ${item.url?.substring(0, 80)}`);
      });
    }

    console.log();
  } catch (err: any) {
    console.error("❌ Failed to invoke Edge Function:", err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

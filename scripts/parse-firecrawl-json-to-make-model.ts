#!/usr/bin/env node
/**
 * Parse downloaded Firecrawl JSON files and extract make/model.
 *
 * This script:
 * 1. Reads Firecrawl JSON files (downloaded from logs)
 * 2. Extracts make/model from markdown/HTML content
 * 3. Creates results file for database update
 *
 * Usage:
 *   # Process a directory of Firecrawl JSON files
 *   tsx scripts/parse-firecrawl-json-to-make-model.ts --dir ./firecrawl-downloads
 *
 *   # Process a single JSON file
 *   tsx scripts/parse-firecrawl-json-to-make-model.ts --file ./firecrawl-downloads/result-1.json
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

interface FirecrawlResult {
  url?: string;
  data?: {
    markdown?: string;
    html?: string;
    extract?: {
      make?: string;
      model?: string;
      year?: number;
    };
  };
  metadata?: {
    sourceURL?: string;
  };
}

function extractMakeModelFromText(text: string): { make: string | null; model: string | null } {
  if (!text) return { make: null, model: null };

  // Try to find Year, Make, Model pattern
  let match = text.match(/(\d{4})\s+([A-Za-z][A-Za-z\s&-]+?)\s+([A-Za-z0-9][A-Za-z0-9\s\-\/]+)/);
  if (match) {
    const make = match[2].trim();
    const model = match[3].trim();
    if (make.length > 1 && model.length > 1) {
      return { make: cleanMakeName(make), model: cleanModelName(model) };
    }
  }

  // Try Make, Model pattern without year
  match = text.match(/([A-Za-z][A-Za-z\s&-]+?)\s+([A-Za-z0-9][A-Za-z0-9\s\-\/]+)/);
  if (match) {
    const make = match[1].trim();
    const model = match[2].trim();
    if (make.length > 1 && model.length > 1 && !/^\d+$/.test(make) && !/^\d+$/.test(model)) {
      return { make: cleanMakeName(make), model: cleanModelName(model) };
    }
  }

  return { make: null, model: null };
}

function cleanMakeName(make: string | null): string | null {
  if (!make) return null;
  const m = make.trim();
  if (m.length === 0) return null;

  const lower = m.toLowerCase();
  if (lower === "mercedes-benz" || lower === "mercedes" || lower === "mercedes benz") return "Mercedes-Benz";
  if (lower === "chevy") return "Chevrolet";
  if (lower === "vw") return "Volkswagen";
  if (lower === "benz") return "Mercedes-Benz";

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length === 1) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function cleanModelName(model: string | null): string | null {
  if (!model) return null;
  const m = model.trim();
  if (m.length === 0) return null;

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length <= 3 && word.match(/^[A-Z]+$/)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function parseFirecrawlJson(filePath: string): {
  url: string | null;
  make: string | null;
  model: string | null;
  year?: number | null;
} {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data: FirecrawlResult = JSON.parse(content);

    const url = data.url || data.metadata?.sourceURL || null;

    // Try structured extraction first
    if (data.data?.extract?.make && data.data?.extract?.model) {
      return {
        url,
        make: cleanMakeName(data.data.extract.make),
        model: cleanModelName(data.data.extract.model),
        year: data.data.extract.year || null,
      };
    }

    // Fallback: Parse from markdown/HTML
    const markdown = data.data?.markdown || "";
    const html = data.data?.html || "";
    const combined = `${markdown}\n${html}`;

    const extracted = extractMakeModelFromText(combined);
    return {
      url,
      make: extracted.make,
      model: extracted.model,
      year: null,
    };
  } catch (err: any) {
    console.error(`Error parsing ${filePath}: ${err.message}`);
    return { url: null, make: null, model: null };
  }
}

async function main(): Promise<void> {
  loadEnv();

  const dirArg = process.argv.find((a) => a.startsWith("--dir"))?.split("=")[1];
  const fileArg = process.argv.find((a) => a.startsWith("--file"))?.split("=")[1];

  if (!dirArg && !fileArg) {
    console.error("Usage:");
    console.error("  tsx scripts/parse-firecrawl-json-to-make-model.ts --dir <directory>");
    console.error("  tsx scripts/parse-firecrawl-json-to-make-model.ts --file <json-file>");
    process.exit(1);
  }

  const files: string[] = [];
  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.error(`File not found: ${fileArg}`);
      process.exit(1);
    }
    files.push(fileArg);
  } else if (dirArg) {
    if (!fs.existsSync(dirArg)) {
      console.error(`Directory not found: ${dirArg}`);
      process.exit(1);
    }
    const dirFiles = fs.readdirSync(dirArg).filter((f) => f.endsWith(".json"));
    files.push(...dirFiles.map((f) => path.join(dirArg, f)));
  }

  console.log(`Processing ${files.length} Firecrawl JSON files...\n`);

  // Read vehicle URL mapping
  const vehicleListFile = "data/json/firecrawl-logs-search-1768487015765.json";
  let vehicleUrlMap: Record<string, string> = {};

  if (fs.existsSync(vehicleListFile)) {
    const vehicleList = JSON.parse(fs.readFileSync(vehicleListFile, "utf-8"));
    vehicleList.urls.forEach((item: any) => {
      vehicleUrlMap[item.url] = item.vehicle_id;
    });
  }

  const results: Array<{
    vehicleId: string | null;
    url: string | null;
    make: string | null;
    model: string | null;
    year?: number | null;
    sourceFile: string;
  }> = [];

  for (const file of files) {
    const parsed = parseFirecrawlJson(file);
    const vehicleId = parsed.url ? vehicleUrlMap[parsed.url] || null : null;

    results.push({
      vehicleId,
      url: parsed.url,
      make: parsed.make,
      model: parsed.model,
      year: parsed.year,
      sourceFile: path.basename(file),
    });

    if (parsed.make && parsed.model) {
      console.log(`✓ ${path.basename(file)}: ${parsed.make} ${parsed.model} (${parsed.url?.substring(0, 60)}...)`);
    } else {
      console.log(`✗ ${path.basename(file)}: Could not extract make/model`);
    }
  }

  // Save results
  const outputFile = `data/json/firecrawl-extraction-results-${Date.now()}.json`;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  const extracted = results.filter((r) => r.make && r.model).length;
  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${results.length}`);
  console.log(`Extracted make/model: ${extracted}`);
  console.log(`\n💾 Results saved to: ${outputFile}`);
  console.log(`\n📋 Next step:`);
  console.log(`   npm run backfill:make-model:mcp-update -- ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

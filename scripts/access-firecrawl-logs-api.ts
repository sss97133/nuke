#!/usr/bin/env node
/**
 * Access Firecrawl logs via API to get previously scraped data.
 *
 * This script queries the Firecrawl API for logs/scraped data and extracts
 * make/model from the cached results.
 *
 * Usage:
 *   tsx scripts/access-firecrawl-logs-api.ts --url <vehicle-url>
 *   tsx scripts/access-firecrawl-logs-api.ts --batch data/json/vehicles-for-mcp-batch-1.json
 *
 * Env:
 *   FIRECRAWL_API_KEY (required)
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

function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (v) return v;
  throw new Error(`Missing required env var: ${name}`);
}

/**
 * Query Firecrawl API for logs/scraped data
 * Based on Firecrawl API documentation
 */
/**
 * Query Firecrawl API for logs/scraped data
 * 
 * Based on Firecrawl API v1/v2 documentation:
 * - v1: https://api.firecrawl.dev/v1/scrape (POST only)
 * - v2: https://api.firecrawl.dev/v2/scrape (POST only)
 * 
 * Note: Firecrawl may not have a direct GET endpoint for logs.
 * The logs page at https://www.firecrawl.dev/app/logs is a dashboard UI.
 * 
 * For accessing previously scraped data, we may need to:
 * 1. Use the scrape endpoint with cache (if supported)
 * 2. Access via dashboard and download JSON manually
 * 3. Check if there's a webhook/storage integration
 */
async function getFirecrawlLogs(
  firecrawlApiKey: string,
  url?: string,
  limit: number = 100
): Promise<any[]> {
  // Firecrawl API doesn't appear to have a direct GET logs endpoint
  // The logs are available via the dashboard UI
  // However, we can try to re-scrape with cache if the URL was previously scraped
  
  if (!url) {
    throw new Error("URL is required. Firecrawl logs API may not support listing all logs.");
  }

  // Try to scrape with potential caching (if Firecrawl caches results)
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["extract", "markdown", "html"],
        extract: {
          schema: {
            type: "object",
            properties: {
              make: { type: "string" },
              model: { type: "string" },
              year: { type: "number" },
            },
            required: ["make", "model"],
          },
        },
        onlyMainContent: false,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.data) {
        return [data.data]; // Return as array for consistency
      }
    }

    // If scrape fails (e.g., no credits), return empty
    return [];
  } catch (err: any) {
    throw new Error(`Failed to access Firecrawl data: ${err.message}`);
  }
}

/**
 * Extract make/model from Firecrawl log entry
 */
function extractMakeModelFromLogEntry(entry: any): { make: string | null; model: string | null } {
  // Try structured extraction first
  if (entry.data?.extract?.make && entry.data?.extract?.model) {
    return {
      make: cleanMakeName(entry.data.extract.make),
      model: cleanModelName(entry.data.extract.model),
    };
  }

  // Fallback: Parse from markdown/HTML
  const markdown = entry.data?.markdown || entry.markdown || "";
  const html = entry.data?.html || entry.html || "";
  const combined = `${markdown}\n${html}`;

  // Try to find Year, Make, Model pattern
  let match = combined.match(/(\d{4})\s+([A-Za-z][A-Za-z\s&-]+?)\s+([A-Za-z0-9][A-Za-z0-9\s\-\/]+)/);
  if (match) {
    const make = match[2].trim();
    const model = match[3].trim();
    if (make.length > 1 && model.length > 1) {
      return { make: cleanMakeName(make), model: cleanModelName(model) };
    }
  }

  // Try Make, Model pattern without year
  match = combined.match(/([A-Za-z][A-Za-z\s&-]+?)\s+([A-Za-z0-9][A-Za-z0-9\s\-\/]+)/);
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

async function main(): Promise<void> {
  loadEnv();

  const urlArg = process.argv.find((a) => a.startsWith("--url"))?.split("=")[1];
  const batchArg = process.argv.find((a) => a.startsWith("--batch"))?.split("=")[1];

  const firecrawlApiKey = requireEnv("FIRECRAWL_API_KEY");

  if (urlArg) {
    // Single URL
    console.log(`Fetching Firecrawl logs for: ${urlArg}`);
    const logs = await getFirecrawlLogs(firecrawlApiKey, urlArg);
    console.log(`Found ${logs.length} log entries\n`);

    if (logs.length > 0) {
      const extracted = extractMakeModelFromLogEntry(logs[0]);
      console.log(`Extracted:`);
      console.log(`  Make: ${extracted.make || "N/A"}`);
      console.log(`  Model: ${extracted.model || "N/A"}`);
    }
  } else if (batchArg) {
    // Batch processing
    if (!fs.existsSync(batchArg)) {
      console.error(`File not found: ${batchArg}`);
      process.exit(1);
    }

    const vehicleData = JSON.parse(fs.readFileSync(batchArg, "utf-8"));
    const vehicles = vehicleData.vehicles || [];

    console.log(`Processing ${vehicles.length} vehicles from Firecrawl logs...\n`);

    const results: Array<{
      vehicleId: string;
      url: string;
      make: string | null;
      model: string | null;
      found: boolean;
    }> = [];

    for (const vehicle of vehicles) {
      const url = vehicle.url;
      console.log(`Checking: ${url.substring(0, 60)}...`);

      try {
        const logs = await getFirecrawlLogs(firecrawlApiKey, url, 1);
        if (logs.length > 0) {
          const extracted = extractMakeModelFromLogEntry(logs[0]);
          results.push({
            vehicleId: vehicle.id,
            url,
            make: extracted.make,
            model: extracted.model,
            found: true,
          });
          if (extracted.make && extracted.model) {
            console.log(`  ✓ Found: ${extracted.make} ${extracted.model}`);
          } else {
            console.log(`  ⚠️  Found but couldn't extract make/model`);
          }
        } else {
          results.push({
            vehicleId: vehicle.id,
            url,
            make: null,
            model: null,
            found: false,
          });
          console.log(`  ✗ No logs found`);
        }
      } catch (err: any) {
        console.log(`  ✗ Error: ${err.message}`);
        results.push({
          vehicleId: vehicle.id,
          url,
          make: null,
          model: null,
          found: false,
        });
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Save results
    const outputFile = batchArg.replace(".json", "-firecrawl-logs-results.json");
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

    const extracted = results.filter((r) => r.make && r.model).length;
    console.log(`\n=== Summary ===`);
    console.log(`Processed: ${results.length}`);
    console.log(`Found in logs: ${results.filter((r) => r.found).length}`);
    console.log(`Extracted make/model: ${extracted}`);
    console.log(`\n💾 Results saved to: ${outputFile}`);
  } else {
    console.error("Usage:");
    console.error("  tsx scripts/access-firecrawl-logs-api.ts --url <url>");
    console.error("  tsx scripts/access-firecrawl-logs-api.ts --batch <vehicle-list.json>");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

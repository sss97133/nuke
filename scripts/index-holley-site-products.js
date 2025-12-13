/**
 * Holley site indexer (runner)
 *
 * Pipeline:
 * 1) Discover URLs via edge function `holley-discover-urls`
 *    - prefers Firecrawl map, falls back to sitemap parsing
 * 2) Filter URLs to likely product pages
 * 3) Scrape + upsert via edge function `scrape-holley-product`
 *
 * Required env:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY)
 *
 * Usage examples:
 *   node scripts/index-holley-site-products.js --limit 200 --delay-ms 1200
 *   node scripts/index-holley-site-products.js --brand "Scott Drake" --include "scott" --limit 500
 *
 * Notes:
 * - This is intentionally resumable; it writes progress to tmp/holley-index-progress.json
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function parseArgs(argv) {
  const out = {
    baseUrl: "https://www.holley.com/",
    method: "map",
    limit: 1000,
    delayMs: 1200,
    include: null, // regex string
    exclude: null, // regex string
    brand: null,
    resume: true,
    progressFile: "tmp/holley-index-progress.json",
    onlyProductUrls: true,
    expandFromSeeds: true,
    seedPages: ["https://www.holley.com/products/restoration/", "https://www.holley.com/brands/"],
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.baseUrl = argv[++i] || out.baseUrl;
    else if (a === "--method") out.method = argv[++i] || out.method;
    else if (a === "--limit") out.limit = Number(argv[++i] || String(out.limit));
    else if (a === "--delay-ms") out.delayMs = Number(argv[++i] || String(out.delayMs));
    else if (a === "--include") out.include = argv[++i] || null;
    else if (a === "--exclude") out.exclude = argv[++i] || null;
    else if (a === "--brand") out.brand = argv[++i] || null;
    else if (a === "--no-resume") out.resume = false;
    else if (a === "--progress-file") out.progressFile = argv[++i] || out.progressFile;
    else if (a === "--all-urls") out.onlyProductUrls = false;
    else if (a === "--no-seed-expand") out.expandFromSeeds = false;
  }

  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadProgress(progressFile) {
  try {
    if (!fs.existsSync(progressFile)) return null;
    const raw = fs.readFileSync(progressFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveProgress(progressFile, data) {
  ensureDir(progressFile);
  fs.writeFileSync(progressFile, JSON.stringify(data, null, 2));
}

function looksLikeProductUrl(u) {
  const lower = u.toLowerCase();
  // Holley patterns we care about:
  // - /products/
  // - /brands/... (brand landing + potentially product lists)
  // - /search/ and /category/ might be listing pages
  return (
    lower.includes("/products/") ||
    lower.includes("/product/") ||
    lower.includes("/brands/") ||
    lower.includes("/categories/") ||
    lower.includes("/category/") ||
    lower.includes("scott") ||
    lower.includes("drake")
  );
}

async function discoverUrls(args) {
  const includePatterns = [];
  const excludePatterns = [];
  if (args.include) includePatterns.push(args.include);
  if (args.exclude) excludePatterns.push(args.exclude);

  // First discovery: from base_url
  const { data, error } = await supabase.functions.invoke("holley-discover-urls", {
    body: {
      base_url: args.baseUrl,
      method: args.method,
      limit: args.limit * 5,
      include_patterns: includePatterns.length ? includePatterns : undefined,
      exclude_patterns: excludePatterns.length ? excludePatterns : undefined,
    },
  });

  if (error) throw new Error(error.message || String(error));
  if (data?.success === false) throw new Error(data.error || "Unknown error");
  let urls = Array.isArray(data?.urls) ? data.urls : [];

  // If discovery returned too few URLs (common with Holley), expand from known seed pages via Firecrawl.
  if (args.expandFromSeeds && urls.length < Math.min(25, args.limit)) {
    const { data: seedData, error: seedError } = await supabase.functions.invoke("holley-discover-urls", {
      body: {
        base_url: args.baseUrl,
        method: "sitemap",
        seed_urls: args.seedPages,
        limit: args.limit * 5,
        include_patterns: includePatterns.length ? includePatterns : undefined,
        exclude_patterns: excludePatterns.length ? excludePatterns : undefined,
        max_sitemaps: 5,
        time_budget_ms: 15000,
      },
    });
    if (!seedError && seedData?.success !== false && Array.isArray(seedData?.urls)) {
      urls = uniq([...urls, ...seedData.urls]);
    }
  }

  return urls;
}

async function scrapeOne(url, brandHint) {
  const { data, error } = await supabase.functions.invoke("scrape-holley-product", {
    body: {
      url,
      brand_hint: brandHint || undefined,
    },
  });

  if (error) return { ok: false, error: error.message || String(error), data: null };
  if (data?.success === false) return { ok: false, error: data.error || "Unknown error", data };
  return { ok: true, error: null, data };
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.progressFile);

  console.log("Holley site indexer");
  console.log(`Base: ${args.baseUrl}`);
  console.log(`Method: ${args.method}`);
  console.log(`Limit: ${args.limit}`);
  console.log(`Delay (ms): ${args.delayMs}`);
  if (args.brand) console.log(`Brand hint: ${args.brand}`);
  console.log(`Resume: ${args.resume ? "yes" : "no"}`);
  console.log(`Progress file: ${args.progressFile}`);
  console.log("");

  let progress = args.resume ? loadProgress(args.progressFile) : null;
  if (!progress) {
    progress = { started_at: new Date().toISOString(), done: {}, stats: { ok: 0, failed: 0, stored: 0, updated: 0 } };
  }

  let urls = await discoverUrls(args);
  urls = uniq(urls);

  if (args.onlyProductUrls) {
    urls = urls.filter(looksLikeProductUrl);
  }

  urls = urls.slice(0, args.limit);
  console.log(`URLs to process: ${urls.length}`);
  console.log("");

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (progress.done[url]) continue;

    process.stdout.write(`[${i + 1}/${urls.length}] ${url}\n`);
    const res = await scrapeOne(url, args.brand);

    if (res.ok) {
      progress.stats.ok++;
      progress.stats.stored += Number(res.data?.stored || 0);
      progress.stats.updated += Number(res.data?.updated || 0);
      process.stdout.write(
        `  ok: extracted=${res.data?.extracted_products || 0} stored=${res.data?.stored || 0} updated=${res.data?.updated || 0}\n`,
      );
    } else {
      progress.stats.failed++;
      process.stdout.write(`  error: ${res.error}\n`);
    }

    progress.done[url] = { ok: res.ok, at: new Date().toISOString() };
    saveProgress(args.progressFile, progress);

    if (i < urls.length - 1 && args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log("");
  console.log("Done");
  console.log(JSON.stringify(progress.stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});




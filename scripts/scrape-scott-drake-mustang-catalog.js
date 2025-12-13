/**
 * Scott Drake Mustang catalog indexer (runner)
 *
 * This script discovers URLs (from sitemap or a newline-delimited file) and invokes
 * the Supabase Edge Function `scrape-scott-drake-catalog` to upsert products into
 * `catalog_parts`.
 *
 * Requirements:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY)
 *
 * Example:
 *   node scripts/scrape-scott-drake-mustang-catalog.js --base https://example.com --sitemap --limit 200
 *
 * Or:
 *   node scripts/scrape-scott-drake-mustang-catalog.js --url-file data/scott-drake-urls.txt
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
  const args = {
    base: null,
    sitemap: false,
    urlFile: null,
    limit: 500,
    delayMs: 1500,
    category: "mustang",
    subcategory: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sitemap") args.sitemap = true;
    else if (a === "--base") args.base = argv[++i] || null;
    else if (a === "--url-file") args.urlFile = argv[++i] || null;
    else if (a === "--limit") args.limit = Number(argv[++i] || "500");
    else if (a === "--delay-ms") args.delayMs = Number(argv[++i] || "1500");
    else if (a === "--category") args.category = argv[++i] || "mustang";
    else if (a === "--subcategory") args.subcategory = argv[++i] || null;
  }

  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function extractLocsFromSitemapXml(xml) {
  const locs = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1]);
  }
  return locs;
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/xml,application/xml,text/html,*/*",
    },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Fetch failed: ${resp.status} ${resp.statusText} ${txt}`.trim());
  }
  return await resp.text();
}

async function discoverUrlsFromSitemap(baseUrl, maxUrls) {
  const candidates = [
    new URL("/sitemap.xml", baseUrl).toString(),
    new URL("/sitemap_index.xml", baseUrl).toString(),
    new URL("/sitemap-index.xml", baseUrl).toString(),
  ];

  const visited = new Set();
  const sitemapsToVisit = [...candidates];
  const foundUrls = [];

  while (sitemapsToVisit.length > 0 && foundUrls.length < maxUrls) {
    const sitemapUrl = sitemapsToVisit.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch (e) {
      continue;
    }

    const locs = extractLocsFromSitemapXml(xml);

    // Heuristic: sitemap indexes usually point to other XML files.
    const nestedSitemaps = locs.filter((u) => u.endsWith(".xml") || u.includes("sitemap"));
    const pageUrls = locs.filter((u) => !u.endsWith(".xml"));

    for (const u of nestedSitemaps) {
      if (!visited.has(u) && sitemapsToVisit.length < 200) {
        sitemapsToVisit.push(u);
      }
    }

    for (const u of pageUrls) {
      foundUrls.push(u);
      if (foundUrls.length >= maxUrls) break;
    }
  }

  return uniq(foundUrls).slice(0, maxUrls);
}

function readUrlsFromFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const txt = fs.readFileSync(abs, "utf8");
  return uniq(
    txt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

function deriveCategory(urlStr, defaultCategory) {
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split("/").filter(Boolean);
    // Shopify-ish patterns:
    // /collections/<collection>
    // /products/<handle>
    const collectionsIdx = parts.indexOf("collections");
    if (collectionsIdx >= 0 && parts[collectionsIdx + 1]) return parts[collectionsIdx + 1];
    const categoriesIdx = parts.indexOf("categories");
    if (categoriesIdx >= 0 && parts[categoriesIdx + 1]) return parts[categoriesIdx + 1];
    return defaultCategory;
  } catch {
    return defaultCategory;
  }
}

async function invokeScrape(url, categoryName, subcategoryName) {
  const { data, error } = await supabase.functions.invoke("scrape-scott-drake-catalog", {
    body: {
      url,
      category_name: categoryName,
      subcategory_name: subcategoryName || undefined,
    },
  });

  if (error) {
    return { ok: false, error: error.message || String(error), data: null };
  }
  if (data?.success === false) {
    return { ok: false, error: data.error || "Unknown error", data };
  }
  return { ok: true, error: null, data };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.sitemap && !args.urlFile) {
    console.error("Provide --sitemap with --base, or provide --url-file");
    process.exit(1);
  }

  if (args.sitemap && !args.base) {
    console.error("--base is required when using --sitemap");
    process.exit(1);
  }

  console.log("Scott Drake Mustang catalog indexing");
  console.log(`Edge function: scrape-scott-drake-catalog`);
  console.log(`Limit: ${args.limit}`);
  console.log(`Delay (ms): ${args.delayMs}`);
  console.log("");

  let urls = [];
  if (args.urlFile) {
    urls = readUrlsFromFile(args.urlFile);
    console.log(`Loaded ${urls.length} URLs from file: ${args.urlFile}`);
  } else {
    urls = await discoverUrlsFromSitemap(args.base, args.limit * 5);
    console.log(`Discovered ${urls.length} URLs from sitemap`);
  }

  // Heuristic filter: prioritize likely product/category pages.
  const prioritized = [];
  const other = [];
  for (const u of urls) {
    const lower = u.toLowerCase();
    if (
      lower.includes("/products/") ||
      lower.includes("/product/") ||
      lower.includes("/collections/") ||
      lower.includes("/category/") ||
      lower.includes("mustang")
    ) {
      prioritized.push(u);
    } else {
      other.push(u);
    }
  }

  urls = uniq([...prioritized, ...other]).slice(0, args.limit);
  console.log(`Using ${urls.length} URLs after filtering`);
  console.log("");

  let ok = 0;
  let failed = 0;
  let stored = 0;
  let updated = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const categoryName = deriveCategory(url, args.category);
    const subcategoryName = args.subcategory;

    process.stdout.write(`[${i + 1}/${urls.length}] ${url}\n`);
    const result = await invokeScrape(url, categoryName, subcategoryName);
    if (result.ok) {
      ok++;
      stored += Number(result.data?.stored || 0);
      updated += Number(result.data?.updated || 0);
      process.stdout.write(
        `  ok: products_found=${result.data?.products_found || 0} stored=${result.data?.stored || 0} updated=${result.data?.updated || 0}\n`,
      );
    } else {
      failed++;
      process.stdout.write(`  error: ${result.error}\n`);
    }

    if (i < urls.length - 1 && args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log("");
  console.log("Done");
  console.log(`Success: ${ok}`);
  console.log(`Failed: ${failed}`);
  console.log(`Stored: ${stored}`);
  console.log(`Updated: ${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



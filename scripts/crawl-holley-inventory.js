/**
 * Deep Holley inventory crawler (runner)
 *
 * Strategy:
 * - Maintain a persistent FIFO queue of URLs (tmp/holley-crawl-state.json)
 * - For each URL:
 *   - call edge function `scrape-holley-product` via HTTP fetch (so we can see non-2xx bodies)
 *   - ingest returned discovered_links into the queue (filtered)
 * - Run until max_processed or max_queue or max_depth (depth is inferred by path length heuristics)
 *
 * Required env:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/crawl-holley-inventory.js --max-processed 2000 --delay-ms 1200
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qkgaybvrernstplzjaam.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    startUrls: [
      "https://www.holley.com/products/",
      "https://www.holley.com/brands/",
      "https://www.holley.com/products/restoration/",
      "https://www.holley.com/products/tools/",
    ],
    stateFile: "tmp/holley-crawl-state.json",
    delayMs: 1200,
    maxProcessed: 2000,
    maxQueue: 20000,
    allowPatterns: [
      "^https://www\\.holley\\.com/products/",
      "^https://www\\.holley\\.com/brands/",
    ],
    denyPatterns: [
      "/account/",
      "/cart/",
      "/checkout",
      "/dealer/",
      "/login",
      "/logout",
    ],
    brandHint: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--delay-ms") out.delayMs = Number(argv[++i] || String(out.delayMs));
    else if (a === "--max-processed") out.maxProcessed = Number(argv[++i] || String(out.maxProcessed));
    else if (a === "--max-queue") out.maxQueue = Number(argv[++i] || String(out.maxQueue));
    else if (a === "--state-file") out.stateFile = argv[++i] || out.stateFile;
    else if (a === "--brand") out.brandHint = argv[++i] || null;
  }

  return out;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function compile(arr) {
  return (arr || []).map((s) => new RegExp(s, "i"));
}

function allowed(url, allow, deny) {
  if (deny.some((r) => r.test(url))) return false;
  return allow.some((r) => r.test(url));
}

function loadState(stateFile, defaults) {
  try {
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function saveState(stateFile, state) {
  ensureDir(stateFile);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function callEdge(url, brandHint) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/scrape-holley-product`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      url,
      brand_hint: brandHint || undefined,
    }),
  });

  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    return { ok: false, status: resp.status, body: json || { raw: text?.slice(0, 800) } };
  }
  return { ok: true, status: resp.status, body: json };
}

async function main() {
  const args = parseArgs(process.argv);
  const allow = compile(args.allowPatterns);
  const deny = compile(args.denyPatterns);

  ensureDir(args.stateFile);

  let state = loadState(args.stateFile);
  if (!state) {
    state = {
      started_at: new Date().toISOString(),
      queue: uniq(args.startUrls),
      visited: {},
      stats: { processed: 0, ok: 0, failed: 0, stored: 0, updated: 0, discovered_links: 0 },
    };
  }

  console.log("Holley deep crawler");
  console.log(`State file: ${args.stateFile}`);
  console.log(`Queue size: ${state.queue.length}`);
  console.log(`Processed: ${state.stats.processed}`);
  console.log(`Max processed this run: ${args.maxProcessed}`);
  console.log("");

  while (state.stats.processed < args.maxProcessed && state.queue.length > 0) {
    const url = state.queue.shift();
    if (!url) break;
    if (state.visited[url]) continue;
    if (!allowed(url, allow, deny)) {
      state.visited[url] = { ok: true, skipped: true, at: new Date().toISOString() };
      continue;
    }

    const idx = state.stats.processed + 1;
    process.stdout.write(`[${idx}/${args.maxProcessed}] ${url}\n`);

    const res = await callEdge(url, args.brandHint);
    state.stats.processed++;

    if (res.ok) {
      state.stats.ok++;
      const stored = Number(res.body?.stored || 0);
      const updated = Number(res.body?.updated || 0);
      const discoveredCount = Number(res.body?.discovered_links_count || 0);
      state.stats.stored += stored;
      state.stats.updated += updated;
      state.stats.discovered_links += discoveredCount;

      const links = Array.isArray(res.body?.discovered_links) ? res.body.discovered_links : [];
      const filtered = links.filter((u) => typeof u === "string" && allowed(u, allow, deny));
      for (const u of filtered) {
        if (Object.prototype.hasOwnProperty.call(state.visited, u)) continue;
        state.queue.push(u);
        if (state.queue.length >= args.maxQueue) break;
      }
      state.queue = uniq(state.queue).slice(0, args.maxQueue);

      process.stdout.write(
        `  ok: extracted=${res.body?.extracted_products || 0} stored=${stored} updated=${updated} links=${filtered.length} queue=${state.queue.length}\n`,
      );
      state.visited[url] = { ok: true, at: new Date().toISOString() };
    } else {
      state.stats.failed++;
      process.stdout.write(`  error: status=${res.status} body=${JSON.stringify(res.body).slice(0, 400)}\n`);
      state.visited[url] = { ok: false, status: res.status, at: new Date().toISOString() };
    }

    saveState(args.stateFile, state);
    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log("");
  console.log("Done");
  console.log(JSON.stringify({ ...state.stats, queue_remaining: state.queue.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});








/**
 * bat-lots-local.ts — Fetch + parse full BaT lot pages to local files. No DB writes.
 *
 * For each lot URL: keep the raw page (gzip) under <out>/html/, parse it with the
 * production parsers (_shared/batParser.ts, _shared/batDomMap.ts), and append
 * JSONL rows to <out>/lots.jsonl, images.jsonl, comments.jsonl.
 *
 * Prices, end dates and sold status stay authoritative from the listings-filter
 * catalog (scripts/data/bat-catalog, via bat-keep-fresh.mjs --by-year). The page
 * parsers' end-date read is unreliable: measured 2026-09-24, extractBatDomMap
 * returned "2634-09-23" for a lot that sold 2026-09-23.
 *
 * Comments come from the page's embedded "comments":[...] JSON, read with a
 * bracket-matching reader. The regex in bat-bid-backfill.mjs stops at the first
 * nested "]" (each comment now carries channels/likers arrays), so JSON.parse
 * fails and it silently returns nothing on current pages (0 of 34 on the test lot).
 *
 * Usage:
 *   deno run -A scripts/bat-lots-local.ts --urls urls.txt --out scripts/data/bat-lots [--workers 2] [--delay-ms 1500] [--limit N]
 * Re-runs skip URLs in <out>/done.txt; pages already on disk are re-parsed, not refetched.
 */

import { parseBaTHTML, extractEssentials, BAT_PARSER_VERSION } from "../supabase/functions/_shared/batParser.ts";
import { extractBatDomMap } from "../supabase/functions/_shared/batDomMap.ts";

const args = Deno.args;
const arg = (name: string, def?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const URLS_FILE = arg("--urls");
const OUT = arg("--out", "scripts/data/bat-lots")!;
const WORKERS = parseInt(arg("--workers", "2")!);
const DELAY_MS = parseInt(arg("--delay-ms", "1500")!);
const LIMIT = parseInt(arg("--limit", "0")!);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
if (!URLS_FILE) {
  console.error("--urls <file> is required");
  Deno.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slugOf = (url: string) => url.replace(/\/+$/, "").split("/listing/")[1]?.split(/[/?#]/)[0] ?? "";

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

// Returns the array that follows `"comments":` by matching brackets, respecting strings.
function readCommentsJson(html: string): any[] | null {
  const key = '"comments":[';
  let at = html.indexOf(key);
  while (at >= 0) {
    const start = at + key.length - 1;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) {
        try {
          const arr = JSON.parse(html.slice(start, i + 1));
          if (Array.isArray(arr) && arr.length && typeof arr[0] === "object") return arr;
        } catch { /* try the next occurrence */ }
        break;
      }
    }
    at = html.indexOf(key, at + key.length);
  }
  return null;
}

const stripTags = (s: string) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function fetchPage(url: string): Promise<{ status: number; html: string | null }> {
  const waits = [10000, 30000, 90000];
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
      if (resp.status === 404 || resp.status === 410) return { status: resp.status, html: null };
      if (resp.status === 429 || resp.status >= 500) throw new Error(`HTTP ${resp.status}`);
      return { status: resp.status, html: await resp.text() };
    } catch (e) {
      if (attempt >= waits.length) return { status: -1, html: null };
      console.log(`  ${slugOf(url)}: ${(e as Error).message}, retry in ${waits[attempt] / 1000}s`);
      await sleep(waits[attempt]);
    }
  }
}

// The DOM map logs a line per gallery; keep the run log readable.
function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[batDomMap]")) log(...a); };
  try { return fn(); } finally { console.log = log; }
}

// BaT's own taxonomy links (Make / Model / Era / Origin / Category). The Model page is
// generation-scoped ("Ford Mustang 1967-1968") — BaT's canonical cohort for a lot.
function readGroups(html: string) {
  const groups: { label: string; value: string; path: string }[] = [];
  const re = /<a class="group-link" href="https:\/\/bringatrailer\.com\/([^"]*)"><strong class="group-title-label">([^<]+)<\/strong>([^<]*)<\/a>/g;
  for (const m of html.matchAll(re)) groups.push({ label: m[2].trim(), value: stripTags(m[3]).trim(), path: m[1].replace(/\/$/, "") });
  const first = (label: string) => groups.find((g) => g.label === label && !g.path.startsWith("parts-and-automobilia")) ?? groups.find((g) => g.label === label);
  const model = first("Model");
  return {
    bat_make: first("Make")?.value ?? null, bat_model: model?.value ?? null, bat_model_path: model?.path ?? null,
    bat_era: first("Era")?.value ?? null, bat_origin: first("Origin")?.value ?? null,
    bat_categories: groups.filter((g) => g.label === "Category").map((g) => g.value),
  };
}

function parseLot(url: string, html: string) {
  const p: any = quiet(() => parseBaTHTML(html));
  const e: any = quiet(() => extractEssentials(html));
  const { extracted: d } = quiet(() => extractBatDomMap(html, url));
  const comments = readCommentsJson(html) ?? [];
  const bids = comments.filter((c) => c?.type === "bat-bid" && Number(c?.bidAmount) > 0);
  const lot = {
    url, slug: slugOf(url), parser: BAT_PARSER_VERSION,
    title: d.title, year: d.year, make: d.make, model: d.model,
    ...readGroups(html),
    listing_category: e.listing_category, lot_number: e.lot_number ?? p.lot_number,
    seller: e.seller_username, buyer: e.buyer_username,
    location: e.location ?? p.location_raw, location_city: p.location_city, location_state: p.location_state, location_zip: p.location_zip,
    party_type: p.party_type,
    vin: e.vin ?? p.chassis, vin_valid: p.vin_valid,
    mileage: e.mileage ?? p.mileage, mileage_unit: p.mileage_unit,
    engine: e.engine ?? p.engine, transmission: e.transmission ?? p.transmission, drivetrain: e.drivetrain, body_style: e.body_style,
    exterior_color: e.exterior_color ?? p.exterior_color, interior_color: e.interior_color ?? p.interior,
    reserve_status: e.reserve_status, no_reserve: p.no_reserve,
    features: p.features, description: d.description_text,
    page_views: e.view_count, page_watchers: e.watcher_count,
    page_comment_count: e.comment_count || d.comment_count,
    n_comments: comments.length, n_bids: bids.length,
    max_bid: bids.reduce((m, b) => Math.max(m, Number(b.bidAmount) || 0), 0) || null,
    n_images: d.image_urls.length,
  };
  const images = d.image_urls.map((image_url: string, i: number) => ({ url, position: i + 1, image_url }));
  const commentRows = comments.map((c: any) => {
    const author = String(c?.authorName ?? "").trim();
    const ts = typeof c?.timestamp === "number" ? new Date(c.timestamp * 1000).toISOString() : null;
    return {
      url, comment_id: c?.id ?? null, author: author.replace(/\s*\(The Seller\)\s*$/i, ""), author_id: c?.authorId ?? null,
      is_seller: /\(The Seller\)/i.test(author), type: c?.type ?? null,
      bid_amount: c?.type === "bat-bid" && c?.bidAmount ? Number(c.bidAmount) : null,
      posted_at: ts, likes: c?.likes ?? null, author_likes: c?.authorLikes ?? null,
      has_media: Boolean(c?.hasImage || c?.hasVideo || c?.images?.length || c?.videos?.length),
      text: stripTags(c?.content ?? c?.comment ?? ""),
    };
  });
  return { lot, images, commentRows };
}

const urls = (await Deno.readTextFile(URLS_FILE)).split("\n").map((s) => s.trim()).filter((s) => s.includes("/listing/"));
await Deno.mkdir(`${OUT}/html`, { recursive: true });
const donePath = `${OUT}/done.txt`;
const done = new Set((await Deno.readTextFile(donePath).catch(() => "")).split("\n").filter(Boolean));
let queue = urls.filter((u) => !done.has(u));
if (LIMIT) queue = queue.slice(0, LIMIT);
console.log(`[${new Date().toISOString()}] bat-lots-local: ${queue.length} to do (${done.size} already done), ${WORKERS} workers, ${DELAY_MS}ms delay -> ${OUT}`);

const stats = { ok: 0, fetched: 0, fromDisk: 0, gone: 0, failed: 0, badPage: 0, commentShort: 0, noImages: 0 };
const started = Date.now();
const append = (file: string, rows: object[]) =>
  rows.length ? Deno.writeTextFile(`${OUT}/${file}`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { append: true }) : Promise.resolve();

async function worker() {
  while (queue.length) {
    const url = queue.shift()!;
    const htmlPath = `${OUT}/html/${slugOf(url)}.html.gz`;
    let html: string | null = null;
    let status = 200;
    try {
      html = await gunzip(await Deno.readFile(htmlPath));
      stats.fromDisk++;
    } catch {
      const r = await fetchPage(url);
      status = r.status;
      html = r.html;
      if (html) {
        await Deno.writeFile(htmlPath, await gzip(html));
        stats.fetched++;
      }
      await sleep(DELAY_MS);
    }
    if (!html) {
      if (status === 404 || status === 410) stats.gone++; else stats.failed++;
      await append("failures.jsonl", [{ url, status, at: new Date().toISOString() }]);
      if (status === 404 || status === 410) await Deno.writeTextFile(donePath, url + "\n", { append: true });
      continue;
    }
    if (!html.includes("bat_listing_page_photo_gallery") && !html.includes("listing-essentials")) {
      stats.badPage++;
      await append("failures.jsonl", [{ url, status, reason: "not a listing page", bytes: html.length, at: new Date().toISOString() }]);
      continue;
    }
    const { lot, images, commentRows } = parseLot(url, html);
    if (lot.page_comment_count && lot.n_comments < lot.page_comment_count * 0.9) stats.commentShort++;
    if (!lot.n_images) stats.noImages++;
    await append("lots.jsonl", [{ ...lot, fetched_status: status, parsed_at: new Date().toISOString() }]);
    await append("images.jsonl", images);
    await append("comments.jsonl", commentRows);
    await Deno.writeTextFile(donePath, url + "\n", { append: true });
    stats.ok++;
    if (stats.ok % 25 === 0) {
      const mins = (Date.now() - started) / 60000;
      console.log(`[${new Date().toISOString()}] ${stats.ok} parsed (${(stats.ok / mins).toFixed(1)}/min) | ${JSON.stringify(stats)} | ${queue.length} left`);
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()));
console.log(`[${new Date().toISOString()}] done ${JSON.stringify(stats)}`);

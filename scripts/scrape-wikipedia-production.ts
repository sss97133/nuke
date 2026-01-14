#!/usr/bin/env node
/**
 * Scrape production info for make/model pairs from Wikipedia.
 *
 * What you get:
 * - For each make/model, we find the best Wikipedia page via search API
 * - Extract the Infobox "production" field (raw wikitext + cleaned text)
 * - Attempt a best-effort numeric parse (often NOT available; many pages only have year ranges)
 * - Write a JSON report (+ optional CSV) including citations (page title + URL)
 *
 * Usage examples:
 *   tsx scripts/scrape-wikipedia-production.ts --source vehicles --out data/json/wiki_production.json --limit 50
 *   tsx scripts/scrape-wikipedia-production.ts --source ecr --out data/json/wiki_production_ecr.json --limit 200
 *   tsx scripts/scrape-wikipedia-production.ts --input data/json/my_make_models.json --out data/json/wiki_production.json
 *
 * Env:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY (preferred) OR SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
 *
 * Notes:
 * - Wikipedia infobox content is not standardized; treat numeric parses as "best effort".
 * - Be respectful: keep concurrency low and use caching.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

type SourceKind = "vehicles" | "ecr" | "oem" | "canonical" | "input";

type CliOptions = {
  outPath: string;
  csvPath: string | null;
  cacheDir: string;
  cacheTtlHours: number | null;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryJitterMs: number;
  resume: boolean;
  writeEvery: number;
  limit: number | null;
  offset: number;
  source: SourceKind;
  inputPath: string | null;
  wikiLang: string;
  verbose: boolean;
};

type MakeModel = {
  make: string;
  model: string;
  // If sourced from vehicles, this is a count of rows in `vehicles` for that make/model
  db_count?: number;
  // Optional provenance
  source?: string;
};

type WikipediaSearchResult = {
  title: string;
  pageid: number;
  snippet: string;
};

type ProductionParse = {
  units: number | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string | null;
};

type OutputRow = {
  key: string;
  input: { make: string; model: string; db_count?: number };
  wikipedia: {
    lang: string;
    search_query: string;
    chosen_title: string | null;
    chosen_url: string | null;
    // First search results (helpful for debugging mismatches)
    search_candidates?: { title: string; pageid: number; score: number }[];
  };
  production: {
    infobox_production_wikitext: string | null;
    infobox_production_text: string | null;
    parsed_units: number | null;
    parsed_units_confidence: ProductionParse["confidence"];
    parsed_units_reason: string | null;
  };
  status: "ok" | "no_match" | "no_infobox" | "no_production_field" | "error";
  error: string | null;
  scraped_at: string;
};

type OutputJson = {
  source: {
    kind: SourceKind;
    input_path?: string | null;
  };
  wikipedia: {
    lang: string;
  };
  scraped_at: string;
  totals: {
    inputs: number;
    processed: number;
    ok: number;
    no_match: number;
    no_infobox: number;
    no_production_field: number;
    error: number;
  };
  rows: OutputRow[];
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    outPath: path.join(process.cwd(), "data/json/wiki_production.json"),
    csvPath: null,
    cacheDir: path.join(process.cwd(), "tmp/wikipedia/cache"),
    cacheTtlHours: 24 * 7, // 7 days
    concurrency: 1,
    delayMs: 750,
    timeoutMs: 30000,
    maxRetries: 6,
    retryBaseMs: 800,
    retryJitterMs: 250,
    resume: false,
    writeEvery: 25,
    limit: null,
    offset: 0,
    source: "vehicles",
    inputPath: null,
    wikiLang: "en",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.outPath = path.resolve(process.cwd(), argv[++i] || "");
    else if (a === "--csv") opts.csvPath = path.resolve(process.cwd(), argv[++i] || "");
    else if (a === "--cache-dir") opts.cacheDir = path.resolve(process.cwd(), argv[++i] || "");
    else if (a === "--cache-ttl-hours") opts.cacheTtlHours = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--no-cache") opts.cacheTtlHours = 0;
    else if (a === "--concurrency") opts.concurrency = Math.max(1, Number(argv[++i] || "1"));
    else if (a === "--delay-ms") opts.delayMs = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--timeout-ms") opts.timeoutMs = Math.max(1000, Number(argv[++i] || "30000"));
    else if (a === "--max-retries") opts.maxRetries = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--retry-base-ms") opts.retryBaseMs = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--retry-jitter-ms") opts.retryJitterMs = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--resume") opts.resume = true;
    else if (a === "--write-every") opts.writeEvery = Math.max(1, Number(argv[++i] || "25"));
    else if (a === "--limit") opts.limit = Math.max(0, Number(argv[++i] || "0")) || null;
    else if (a === "--offset") opts.offset = Math.max(0, Number(argv[++i] || "0"));
    else if (a === "--source") {
      const v = String(argv[++i] || "").trim();
      if (v === "vehicles" || v === "ecr" || v === "oem" || v === "canonical" || v === "input") opts.source = v;
      else throw new Error(`Invalid --source ${JSON.stringify(v)} (expected vehicles|ecr|oem|canonical|input)`);
    } else if (a === "--input") {
      opts.inputPath = path.resolve(process.cwd(), argv[++i] || "");
      opts.source = "input";
    } else if (a === "--wiki-lang") {
      opts.wikiLang = (argv[++i] || "").trim() || opts.wikiLang;
    } else if (a === "--verbose") opts.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Wikipedia production scraper

Flags:
  --source <vehicles|ecr|oem|canonical|input>  Input model list source (default: vehicles)
  --input <path>                              JSON file with [{make, model}] (implies --source input)
  --out <path>                                Output JSON (default: data/json/wiki_production.json)
  --csv <path>                                Optional CSV output
  --wiki-lang <lang>                          Wikipedia language (default: en)

  --resume                                   Merge/skip already-scraped keys in --out
  --write-every <n>                           Write partial results every N rows (default: 25)
  --offset <n>                                Skip first N input pairs (default: 0)
  --limit <n>                                 Process only N input pairs (default: unlimited)

  --cache-dir <path>                          Cache dir (default: tmp/wikipedia/cache)
  --cache-ttl-hours <n>                       Cache TTL hours (default: 168)
  --no-cache                                  Disable cache (always refetch)

  --concurrency <n>                           Concurrent Wikipedia fetches (default: 1)
  --delay-ms <n>                              Minimum delay between requests (default: 750)
  --timeout-ms <n>                            Per-request timeout ms (default: 30000)
  --max-retries <n>                           Retry count for 429/5xx/timeouts (default: 6)
  --retry-base-ms <n>                         Backoff base ms (default: 800)
  --retry-jitter-ms <n>                       Backoff jitter ms (default: 250)

  --verbose                                   More logging
`);
      process.exit(0);
    }
  }

  if (!opts.outPath.endsWith(".json")) {
    throw new Error(`--out must be a .json file (got: ${opts.outPath})`);
  }
  if (opts.csvPath && !opts.csvPath.endsWith(".csv")) {
    throw new Error(`--csv must be a .csv file (got: ${opts.csvPath})`);
  }
  return opts;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha1(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createThrottle(minIntervalMs: number): () => Promise<void> {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) return async () => {};
  let lastAt = 0;
  let chain = Promise.resolve();
  return async () => {
    chain = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastAt + minIntervalMs - now);
      if (waitMs > 0) await sleep(waitMs);
      lastAt = Date.now();
    });
    await chain;
  };
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;
  const v = retryAfterHeader.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const seconds = Number(v);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
  }
  const dt = Date.parse(v);
  if (Number.isFinite(dt)) return Math.max(0, dt - Date.now());
  return null;
}

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]*>/g, " ");
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function makeKey(make: string, model: string): string {
  return `${make.trim()}|${model.trim()}`.toLowerCase();
}

type FetchPolicy = {
  cacheDir: string;
  verbose: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryJitterMs: number;
  cacheTtlMs: number | null;
  throttle: () => Promise<void>;
};

async function fetchTextWithCache(url: string, policy: FetchPolicy): Promise<string> {
  ensureDir(policy.cacheDir);
  const cachePath = path.join(policy.cacheDir, `${sha1(url)}.json`);

  const now = Date.now();
  if (policy.cacheTtlMs !== null && policy.cacheTtlMs > 0 && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
        fetched_at: string;
        url: string;
        status: number;
        body: string;
      };
      const fetchedAtMs = Date.parse(cached.fetched_at);
      if (Number.isFinite(fetchedAtMs) && now - fetchedAtMs <= policy.cacheTtlMs) {
        if (policy.verbose) console.log(`[cache hit] ${url}`);
        return cached.body;
      }
    } catch {
      // fall through and refetch
    }
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = policy.retryBaseMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * policy.retryJitterMs);
      const wait = backoff + jitter;
      if (policy.verbose) console.log(`[retry] waiting ${wait}ms before retrying ${url}`);
      await sleep(wait);
    }

    await policy.throttle();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          // Wikipedia asks for an identifying UA; keep it generic (no secrets/PII).
          "User-Agent": "nuke-platform-scripts/1.0 (Wikipedia production scraper)",
          "Accept": "application/json,text/plain,*/*",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        const status = res.status;
        const retryable = status === 429 || status === 408 || (status >= 500 && status <= 599);
        if (retryable && attempt < policy.maxRetries) {
          if (retryAfterMs) {
            if (policy.verbose) console.log(`[retry-after] ${status} waiting ${retryAfterMs}ms for ${url}`);
            await sleep(retryAfterMs);
          }
          lastErr = new Error(`HTTP ${status} ${res.statusText}`);
          continue;
        }
        throw new Error(`HTTP ${status} ${res.statusText}: ${text.slice(0, 300)}`);
      }

      // Save cache
      if (policy.cacheTtlMs === null || policy.cacheTtlMs > 0) {
        try {
          fs.writeFileSync(
            cachePath,
            JSON.stringify(
              {
                fetched_at: new Date().toISOString(),
                url,
                status: res.status,
                body: text,
              },
              null,
              2
            )
          );
        } catch {
          // ignore cache write errors
        }
      }

      return text;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      const retryable = /aborted/i.test(msg) || /timeout/i.test(msg);
      if (retryable && attempt < policy.maxRetries) continue;
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "Unknown fetch error"));
}

async function fetchJsonWithCache<T>(url: string, policy: FetchPolicy): Promise<T> {
  const text = await fetchTextWithCache(url, policy);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Failed to parse JSON from ${url}: ${(e as Error).message}`);
  }
}

function wikipediaApiBase(lang: string): string {
  const l = (lang || "en").trim() || "en";
  return `https://${l}.wikipedia.org/w/api.php`;
}

function wikipediaPageUrl(lang: string, title: string): string {
  const l = (lang || "en").trim() || "en";
  const t = String(title || "").trim().replace(/ /g, "_");
  return `https://${l}.wikipedia.org/wiki/${encodeURIComponent(t)}`;
}

async function wikiSearch(
  lang: string,
  query: string,
  policy: FetchPolicy,
  limit: number
): Promise<WikipediaSearchResult[]> {
  const base = wikipediaApiBase(lang);
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    format: "json",
    utf8: "1",
    srlimit: String(Math.max(1, Math.min(50, limit))),
  });
  const url = `${base}?${params.toString()}`;
  const json = await fetchJsonWithCache<any>(url, policy);
  const items = (json?.query?.search || []) as any[];
  return items
    .map((it) => ({
      title: String(it?.title || ""),
      pageid: Number(it?.pageid || 0),
      snippet: String(it?.snippet || ""),
    }))
    .filter((x) => x.title && Number.isFinite(x.pageid));
}

async function wikiGetWikitext(
  lang: string,
  title: string,
  policy: FetchPolicy
): Promise<{ title: string; pageid: number; wikitext: string | null }> {
  const base = wikipediaApiBase(lang);
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    format: "json",
    formatversion: "2",
    redirects: "1",
    titles: title,
  });
  const url = `${base}?${params.toString()}`;
  const json = await fetchJsonWithCache<any>(url, policy);
  const page = (json?.query?.pages || [])[0] as any;
  const pageid = Number(page?.pageid || 0);
  const resolvedTitle = String(page?.title || title);
  const wikitext = String(page?.revisions?.[0]?.slots?.main?.content || "");
  return {
    title: resolvedTitle,
    pageid,
    wikitext: wikitext ? wikitext : null,
  };
}

function extractFirstInfoboxTemplate(wikitext: string): string | null {
  const s = String(wikitext || "");
  const start = s.search(/\{\{\s*Infobox\b/i);
  if (start < 0) return null;
  let i = start;
  let depth = 0;
  while (i < s.length) {
    if (s.startsWith("{{", i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (s.startsWith("}}", i)) {
      depth -= 1;
      i += 2;
      if (depth <= 0) {
        return s.slice(start, i);
      }
      continue;
    }
    i += 1;
  }
  return null;
}

function extractInfoboxParam(infoboxTemplate: string, param: string): string | null {
  const lines = String(infoboxTemplate || "").split(/\r?\n/);
  const re = new RegExp(`^\\s*\\|\\s*${param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`, "i");
  for (let idx = 0; idx < lines.length; idx++) {
    const m = re.exec(lines[idx] || "");
    if (!m) continue;
    const parts: string[] = [m[1] || ""];
    // Track nested template depth inside the parameter value so we don't prematurely
    // stop on lines like "| foo" inside templates (e.g. {{ubl ...}}).
    let depth = 0;
    const bumpDepth = (line: string) => {
      const s = String(line || "");
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] === "{" && s[i + 1] === "{") {
          depth += 1;
          i += 1;
        } else if (s[i] === "}" && s[i + 1] === "}") {
          depth -= 1;
          i += 1;
        }
      }
    };
    bumpDepth(m[1] || "");
    for (let j = idx + 1; j < lines.length; j++) {
      const l = lines[j] || "";
      // Stop only when we're at depth 0 AND we see a new infobox param (| name = ...)
      // or the end of the infobox template (}}).
      if (depth <= 0 && (/^\s*\|\s*[^=]{1,80}=/.test(l) || /^\s*}}/.test(l))) break;
      parts.push(l);
      bumpDepth(l);
    }
    const raw = parts.join("\n").trim();
    return raw || null;
  }
  return null;
}

function stripWikiMarkup(input: string): string {
  let s = String(input || "");
  // refs + comments
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<ref\b[^/>]*\/>/gi, " ");
  s = s.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, " ");

  // peel templates iteratively; keep the last argument (often the display text / value)
  for (let i = 0; i < 20; i++) {
    const before = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const t = String(inner || "").trim();
      if (!t) return "";
      const parts = t.split("|").map((x) => x.trim()).filter(Boolean);
      if (parts.length <= 1) return "";
      const name = String(parts[0] || "").toLowerCase();
      const args = parts.slice(1);
      const positional = args.filter((a) => !/^[a-z0-9_ -]+\s*=/.test(a));

      // Common list-ish templates: keep all items, not just the last one.
      if (name === "ubl" || name === "unbulleted list" || name === "plainlist") {
        return positional.join("; ");
      }
      if (name === "nowrap") {
        return positional.join(" ");
      }
      return positional[positional.length - 1] || args[args.length - 1] || "";
    });
    if (s === before) break;
  }

  // links
  s = s.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_m, _a, b) => String(b || ""));
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, a) => String(a || ""));

  // formatting + leftover markup
  s = s.replace(/''+/g, "");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function parseProductionUnits(productionText: string): ProductionParse {
  const t = String(productionText || "").trim();
  if (!t) return { units: null, confidence: "none", reason: "empty" };

  const normalized = t
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // High confidence: explicit unit marker near a number
  const explicit = normalized.match(/\b(\d{1,3}(?:,\d{3})+|\d+)\b\s*(?:units|vehicles|cars)\b/i);
  if (explicit) {
    const n = Number(String(explicit[1]).replace(/,/g, ""));
    if (Number.isFinite(n)) return { units: n, confidence: "high", reason: "number followed by units/cars/vehicles" };
  }

  // Medium: "X million/billion"
  const million = normalized.match(/\b(\d+(?:\.\d+)?)\s*(million|billion)\b/i);
  if (million) {
    const base = Number(million[1]);
    const scale = String(million[2]).toLowerCase() === "billion" ? 1_000_000_000 : 1_000_000;
    if (Number.isFinite(base)) return { units: Math.round(base * scale), confidence: "medium", reason: "scaled by million/billion" };
  }

  // Low: pick the largest non-year number
  const candidates: number[] = [];
  const re = /\b(\d{1,3}(?:,\d{3})+|\d{4}|\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized))) {
    const raw = m[1] || "";
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    // Skip likely years
    if (raw.length === 4 && n >= 1800 && n <= 2100) continue;
    candidates.push(n);
  }
  const max = candidates.length ? Math.max(...candidates) : null;
  if (max !== null && max >= 1000) return { units: max, confidence: "low", reason: "largest numeric candidate (heuristic)" };

  return { units: null, confidence: "none", reason: "no numeric production units detected" };
}

function tokenize(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function scoreWikiCandidate(candidate: WikipediaSearchResult, make: string, model: string): number {
  const title = String(candidate.title || "").toLowerCase();
  const snippet = stripHtml(candidate.snippet || "").toLowerCase();
  if (title.includes("disambiguation")) return -1000;

  const makeTokens = tokenize(make);
  const modelTokens = tokenize(model);

  let score = 0;
  for (const t of makeTokens) {
    if (title.includes(t)) score += 6;
    else if (snippet.includes(t)) score += 2;
  }
  for (const t of modelTokens) {
    if (title.includes(t)) score += 4;
    else if (snippet.includes(t)) score += 1;
  }
  if (/\b(car|automobile|vehicle|pickup|truck|suv)\b/.test(title)) score += 2;
  if (/\b(car|automobile|vehicle|pickup|truck|suv)\b/.test(snippet)) score += 2;
  if (/\b(album|song|band|film|novel)\b/.test(title)) score -= 8;
  return score;
}

function buildSearchQuery(make: string, model: string): string {
  const m = String(make || "").trim();
  const mo = String(model || "").trim();
  // Adding "production" tends to bias results towards the infobox field we want,
  // while still returning the canonical model page for popular vehicles.
  return `${m} ${mo} production automobile`.replace(/\s+/g, " ").trim();
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let nextIdx = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx] as T, idx);
    }
  });
  await Promise.all(runners);
  return out;
}

async function loadInputList(opts: CliOptions): Promise<MakeModel[]> {
  if (opts.source === "input") {
    if (!opts.inputPath) throw new Error(`--input is required when --source input`);
    const raw = JSON.parse(fs.readFileSync(opts.inputPath, "utf8"));
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.models) ? raw.models : [];
    return (arr as any[])
      .map((x) => ({
        make: String(x?.make || "").trim(),
        model: String(x?.model || "").trim(),
        db_count: x?.db_count != null ? Number(x.db_count) : undefined,
        source: x?.source ? String(x.source) : "input",
      }))
      .filter((x) => x.make && x.model);
  }

  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim() ||
    "https://qkgaybvrernstplzjaam.supabase.co";
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

  const key = serviceKey || anonKey;
  if (!key) {
    throw new Error(
      `Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).`
    );
  }

  const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (opts.verbose) {
    console.log(
      `Using Supabase: ${supabaseUrl} (${serviceKey ? "service_role" : "anon"} key) | source=${opts.source}`
    );
  }

  if (opts.source === "vehicles") {
    // Client-side aggregation to avoid requiring custom SQL RPC.
    const pageSize = 1000;
    let from = 0;
    const counts = new Map<string, MakeModel>();
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase.from("vehicles").select("make, model").range(from, to);
      if (error) throw new Error(`Supabase error fetching vehicles [${from}-${to}]: ${error.message}`);
      const rows = (data || []) as { make: string | null; model: string | null }[];
      if (!rows.length) break;

      for (const r of rows) {
        const make = String(r.make || "").trim();
        const model = String(r.model || "").trim();
        if (!make || !model) continue;
        const k = makeKey(make, model);
        const existing = counts.get(k);
        if (existing) existing.db_count = (existing.db_count || 0) + 1;
        else counts.set(k, { make, model, db_count: 1, source: "vehicles" });
      }

      from += rows.length;
      if (rows.length < pageSize) break;
      if (opts.verbose && from % 5000 === 0) console.log(`... scanned ${from} vehicle rows`);
    }
    return Array.from(counts.values());
  }

  if (opts.source === "ecr") {
    const makeMap = new Map<string, string>();
    {
      const { data, error } = await supabase.from("ecr_makes").select("ecr_make_slug, make_name");
      if (error) throw new Error(`Supabase error fetching ecr_makes: ${error.message}`);
      for (const r of (data || []) as any[]) {
        const slug = String(r?.ecr_make_slug || "").trim();
        const name = String(r?.make_name || "").trim();
        if (slug && name) makeMap.set(slug, name);
      }
    }

    const pageSize = 1000;
    let from = 0;
    const out: MakeModel[] = [];
    const seen = new Set<string>();
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase.from("ecr_models").select("ecr_make_slug, model_name").range(from, to);
      if (error) throw new Error(`Supabase error fetching ecr_models [${from}-${to}]: ${error.message}`);
      const rows = (data || []) as any[];
      if (!rows.length) break;
      for (const r of rows) {
        const make = makeMap.get(String(r?.ecr_make_slug || "").trim()) || "";
        const model = String(r?.model_name || "").trim();
        if (!make || !model) continue;
        const k = makeKey(make, model);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ make, model, source: "ecr" });
      }
      from += rows.length;
      if (rows.length < pageSize) break;
    }
    return out;
  }

  if (opts.source === "oem") {
    const pageSize = 1000;
    let from = 0;
    const out: MakeModel[] = [];
    const seen = new Set<string>();
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase.from("oem_models").select("make, model_name").range(from, to);
      if (error) throw new Error(`Supabase error fetching oem_models [${from}-${to}]: ${error.message}`);
      const rows = (data || []) as any[];
      if (!rows.length) break;
      for (const r of rows) {
        const make = String(r?.make || "").trim();
        const model = String(r?.model_name || "").trim();
        if (!make || !model) continue;
        const k = makeKey(make, model);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ make, model, source: "oem" });
      }
      from += rows.length;
      if (rows.length < pageSize) break;
    }
    return out;
  }

  if (opts.source === "canonical") {
    const pageSize = 1000;
    let from = 0;
    const out: MakeModel[] = [];
    const seen = new Set<string>();
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase.from("canonical_models").select("make_canonical, display_name").range(from, to);
      if (error) throw new Error(`Supabase error fetching canonical_models [${from}-${to}]: ${error.message}`);
      const rows = (data || []) as any[];
      if (!rows.length) break;
      for (const r of rows) {
        const make = String(r?.make_canonical || "").trim();
        const model = String(r?.display_name || "").trim();
        if (!make || !model) continue;
        const k = makeKey(make, model);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ make, model, source: "canonical" });
      }
      from += rows.length;
      if (rows.length < pageSize) break;
    }
    return out;
  }

  throw new Error(`Unsupported source: ${opts.source}`);
}

function buildTotals(rows: OutputRow[]): OutputJson["totals"] {
  const totals = {
    inputs: rows.length,
    processed: rows.length,
    ok: 0,
    no_match: 0,
    no_infobox: 0,
    no_production_field: 0,
    error: 0,
  };
  for (const r of rows) {
    if (r.status === "ok") totals.ok += 1;
    else if (r.status === "no_match") totals.no_match += 1;
    else if (r.status === "no_infobox") totals.no_infobox += 1;
    else if (r.status === "no_production_field") totals.no_production_field += 1;
    else if (r.status === "error") totals.error += 1;
  }
  return totals;
}

function buildTotalsWithTotalInputs(rows: OutputRow[], totalInputs: number): OutputJson["totals"] {
  const totals = buildTotals(rows);
  totals.inputs = totalInputs;
  totals.processed = rows.length;
  return totals;
}

function writeOutputs(
  opts: CliOptions,
  meta: Omit<OutputJson, "rows" | "totals">,
  rows: OutputRow[],
  totalInputs: number
) {
  ensureDir(path.dirname(opts.outPath));
  const out: OutputJson = {
    ...meta,
    totals: buildTotalsWithTotalInputs(rows, totalInputs),
    rows,
  };
  fs.writeFileSync(opts.outPath, JSON.stringify(out, null, 2));

  if (opts.csvPath) {
    ensureDir(path.dirname(opts.csvPath));
    const header = [
      "make",
      "model",
      "db_count",
      "wiki_title",
      "wiki_url",
      "production_text",
      "parsed_units",
      "parsed_units_confidence",
      "status",
      "error",
    ].join(",");
    const lines = [header];
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.input.make),
          csvEscape(r.input.model),
          csvEscape(r.input.db_count ?? ""),
          csvEscape(r.wikipedia.chosen_title ?? ""),
          csvEscape(r.wikipedia.chosen_url ?? ""),
          csvEscape(r.production.infobox_production_text ?? ""),
          csvEscape(r.production.parsed_units ?? ""),
          csvEscape(r.production.parsed_units_confidence),
          csvEscape(r.status),
          csvEscape(r.error ?? ""),
        ].join(",")
      );
    }
    fs.writeFileSync(opts.csvPath, lines.join("\n"));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  dotenv.config({ path: ".env.local" });
  dotenv.config();

  const throttle = createThrottle(opts.delayMs);
  const policy: FetchPolicy = {
    cacheDir: opts.cacheDir,
    verbose: opts.verbose,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    retryBaseMs: opts.retryBaseMs,
    retryJitterMs: opts.retryJitterMs,
    cacheTtlMs: opts.cacheTtlHours === null ? null : Math.max(0, opts.cacheTtlHours) * 60 * 60 * 1000,
    throttle,
  };

  const inputsRaw = await loadInputList(opts);
  const inputsSorted = inputsRaw
    .filter((x) => x.make && x.model)
    .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));

  const inputs = inputsSorted.slice(opts.offset, opts.limit ? opts.offset + opts.limit : undefined);
  if (!inputs.length) {
    console.error("No inputs found (after offset/limit).");
    process.exit(2);
  }
  const totalInputs = inputs.length;

  // Resume: build skip set from existing output
  const existingByKey = new Map<string, OutputRow>();
  if (opts.resume && fs.existsSync(opts.outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(opts.outPath, "utf8")) as OutputJson;
      for (const r of prev?.rows || []) {
        if (r?.key) existingByKey.set(String(r.key), r as OutputRow);
      }
      if (opts.verbose) console.log(`Resume enabled: loaded ${existingByKey.size} existing rows`);
    } catch (e) {
      console.warn(`WARN: failed to load previous output for --resume: ${(e as Error).message}`);
    }
  }

  const meta: Omit<OutputJson, "rows" | "totals"> = {
    source: { kind: opts.source, input_path: opts.inputPath || null },
    wikipedia: { lang: opts.wikiLang },
    scraped_at: new Date().toISOString(),
  };

  const outByIndex: Array<OutputRow | undefined> = new Array(totalInputs);

  let completed = 0;
  let lastWriteCompleted = 0;
  let writeChain: Promise<void> = Promise.resolve();
  const enqueueWrite = (force: boolean) => {
    if (!force && completed - lastWriteCompleted < opts.writeEvery) return;
    lastWriteCompleted = completed;
    const snapshot = outByIndex.filter(Boolean) as OutputRow[];
    writeChain = writeChain.then(() => {
      writeOutputs(opts, meta, snapshot, totalInputs);
    });
  };

  const scrapeOne = async (mm: MakeModel, _idx: number): Promise<OutputRow> => {
    const key = makeKey(mm.make, mm.model);
    if (existingByKey.has(key)) {
      if (opts.verbose) console.log(`[skip] ${mm.make} ${mm.model}`);
      return existingByKey.get(key) as OutputRow;
    }

    const scrapedAt = new Date().toISOString();
    const searchQuery = buildSearchQuery(mm.make, mm.model);
    try {
      const candidates = await wikiSearch(opts.wikiLang, searchQuery, policy, 10);
      if (!candidates.length) {
        return {
          key,
          input: { make: mm.make, model: mm.model, db_count: mm.db_count },
          wikipedia: { lang: opts.wikiLang, search_query: searchQuery, chosen_title: null, chosen_url: null },
          production: {
            infobox_production_wikitext: null,
            infobox_production_text: null,
            parsed_units: null,
            parsed_units_confidence: "none",
            parsed_units_reason: "no_match",
          },
          status: "no_match",
          error: null,
          scraped_at: scrapedAt,
        };
      }

      const scored = candidates
        .map((c) => ({ c, score: scoreWikiCandidate(c, mm.make, mm.model) }))
        .sort((a, b) => b.score - a.score);

      const chosen = scored[0]?.c;
      const chosenTitle = chosen?.title || null;
      if (!chosenTitle) {
        return {
          key,
          input: { make: mm.make, model: mm.model, db_count: mm.db_count },
          wikipedia: { lang: opts.wikiLang, search_query: searchQuery, chosen_title: null, chosen_url: null },
          production: {
            infobox_production_wikitext: null,
            infobox_production_text: null,
            parsed_units: null,
            parsed_units_confidence: "none",
            parsed_units_reason: "no_match",
          },
          status: "no_match",
          error: null,
          scraped_at: scrapedAt,
        };
      }

      const { title: resolvedTitle, wikitext } = await wikiGetWikitext(opts.wikiLang, chosenTitle, policy);
      if (!wikitext) {
        return {
          key,
          input: { make: mm.make, model: mm.model, db_count: mm.db_count },
          wikipedia: {
            lang: opts.wikiLang,
            search_query: searchQuery,
            chosen_title: resolvedTitle,
            chosen_url: wikipediaPageUrl(opts.wikiLang, resolvedTitle),
            search_candidates: opts.verbose
              ? scored.map((x) => ({ title: x.c.title, pageid: x.c.pageid, score: x.score }))
              : undefined,
          },
          production: {
            infobox_production_wikitext: null,
            infobox_production_text: null,
            parsed_units: null,
            parsed_units_confidence: "none",
            parsed_units_reason: "missing_wikitext",
          },
          status: "error",
          error: "missing wikitext",
          scraped_at: scrapedAt,
        };
      }

      const infobox = extractFirstInfoboxTemplate(wikitext);
      if (!infobox) {
        return {
          key,
          input: { make: mm.make, model: mm.model, db_count: mm.db_count },
          wikipedia: {
            lang: opts.wikiLang,
            search_query: searchQuery,
            chosen_title: resolvedTitle,
            chosen_url: wikipediaPageUrl(opts.wikiLang, resolvedTitle),
            search_candidates: opts.verbose
              ? scored.map((x) => ({ title: x.c.title, pageid: x.c.pageid, score: x.score }))
              : undefined,
          },
          production: {
            infobox_production_wikitext: null,
            infobox_production_text: null,
            parsed_units: null,
            parsed_units_confidence: "none",
            parsed_units_reason: "no_infobox",
          },
          status: "no_infobox",
          error: null,
          scraped_at: scrapedAt,
        };
      }

      const productionWikitext = extractInfoboxParam(infobox, "production");
      if (!productionWikitext) {
        return {
          key,
          input: { make: mm.make, model: mm.model, db_count: mm.db_count },
          wikipedia: {
            lang: opts.wikiLang,
            search_query: searchQuery,
            chosen_title: resolvedTitle,
            chosen_url: wikipediaPageUrl(opts.wikiLang, resolvedTitle),
            search_candidates: opts.verbose
              ? scored.map((x) => ({ title: x.c.title, pageid: x.c.pageid, score: x.score }))
              : undefined,
          },
          production: {
            infobox_production_wikitext: null,
            infobox_production_text: null,
            parsed_units: null,
            parsed_units_confidence: "none",
            parsed_units_reason: "no_production_field",
          },
          status: "no_production_field",
          error: null,
          scraped_at: scrapedAt,
        };
      }

      const productionText = stripWikiMarkup(productionWikitext);
      const parsed = parseProductionUnits(productionText || "");

      return {
        key,
        input: { make: mm.make, model: mm.model, db_count: mm.db_count },
        wikipedia: {
          lang: opts.wikiLang,
          search_query: searchQuery,
          chosen_title: resolvedTitle,
          chosen_url: wikipediaPageUrl(opts.wikiLang, resolvedTitle),
          search_candidates: opts.verbose ? scored.map((x) => ({ title: x.c.title, pageid: x.c.pageid, score: x.score })) : undefined,
        },
        production: {
          infobox_production_wikitext: productionWikitext,
          infobox_production_text: productionText || null,
          parsed_units: parsed.units,
          parsed_units_confidence: parsed.confidence,
          parsed_units_reason: parsed.reason,
        },
        status: "ok",
        error: null,
        scraped_at: scrapedAt,
      };
    } catch (e) {
      return {
        key,
        input: { make: mm.make, model: mm.model, db_count: mm.db_count },
        wikipedia: { lang: opts.wikiLang, search_query: searchQuery, chosen_title: null, chosen_url: null },
        production: {
          infobox_production_wikitext: null,
          infobox_production_text: null,
          parsed_units: null,
          parsed_units_confidence: "none",
          parsed_units_reason: "error",
        },
        status: "error",
        error: (e as Error)?.message || String(e),
        scraped_at: scrapedAt,
      };
    }
  };

  let nextIndex = 0;
  const workerLoop = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= totalInputs) return;
      const mm = inputs[idx] as MakeModel;
      const row = await scrapeOne(mm, idx);
      outByIndex[idx] = row;
      completed += 1;
      if (opts.verbose && completed % 10 === 0) console.log(`progress ${completed}/${totalInputs}`);
      enqueueWrite(false);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }).map(() => workerLoop()));
  enqueueWrite(true);
  await writeChain;

  const results = outByIndex.filter(Boolean) as OutputRow[];

  // Write output(s)
  writeOutputs(opts, meta, results, totalInputs);

  const totals = buildTotalsWithTotalInputs(results, totalInputs);
  console.log(`Done. Wrote ${results.length} rows to ${opts.outPath}`);
  console.log(
    `Totals: ok=${totals.ok} no_match=${totals.no_match} no_infobox=${totals.no_infobox} no_production_field=${totals.no_production_field} error=${totals.error}`
  );
  if (opts.csvPath) console.log(`Also wrote CSV to ${opts.csvPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});


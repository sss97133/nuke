#!/usr/bin/env node
/**
 * Scrape make/model taxonomy from Exclusive Car Registry (ECR).
 *
 * Primary pages:
 * - Makes list: https://exclusivecarregistry.com/make
 * - Make detail: https://exclusivecarregistry.com/make/<make_slug>
 *
 * Output:
 * - A JSON file containing makes + (optionally) models with ECR slugs and logo/image URLs.
 *
 * Notes:
 * - Be respectful: request throttling + low concurrency + on-disk caching by URL.
 * - ECR does NOT provide year ranges on the make pages; treat this as nomenclature + branding layer.
 *
 * Usage:
 *   tsx scripts/scrape-ecr-makes-models.ts --out data/json/ecr_makes_models.json
 *   tsx scripts/scrape-ecr-makes-models.ts --no-models
 *   tsx scripts/scrape-ecr-makes-models.ts --only-make abarth
 *   tsx scripts/scrape-ecr-makes-models.ts --limit-makes 20 --concurrency 2
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as cheerio from 'cheerio';

type EcrModel = {
  ecr_model_slug: string | null;
  model_name: string;
  summary: string | null;
  variants_count: number | null;
  image_url: string | null;
};

type EcrMake = {
  ecr_make_slug: string;
  make_name: string;
  make_url: string;
  logo_url: string | null;
  model_count: number | null;
  car_count: number | null;
  models?: EcrModel[];
};

type OutputJson = {
  source: {
    name: 'exclusivecarregistry';
    base_url: string;
    makes_url: string;
  };
  scraped_at: string;
  totals: {
    makes: number;
    models: number;
  };
  makes: EcrMake[];
};

type CliOptions = {
  baseUrl: string;
  makesPath: string;
  outPath: string;
  cacheDir: string;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryJitterMs: number;
  includeModels: boolean;
  resume: boolean;
  writeEvery: number;
  onlyMake: string | null;
  offsetMakes: number;
  limitMakes: number | null;
  verbose: boolean;
};

type FetchPolicy = {
  cacheDir: string;
  verbose: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryJitterMs: number;
  throttle: () => Promise<void>;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    baseUrl: 'https://exclusivecarregistry.com',
    makesPath: '/make',
    outPath: path.join(process.cwd(), 'data/json/ecr_makes_models.json'),
    cacheDir: path.join(process.cwd(), 'tmp/ecr/cache'),
    concurrency: 1,
    delayMs: 500,
    timeoutMs: 30000,
    maxRetries: 6,
    retryBaseMs: 1000,
    retryJitterMs: 250,
    includeModels: true,
    resume: false,
    writeEvery: 10,
    onlyMake: null,
    offsetMakes: 0,
    limitMakes: null,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.outPath = path.resolve(process.cwd(), argv[++i] || '');
    else if (a === '--cache-dir') opts.cacheDir = path.resolve(process.cwd(), argv[++i] || '');
    else if (a === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i] || '3'));
    else if (a === '--delay-ms') opts.delayMs = Math.max(0, Number(argv[++i] || '0'));
    else if (a === '--timeout-ms') opts.timeoutMs = Math.max(1000, Number(argv[++i] || '30000'));
    else if (a === '--max-retries') opts.maxRetries = Math.max(0, Number(argv[++i] || '0'));
    else if (a === '--retry-base-ms') opts.retryBaseMs = Math.max(0, Number(argv[++i] || '0'));
    else if (a === '--retry-jitter-ms') opts.retryJitterMs = Math.max(0, Number(argv[++i] || '0'));
    else if (a === '--no-models') opts.includeModels = false;
    else if (a === '--resume') opts.resume = true;
    else if (a === '--write-every') opts.writeEvery = Math.max(1, Number(argv[++i] || '10'));
    else if (a === '--only-make') opts.onlyMake = (argv[++i] || '').trim() || null;
    else if (a === '--offset-makes') opts.offsetMakes = Math.max(0, Number(argv[++i] || '0'));
    else if (a === '--limit-makes') opts.limitMakes = Math.max(0, Number(argv[++i] || '0')) || null;
    else if (a === '--base-url') opts.baseUrl = (argv[++i] || '').trim() || opts.baseUrl;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(`ECR make/model scraper

Flags:
  --out <path>           Output JSON path (default: data/json/ecr_makes_models.json)
  --cache-dir <path>     Cache directory for fetched HTML (default: tmp/ecr/cache)
  --concurrency <n>      Max concurrent make-page fetches (default: 1)
  --delay-ms <n>         Minimum delay (ms) between network requests (default: 500)
  --timeout-ms <n>       Per-request timeout (ms) (default: 30000)
  --max-retries <n>      Max retries for retryable HTTP errors/timeouts (default: 6)
  --retry-base-ms <n>    Backoff base (ms) (default: 1000)
  --retry-jitter-ms <n>  Backoff jitter (ms) (default: 250)
  --no-models            Only scrape makes list (do not fetch each make page)
  --resume               Merge into existing --out file if present (skip makes that already have models)
  --write-every <n>      Write output every N processed make pages (default: 10)
  --only-make <slug>     Scrape only a single make (e.g. abarth)
  --offset-makes <n>     Start at make index N (after sorting) for batch runs (default: 0)
  --limit-makes <n>      Scrape only first N makes (for testing)
  --base-url <url>       Override base URL (default: https://exclusivecarregistry.com)
  --verbose              More logging
`);
      process.exit(0);
    }
  }

  if (!opts.outPath.endsWith('.json')) {
    throw new Error(`--out must be a .json file (got: ${opts.outPath})`);
  }
  if (!Number.isFinite(opts.offsetMakes) || opts.offsetMakes < 0) {
    throw new Error(`--offset-makes must be >= 0`);
  }
  return opts;
}

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createThrottle(minIntervalMs: number): () => Promise<void> {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) {
    return async () => {};
  }
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

function toAbsoluteUrl(baseUrl: string, maybeRelative: string | null | undefined): string | null {
  if (!maybeRelative) return null;
  const s = maybeRelative.trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${baseUrl.replace(/\/$/, '')}${s}`;
  return `${baseUrl.replace(/\/$/, '')}/${s}`;
}

function parseIntOrNull(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;
  const v = retryAfterHeader.trim();
  if (!v) return null;
  // Retry-After can be seconds or an HTTP date.
  if (/^\d+$/.test(v)) {
    const seconds = Number(v);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
  }
  const dt = Date.parse(v);
  if (!Number.isFinite(dt)) return null;
  const ms = dt - Date.now();
  return ms >= 0 ? ms : 0;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function jitterMs(maxJitterMs: number): number {
  if (!Number.isFinite(maxJitterMs) || maxJitterMs <= 0) return 0;
  return Math.floor(Math.random() * (maxJitterMs + 1));
}

async function fetchWithRetry(url: string, policy: FetchPolicy): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    const isLastAttempt = attempt === policy.maxRetries;
    await policy.throttle();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      if (policy.verbose) console.log(`GET ${url}${attempt ? ` (retry ${attempt}/${policy.maxRetries})` : ''}`);
      const resp = await fetch(url, { headers, signal: controller.signal });
      if (resp.ok) return resp;

      if (!isRetryableStatus(resp.status) || isLastAttempt) return resp;

      const ra = parseRetryAfterMs(resp.headers.get('retry-after'));
      const backoff = ra ?? policy.retryBaseMs * Math.pow(2, attempt);
      const waitMs = Math.max(0, backoff + jitterMs(policy.retryJitterMs));
      if (policy.verbose) console.log(`Retrying ${url} in ${waitMs}ms due to HTTP ${resp.status}`);
      await sleep(waitMs);
      continue;
    } catch (err: any) {
      if (isLastAttempt) throw err;
      const backoff = policy.retryBaseMs * Math.pow(2, attempt);
      const waitMs = Math.max(0, backoff + jitterMs(policy.retryJitterMs));
      if (policy.verbose) console.log(`Retrying ${url} in ${waitMs}ms due to error: ${String(err?.message || err)}`);
      await sleep(waitMs);
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Should be unreachable.
  throw new Error(`Failed to fetch ${url} after ${policy.maxRetries} retries`);
}

async function fetchHtml(url: string, policy: FetchPolicy): Promise<string> {
  ensureDir(policy.cacheDir);
  const cachePath = path.join(policy.cacheDir, `${sha1(url)}.html`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf8');
  }

  const resp = await fetchWithRetry(url, policy);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}: ${text.slice(0, 200)}`);
  fs.writeFileSync(cachePath, text);
  return text;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

function readExistingOutput(outPath: string): OutputJson | null {
  if (!fs.existsSync(outPath)) return null;
  const raw = fs.readFileSync(outPath, 'utf8');
  const json = JSON.parse(raw) as OutputJson;
  if (json?.source?.name !== 'exclusivecarregistry') {
    throw new Error(`Refusing to --resume: existing file does not look like ECR output (${outPath})`);
  }
  if (!Array.isArray(json.makes)) {
    throw new Error(`Refusing to --resume: invalid makes array in ${outPath}`);
  }
  return json;
}

function mergeMake(existing: EcrMake | undefined, incoming: EcrMake): EcrMake {
  if (!existing) return incoming;
  const existingModels = existing.models && existing.models.length > 0 ? existing.models : undefined;
  return {
    ...existing,
    // Prefer latest metadata from the makes list.
    make_name: incoming.make_name || existing.make_name,
    make_url: incoming.make_url || existing.make_url,
    logo_url: incoming.logo_url ?? existing.logo_url,
    model_count: incoming.model_count ?? existing.model_count,
    car_count: incoming.car_count ?? existing.car_count,
    models: existingModels ?? incoming.models,
  };
}

function parseMakesList(html: string, baseUrl: string): EcrMake[] {
  const $ = cheerio.load(html);
  const makes: EcrMake[] = [];

  $('.make_card_list .make_item > a.content').each((_, el) => {
    const a = $(el);
    const href = a.attr('href')?.trim() || null;
    if (!href) return;
    const makeUrl = toAbsoluteUrl(baseUrl, href);
    if (!makeUrl) return;

    const slug = href.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean).pop() || null;
    if (!slug) return;

    const name = a.find('p.title').text().trim();
    const logoUrl = toAbsoluteUrl(baseUrl, a.find('img').attr('src'));

    const infoPs = a.find('.info p');
    const modelCount = parseIntOrNull(infoPs.eq(0).find('strong').text());
    const carCount = parseIntOrNull(infoPs.eq(1).find('strong').text());

    makes.push({
      ecr_make_slug: slug,
      make_name: name || slug,
      make_url: makeUrl,
      logo_url: logoUrl,
      model_count: modelCount,
      car_count: carCount,
    });
  });

  // De-dupe by slug (defensive).
  const bySlug = new Map<string, EcrMake>();
  for (const m of makes) bySlug.set(m.ecr_make_slug, m);
  return Array.from(bySlug.values()).sort((a, b) => a.make_name.localeCompare(b.make_name));
}

function parseMakeModels(html: string, baseUrl: string): EcrModel[] {
  const $ = cheerio.load(html);
  const models: EcrModel[] = [];

  $('.model_list .car_item_line.model').each((_, el) => {
    const row = $(el);
    const ecrModelSlug = row.attr('data-info')?.trim() || null;
    const modelName = row.find('.car_content .title strong').first().text().trim() || row.find('.car_content .title').text().trim();
    const summary = row.find('.summary_text_model').text().trim() || null;
    const variantsCount = parseIntOrNull(row.find('.info_production strong').text());
    const imageUrl = toAbsoluteUrl(baseUrl, row.find('.car_img img').attr('src'));

    if (!modelName) return;
    models.push({
      ecr_model_slug: ecrModelSlug,
      model_name: modelName,
      summary,
      variants_count: variantsCount,
      image_url: imageUrl,
    });
  });

  // De-dupe by (slug || name)
  const seen = new Set<string>();
  const deduped: EcrModel[] = [];
  for (const m of models) {
    const key = `${m.ecr_model_slug || ''}::${m.model_name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  return deduped.sort((a, b) => a.model_name.localeCompare(b.model_name));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureDir(path.dirname(opts.outPath));
  ensureDir(opts.cacheDir);

  const makesUrl = `${opts.baseUrl.replace(/\/$/, '')}${opts.makesPath}`;
  const policy: FetchPolicy = {
    cacheDir: opts.cacheDir,
    verbose: opts.verbose,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    retryBaseMs: opts.retryBaseMs,
    retryJitterMs: opts.retryJitterMs,
    throttle: createThrottle(opts.delayMs),
  };

  const existingOut = opts.resume ? readExistingOutput(opts.outPath) : null;
  const makeMap = new Map<string, EcrMake>((existingOut?.makes || []).map((m) => [m.ecr_make_slug, m]));

  const makesHtml = await fetchHtml(makesUrl, policy);
  const makesAll = parseMakesList(makesHtml, opts.baseUrl);

  // Merge latest make metadata from the makes list into the working map (preserving existing models if present).
  for (const m of makesAll) {
    makeMap.set(m.ecr_make_slug, mergeMake(makeMap.get(m.ecr_make_slug), m));
  }

  // Batch selection (for fetching models).
  let selected = makesAll;
  if (opts.onlyMake) selected = selected.filter((m) => m.ecr_make_slug === opts.onlyMake);
  if (opts.offsetMakes) selected = selected.slice(opts.offsetMakes);
  if (opts.limitMakes !== null) selected = selected.slice(0, opts.limitMakes);

  console.log(`ECR scrape`);
  console.log(`Base: ${opts.baseUrl}`);
  console.log(`Makes total (from list): ${makesAll.length}`);
  console.log(`Makes selected: ${selected.length}${opts.includeModels ? '' : ' (no-models)'}`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log(`Delay: ${opts.delayMs}ms`);
  console.log(`Timeout: ${opts.timeoutMs}ms`);
  console.log(`Max retries: ${opts.maxRetries}`);
  console.log(`Cache: ${opts.cacheDir}`);
  if (opts.resume) console.log(`Resume: enabled (${existingOut?.makes?.length || 0} existing makes in out file)`);
  console.log(`Write every: ${opts.writeEvery}`);
  console.log(`Offset: ${opts.offsetMakes}`);

  const work = selected.filter((m) => {
    if (!opts.includeModels) return false;
    const existing = makeMap.get(m.ecr_make_slug);
    const hasModels = (existing?.models?.length || 0) > 0;
    return !hasModels;
  });

  console.log(`Make pages to fetch (models missing): ${work.length}`);

  function writeOutput(): void {
    const mergedMakes = Array.from(makeMap.values()).sort((a, b) => a.make_name.localeCompare(b.make_name));
    const totalModels = mergedMakes.reduce((sum, m) => sum + (m.models?.length || 0), 0);
    const out: OutputJson = {
      source: {
        name: 'exclusivecarregistry',
        base_url: opts.baseUrl,
        makes_url: makesUrl,
      },
      scraped_at: new Date().toISOString(),
      totals: {
        makes: mergedMakes.length,
        models: totalModels,
      },
      makes: mergedMakes,
    };
    fs.writeFileSync(opts.outPath, JSON.stringify(out, null, 2));
  }

  let fetched = 0;
  if (opts.includeModels) {
    if (opts.concurrency === 1) {
      for (const m of work) {
        const html = await fetchHtml(m.make_url, policy);
        const models = parseMakeModels(html, opts.baseUrl);
        makeMap.set(m.ecr_make_slug, { ...mergeMake(makeMap.get(m.ecr_make_slug), m), models });
        fetched++;
        if (fetched % opts.writeEvery === 0) {
          writeOutput();
          console.log(`Checkpoint: fetched=${fetched}/${work.length} (wrote ${opts.outPath})`);
        }
      }
    } else {
      const results = await mapLimit(work, opts.concurrency, async (m) => {
        const html = await fetchHtml(m.make_url, policy);
        const models = parseMakeModels(html, opts.baseUrl);
        return { m, models };
      });
      for (const r of results) {
        makeMap.set(r.m.ecr_make_slug, { ...mergeMake(makeMap.get(r.m.ecr_make_slug), r.m), models: r.models });
        fetched++;
      }
    }
  }

  writeOutput();
  const finalOut = readExistingOutput(opts.outPath);
  console.log(`Wrote: ${opts.outPath}`);
  console.log(`Totals: makes=${finalOut?.totals?.makes ?? '?'} models=${finalOut?.totals?.models ?? '?'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


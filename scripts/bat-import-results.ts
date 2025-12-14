#!/usr/bin/env node
/**
 * Import BaT listings from the BaT "Results" pages by:
 * - Fetching results pages
 * - Enumerating /listing/ URLs
 * - Invoking the `import-bat-listing` Edge Function per URL
 *
 * This avoids `process-import-queue` (which can 504 on slow listings) and uses the BaT-native importer.
 *
 * Usage:
 *   tsx scripts/bat-import-results.ts --pages 1 --limit 10
 *   tsx scripts/bat-import-results.ts --start-page 1 --pages 5 --concurrency 1
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY (or service role key if you have it)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

type Options = {
  startPage: number;
  pages: number;
  limit: number | null;
  resumeFrom: number;
  concurrency: number;
  imageBatchSize: number;
  organizationId: string | null;
  dryRun: boolean;
  writeJson: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    startPage: 1,
    pages: 1,
    limit: null,
    resumeFrom: 0,
    concurrency: 1,
    imageBatchSize: 25,
    organizationId: null,
    dryRun: false,
    writeJson: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start-page' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.startPage = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
      continue;
    }
    if (a === '--pages' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.pages = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 1;
      continue;
    }
    if (a === '--limit' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.limit = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
      continue;
    }
    if (a === '--resume-from' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.resumeFrom = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      continue;
    }
    if (a === '--concurrency' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.concurrency = Number.isFinite(n) ? Math.max(1, Math.min(5, Math.floor(n))) : 1;
      continue;
    }
    if (a === '--image-batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.imageBatchSize = Number.isFinite(n) ? Math.max(10, Math.min(100, Math.floor(n))) : 25;
      continue;
    }
    if (a === '--organization-id' && argv[i + 1]) {
      opts.organizationId = String(argv[++i]).trim() || null;
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--no-json') {
      opts.writeJson = false;
      continue;
    }
  }

  return opts;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

function enumerateResultsPages(startPage: number, pages: number): string[] {
  const urls: string[] = [];
  for (let i = 0; i < pages; i++) {
    const p = startPage + i;
    urls.push(`https://bringatrailer.com/auctions/results/?page=${p}`);
  }
  return urls;
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.text();
}

function extractListingUrls(html: string): string[] {
  const found = new Set<string>();
  // BaT uses both absolute and relative listing hrefs; support both and both quote styles.
  const patterns = [
    /href="(https?:\/\/bringatrailer\.com\/listing\/[^"]+?)"/gi,
    /href='(https?:\/\/bringatrailer\.com\/listing\/[^']+?)'/gi,
    /href="(\/listing\/[^"]+?)"/gi,
    /href='(\/listing\/[^']+?)'/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      if (!href) continue;
      const full = href.startsWith('http') ? href.split('#')[0] : `https://bringatrailer.com${href.split('#')[0]}`;
      found.add(full.endsWith('/') ? full : `${full}/`);
    }
  }
  return Array.from(found);
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const INVOKE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key (anon or service role) to invoke Edge Functions');

  async function ensureBatOrganizationId(): Promise<string> {
    if (opts.organizationId) return opts.organizationId;

    // Create/find the canonical "Bring a Trailer" organization via scrape-multi-source (server-side service role).
    const scrapeEndpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
    // Use the Local Partners page because it reliably contains a BaT email address and strong textual cues,
    // making dealer/org extraction far more reliable than the JS-heavy homepage.
    const res = await fetch(scrapeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INVOKE_KEY}`,
      },
      body: JSON.stringify({
        source_url: 'https://bringatrailer.com/local-partners/',
        source_type: 'auction_house',
        extract_listings: false,
        extract_dealer_info: true,
        use_llm_extraction: true,
        // Need LLM fallback here; BaT homepage doesn't have deterministic "dealer_info" fields.
        cheap_mode: false,
        max_listings: 0,
      }),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Failed to create BaT org via scrape-multi-source: HTTP ${res.status} ${txt.slice(0, 200)}`);
    let json: any = null;
    try {
      json = JSON.parse(txt);
    } catch {
      // ignore
    }
    const orgId = json?.organization_id || json?.organizationId || null;
    if (!orgId) throw new Error(`Could not determine BaT organization_id from scrape-multi-source response`);
    opts.organizationId = orgId;
    return orgId;
  }

  const pages = enumerateResultsPages(opts.startPage, opts.pages);
  console.log(`BaT Results import`);
  console.log(`Pages: start=${opts.startPage} count=${opts.pages}`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log(`imageBatchSize: ${opts.imageBatchSize}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);

  // 1) Collect listing URLs
  const allUrls: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageUrl = pages[i];
    console.log(`\n[fetch ${i + 1}/${pages.length}] ${pageUrl}`);
    const html = await fetchHtml(pageUrl);
    const urls = extractListingUrls(html);
    console.log(`  found=${urls.length}`);
    allUrls.push(...urls);
    await sleep(800);
  }

  const deduped = Array.from(new Set(allUrls)).sort();
  const sliced = (typeof opts.limit === 'number' ? deduped.slice(0, opts.limit) : deduped).slice(opts.resumeFrom);

  console.log(`\nTotal unique listing URLs: ${deduped.length}`);
  console.log(`To process: ${sliced.length} (resumeFrom=${opts.resumeFrom}, limit=${opts.limit ?? 'none'})`);

  if (opts.writeJson) {
    const outDir = path.resolve(__dirname, '..', 'data', 'bat');
    const outPath = path.join(outDir, `bat_results_urls_p${opts.startPage}_n${opts.pages}.json`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ scraped_at: new Date().toISOString(), pages, urls: deduped }, null, 2));
    console.log(`Wrote: ${outPath}`);
  }

  if (opts.dryRun) return;

  const organizationId = await ensureBatOrganizationId();
  console.log(`Using organizationId: ${organizationId}`);

  // 2) Import each listing via Edge Function
  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-bat-listing`;
  let ok = 0;
  let fail = 0;

  await mapLimit(sliced, opts.concurrency, async (batUrl, idx) => {
    const n = idx + 1;
    process.stdout.write(`[import ${n}/${sliced.length}] ${batUrl.split('/listing/')[1]?.slice(0, 48) || batUrl} ... `);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${INVOKE_KEY}`,
        },
        body: JSON.stringify({
          // Backwards/compat across deployed versions:
          // - some versions expect listingUrl + organizationId
          // - newer versions accept batUrl/url and organizationId optional
          listingUrl: batUrl,
          organizationId,
          batUrl,
          allowFuzzyMatch: false,
          imageBatchSize: opts.imageBatchSize,
        }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 180)}`);
      ok++;
      process.stdout.write(`OK\n`);
      // Pacing: BaT is sensitive.
      await sleep(900);
    } catch (e: any) {
      fail++;
      process.stdout.write(`FAIL (${e?.message || String(e)})\n`);
      await sleep(1500);
    }
  });

  console.log(`\nDone: ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



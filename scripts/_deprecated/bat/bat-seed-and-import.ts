#!/usr/bin/env node
/**
 * BaT Seed + Import Runner (consistent, idempotent)
 *
 * What it does:
 * 1) Seeds BaT listing URLs into `import_queue` by calling `scrape-multi-source` on one or more BaT pages
 *    (cheap_mode URL enumeration; no LLM).
 * 2) Processes the queue by calling `process-import-queue` repeatedly to create/update vehicles.
 *
 * This is intentionally “boring + repeatable”: run it nightly/continuously and it will keep pulling
 * more BaT listings and importing them.
 *
 * Usage:
 *   tsx scripts/bat-seed-and-import.ts --seed recent --pages 2 --process-batches 10
 *   tsx scripts/bat-seed-and-import.ts --seed squarebody --process-batches 50
 *
 * Flags:
 * - --seed recent|results|squarebody|custom
 * - --custom-url <url>        (repeatable)
 * - --pages N                (for results pagination, best-effort)
 * - --seed-max-listings N    (max URLs per seed page; default 200)
 * - --process-batches N      (how many process-import-queue calls; default 20)
 * - --batch-size N           (process-import-queue batch_size; default 10)
 * - --priority-only          (process-import-queue priority_only=true)
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - Prefer SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY when available
 * - Otherwise falls back to SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY (Edge Functions still run
 *   with service role on the server-side; this key is just for invocation auth).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

type SeedMode = 'recent' | 'results' | 'squarebody' | 'custom';

type Options = {
  seed: SeedMode;
  customUrls: string[];
  pages: number;
  seedMaxListings: number;
  processBatches: number;
  batchSize: number;
  priorityOnly: boolean;
  fastMode: boolean;
  skipImageUpload: boolean;
  dryRun: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  // Load ALL env files found (do not stop at first). This prevents anon-only env files
  // from masking a repo-root `.env` containing the service role key.
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
      }
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    seed: 'recent',
    customUrls: [],
    pages: 1,
    seedMaxListings: 200,
    processBatches: 20,
    batchSize: 10,
    priorityOnly: false,
    // Default to fast+no-images for reliability (prevents Edge timeouts).
    // You can run a second pass later to backfill images.
    fastMode: true,
    skipImageUpload: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed' && argv[i + 1]) {
      const v = String(argv[++i]) as SeedMode;
      opts.seed = v;
      continue;
    }
    if (a === '--custom-url' && argv[i + 1]) {
      opts.customUrls.push(String(argv[++i]));
      continue;
    }
    if (a === '--pages' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.pages = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 1;
      continue;
    }
    if (a === '--seed-max-listings' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.seedMaxListings = Number.isFinite(n) ? Math.max(1, Math.min(2000, Math.floor(n))) : 200;
      continue;
    }
    if (a === '--process-batches' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.processBatches = Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.floor(n))) : 20;
      continue;
    }
    if (a === '--batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.batchSize = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 10;
      continue;
    }
    if (a === '--priority-only') {
      opts.priorityOnly = true;
      continue;
    }
    if (a === '--fast') {
      opts.fastMode = true;
      continue;
    }
    if (a === '--no-fast') {
      opts.fastMode = false;
      continue;
    }
    if (a === '--skip-images') {
      opts.skipImageUpload = true;
      continue;
    }
    if (a === '--with-images') {
      opts.skipImageUpload = false;
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
  }

  return opts;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSeedUrls(seed: SeedMode, pages: number, customUrls: string[]): string[] {
  if (seed === 'custom') return customUrls;

  if (seed === 'squarebody') {
    return [
      'https://bringatrailer.com/chevrolet/c10/',
      'https://bringatrailer.com/chevrolet/k10/',
      'https://bringatrailer.com/chevrolet/c20/',
      'https://bringatrailer.com/chevrolet/k20/',
      'https://bringatrailer.com/chevrolet/blazer/',
      'https://bringatrailer.com/chevrolet/suburban/',
      'https://bringatrailer.com/gmc/c1500/',
      'https://bringatrailer.com/gmc/k1500/',
      'https://bringatrailer.com/gmc/jimmy/',
    ];
  }

  if (seed === 'results') {
    // BaT supports query + pagination; keep it conservative.
    // If the page param is different, scrape-multi-source will still enumerate listing URLs from the HTML.
    const urls: string[] = [];
    for (let p = 1; p <= pages; p++) {
      urls.push(`https://bringatrailer.com/auctions/results/?page=${p}`);
    }
    return urls;
  }

  // seed === 'recent'
  return [
    'https://bringatrailer.com/auctions/',
    'https://bringatrailer.com/auctions/results/',
  ];
}

async function postJson(url: string, bearer: string, body: any): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key (service role or anon) to invoke Edge Functions');

  const seedUrls = buildSeedUrls(opts.seed, opts.pages, opts.customUrls);
  if (opts.seed === 'custom' && seedUrls.length === 0) {
    throw new Error('seed=custom requires at least one --custom-url');
  }

  const scrapeMultiSourceUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
  const processQueueUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-import-queue`;

  console.log(`BaT seed + import`);
  console.log(`Seed mode: ${opts.seed}`);
  console.log(`Seed URLs: ${seedUrls.length}`);
  console.log(`Seed max listings/page: ${opts.seedMaxListings}`);
  console.log(`Process batches: ${opts.processBatches} (batch_size=${opts.batchSize}, priority_only=${opts.priorityOnly}, fast_mode=${opts.fastMode}, skip_image_upload=${opts.skipImageUpload})`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);

  // Step 1: Seed listing URLs into import_queue
  for (let i = 0; i < seedUrls.length; i++) {
    const u = seedUrls[i];
    console.log(`\n[seed ${i + 1}/${seedUrls.length}] ${u}`);

    if (opts.dryRun) continue;

    const seedResult = await postJson(scrapeMultiSourceUrl, INVOKE_KEY, {
      source_url: u,
      source_type: 'auction',
      extract_listings: true,
      extract_dealer_info: false,
      use_llm_extraction: false,
      cheap_mode: true,
      max_listings: opts.seedMaxListings,
    });

    console.log(`  listings_found=${seedResult?.listings_found ?? 'n/a'} queued=${seedResult?.listings_queued ?? 'n/a'}`);
    await sleep(1500);
  }

  // Step 2: Process queue (creates/updates vehicles)
  for (let b = 0; b < opts.processBatches; b++) {
    console.log(`\n[process ${b + 1}/${opts.processBatches}]`);
    if (opts.dryRun) continue;

    const result = await postJson(processQueueUrl, INVOKE_KEY, {
      batch_size: opts.batchSize,
      priority_only: opts.priorityOnly,
      fast_mode: opts.fastMode,
      skip_image_upload: opts.skipImageUpload,
    });

    const processed = result?.processed ?? 0;
    const succeeded = result?.succeeded ?? 0;
    const failed = result?.failed ?? 0;
    const duplicates = result?.duplicates ?? 0;
    console.log(`  processed=${processed} succeeded=${succeeded} failed=${failed} duplicates=${duplicates}`);

    // Stop early if queue is empty
    if (!processed || processed === 0) {
      console.log('  queue empty (or nothing eligible). stopping.');
      break;
    }

    await sleep(2500);
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



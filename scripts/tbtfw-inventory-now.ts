#!/usr/bin/env node
/**
 * TBTFW: one-shot inventory ingest (protocol-safe)
 *
 * Flow:
 * - Ensure org exists in `businesses`
 * - Invoke `scrape-multi-source` against https://www.tbtfw.com/inventory to queue /am-inventory/* listings
 * - Drain `import_queue` for that scrape_source via `process-import-queue`
 *
 * This is safe to re-run:
 * - `scrape-multi-source` upserts import_queue rows on listing_url
 * - `process-import-queue` is idempotent (repairs/backfills when vehicle already exists)
 *
 * Usage:
 *   npm run inventory:tbtfw -- --max-results 400 --import-batches 40 --import-batch-size 5
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY (required)
 * - SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY (optional; used only if service role missing for invoke)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Options = {
  maxResults: number;
  importBatches: number;
  importBatchSize: number;
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
    maxResults: 400,
    importBatches: 40,
    importBatchSize: 5,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-results' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) opts.maxResults = Math.max(1, Math.min(5000, Math.floor(n)));
      continue;
    }
    if (a === '--import-batches' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) opts.importBatches = Math.max(0, Math.min(20000, Math.floor(n)));
      continue;
    }
    if (a === '--import-batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) opts.importBatchSize = Math.max(1, Math.min(25, Math.floor(n)));
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
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 600)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ensureTbtfwOrg(supabase: any): Promise<string> {
  const website = 'https://www.tbtfw.com';
  const { data: existing, error: selErr } = await supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .eq('website', website)
    .maybeSingle();
  if (selErr) throw new Error(`businesses select failed: ${selErr.message}`);
  if (existing?.id) return existing.id;

  const { data: created, error: insErr } = await supabase
    .from('businesses')
    .insert({
      business_name: 'TBTFW',
      type: 'dealer',
      business_type: 'dealership',
      website,
      is_public: true,
      is_verified: false,
      metadata: {
        inventory_url: 'https://www.tbtfw.com/inventory',
        source_type: 'dealer_website',
        discovered_from: 'manual_ingest',
        discovered_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`businesses insert failed: ${insErr.message}`);
  if (!created?.id) throw new Error('businesses insert failed: missing id');
  return created.id;
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    null;
  const INVOKE_KEY =
    SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (required)');
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key (service role or anon) to invoke Edge Functions');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const inventoryUrl = 'https://www.tbtfw.com/inventory';
  const scrapeMultiSourceUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
  const processImportUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-import-queue`;

  console.log('TBTFW inventory ingest');
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`Inventory URL: ${inventoryUrl}`);
  console.log(`Max results (queue): ${opts.maxResults}`);
  console.log(`Import batches: ${opts.importBatches} (batch_size=${opts.importBatchSize})`);

  const orgId = await ensureTbtfwOrg(supabase);
  console.log(`Organization ID: ${orgId}`);

  if (opts.dryRun) {
    console.log('Dry run: skipping scrape + import processing.');
    return;
  }

  // 1) Queue inventory listings (idempotent upsert on listing_url)
  const scrapeOut = await postJson(scrapeMultiSourceUrl, INVOKE_KEY, {
    source_url: inventoryUrl,
    source_type: 'dealer_website',
    organization_id: orgId,
    max_results: opts.maxResults,
    extract_listings: true,
    extract_dealer_info: true,
    use_llm_extraction: true,
    include_sold: false,
    force_listing_status: 'in_stock',
    cheap_mode: false,
  });

  const scrapeSourceId = scrapeOut?.source_id || null;
  console.log(`Queued listings: ${scrapeOut?.listings_queued ?? 0} (found=${scrapeOut?.listings_found ?? 0})`);
  if (!scrapeSourceId) {
    throw new Error(`scrape-multi-source did not return source_id: ${JSON.stringify(scrapeOut).slice(0, 600)}`);
  }
  console.log(`Scrape source ID: ${scrapeSourceId}`);

  // 2) Drain import queue for this scrape source
  for (let i = 0; i < opts.importBatches; i++) {
    const out = await postJson(processImportUrl, INVOKE_KEY, {
      batch_size: opts.importBatchSize,
      priority_only: false,
      source_id: scrapeSourceId,
      fast_mode: true,
      // Important: keep images as external URLs immediately; downloading can run later.
      skip_image_upload: true,
    });
    const processed = Number(out?.processed || 0);
    console.log(JSON.stringify({ i: i + 1, processed, succeeded: out?.succeeded, failed: out?.failed }, null, 0));
    if (!processed) break;
    await sleep(1200);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



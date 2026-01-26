#!/usr/bin/env node
/**
 * BaT Local Partners: inventory "meat" backfill
 *
 * Goal: take already-indexed BaT Local Partners orgs and fill:
 * - inventory queue entries (organization_inventory_sync_queue)
 * - inventory scrape runs (process-inventory-sync-queue)
 * - vehicle creation + dealer_inventory rows (process-import-queue)
 *
 * This is safe to re-run:
 * - inventory queue is UNIQUE(org_id, run_mode) and we UPSERT
 * - scrape-multi-source upserts import_queue rows on listing_url
 * - process-import-queue is idempotent and repairs dealer_inventory relationships
 *
 * Usage:
 *   npm run inventory:bat-local-partners -- --limit 50
 *   npm run inventory:bat-local-partners -- --resume-from 200 --run-mode current
 *
 * Flags:
 * - --limit N
 * - --resume-from N
 * - --run-mode current|sold|both   (default current)
 * - --batch-size N                 (queue upsert chunk size; default 50)
 * - --process-inventory-batches N  (how many process-inventory-sync-queue calls; default 10)
 * - --process-import-batches N     (how many process-import-queue calls after; default 30)
 * - --import-batch-size N          (process-import-queue batch_size; default 5)
 * - --dry-run
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY (required for queue upserts)
 * - (invoke auth): service role preferred; anon key also works for function invocation in many setups
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type RunMode = 'current' | 'sold' | 'both';

type Options = {
  limit: number | null;
  resumeFrom: number;
  runMode: RunMode;
  batchSize: number;
  processInventoryBatches: number;
  processImportBatches: number;
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
    limit: null,
    resumeFrom: 0,
    runMode: 'current',
    batchSize: 50,
    processInventoryBatches: 10,
    processImportBatches: 30,
    importBatchSize: 5,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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
    if (a === '--run-mode' && argv[i + 1]) {
      const v = String(argv[++i]).trim();
      if (v === 'current' || v === 'sold' || v === 'both') opts.runMode = v;
      continue;
    }
    if (a === '--batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.batchSize = Number.isFinite(n) ? Math.max(10, Math.min(200, Math.floor(n))) : 50;
      continue;
    }
    if (a === '--process-inventory-batches' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.processInventoryBatches = Number.isFinite(n) ? Math.max(0, Math.min(5000, Math.floor(n))) : 10;
      continue;
    }
    if (a === '--process-import-batches' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.processImportBatches = Number.isFinite(n) ? Math.max(0, Math.min(20000, Math.floor(n))) : 30;
      continue;
    }
    if (a === '--import-batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.importBatchSize = Number.isFinite(n) ? Math.max(1, Math.min(25, Math.floor(n))) : 5;
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
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    null;
  const INVOKE_KEY =
    SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for inventory queue upserts');
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key (service role or anon) to invoke Edge Functions');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  console.log('BaT Local Partners: inventory backfill');
  console.log(`run_mode: ${opts.runMode}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);

  // Select BaT local partners orgs. Prefer discovered_via; fallback to metadata presence.
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, discovered_via, metadata')
    .or('discovered_via.eq.bat_local_partners,metadata->bat_local_partners.not.is.null')
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) throw new Error(`businesses select failed: ${error.message}`);

  const all = Array.isArray(orgs) ? orgs : [];
  const sliced0 = all.slice(opts.resumeFrom);
  const sliced = typeof opts.limit === 'number' ? sliced0.slice(0, opts.limit) : sliced0;

  console.log(`Organizations found: ${all.length}`);
  console.log(`To enqueue: ${sliced.length} (resumeFrom=${opts.resumeFrom}, limit=${opts.limit ?? 'none'})`);

  if (!opts.dryRun) {
    // Upsert into inventory sync queue (UNIQUE(org_id, run_mode))
    let enqueued = 0;
    for (let i = 0; i < sliced.length; i += opts.batchSize) {
      const chunk = sliced.slice(i, i + opts.batchSize);
      const rows = chunk.map((o: any) => ({
        organization_id: o.id,
        run_mode: opts.runMode,
        status: 'pending',
        attempts: 0,
        last_error: null,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      }));

      const { error: upErr } = await supabase
        .from('organization_inventory_sync_queue')
        .upsert(rows, { onConflict: 'organization_id,run_mode' } as any);
      if (upErr) throw new Error(`organization_inventory_sync_queue upsert failed: ${upErr.message}`);

      enqueued += rows.length;
      process.stdout.write(`Enqueued ${enqueued}/${sliced.length}\n`);
      await sleep(250);
    }
  }

  if (opts.dryRun) return;

  const processInventoryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-inventory-sync-queue`;
  const processImportUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-import-queue`;

  console.log(`\nProcessing inventory sync queue (${opts.processInventoryBatches} batches)...`);
  for (let i = 0; i < opts.processInventoryBatches; i++) {
    const out = await postJson(processInventoryUrl, INVOKE_KEY, { batch_size: 10, max_results: 200, max_results_sold: 200 });
    console.log(JSON.stringify({ i: i + 1, ...out }, null, 0));
    await sleep(1200);
  }

  console.log(`\nProcessing import queue (${opts.processImportBatches} batches, batch_size=${opts.importBatchSize})...`);
  for (let i = 0; i < opts.processImportBatches; i++) {
    const out = await postJson(processImportUrl, INVOKE_KEY, {
      batch_size: opts.importBatchSize,
      priority_only: false,
      fast_mode: true,
      skip_image_upload: true,
    });
    console.log(JSON.stringify({ i: i + 1, ...out }, null, 0));
    // Stop early if queue drained
    if (!out?.processed || out?.processed === 0) break;
    await sleep(1500);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



#!/usr/bin/env node
/**
 * Backfill missing images for "half-done" profiles.
 *
 * Strategy:
 * - Query Postgres for vehicles that have origin_metadata.image_urls but no vehicle_images yet.
 * - Invoke Edge Function `backfill-images` to persist them to Storage + vehicle_images.
 *
 * Usage:
 *   tsx scripts/backfill-missing-images.ts --limit 200 --delay-ms 300
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Options = {
  limit: number;
  delayMs: number;
  maxImagesPerVehicle: number;
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
  const opts: Options = { limit: 200, delayMs: 250, maxImagesPerVehicle: 120, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) opts.limit = Math.max(1, Math.min(2000, Number(argv[++i])));
    if (a === '--delay-ms' && argv[i + 1]) opts.delayMs = Math.max(0, Math.min(5000, Number(argv[++i])));
    if (a === '--max-images' && argv[i + 1]) opts.maxImagesPerVehicle = Math.max(1, Math.min(5000, Number(argv[++i])));
    if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson(url: string, bearer: string, body: any): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
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
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (service role required)');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const backfillUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/backfill-images`;

  const { data: rows, error } = await supabase.rpc('get_vehicle_image_backfill_candidates', { p_limit: opts.limit });
  if (error) throw error;

  const items = Array.isArray(rows) ? rows : [];
  console.log(`Backfill missing images: candidates=${items.length} limit=${opts.limit} delay_ms=${opts.delayMs} max_images=${opts.maxImagesPerVehicle} mode=${opts.dryRun ? 'dry-run' : 'execute'}`);

  let ok = 0;
  let fail = 0;

  for (const it of items) {
    const vehicleId = it.vehicle_id;
    const imageUrls = Array.isArray(it.image_urls) ? it.image_urls.filter(Boolean) : [];
    if (!vehicleId || imageUrls.length === 0) continue;

    const capped = imageUrls.slice(0, opts.maxImagesPerVehicle);
    try {
      if (opts.dryRun) {
        console.log(`[dry] vehicle=${vehicleId} images=${capped.length}`);
      } else {
        const r = await postJson(backfillUrl, SERVICE_ROLE, {
          vehicle_id: vehicleId,
          image_urls: capped,
          source: 'missing_images_backfill',
          run_analysis: false,
          // Let the function continue-chain for larger sets.
          max_images: 0,
          continue: true,
          sleep_ms: 150,
          max_runtime_ms: 25000,
        });
        if (!r?.success) throw new Error(r?.error || 'backfill-images failed');
        ok++;
        if (ok % 25 === 0) console.log(`progress ok=${ok} fail=${fail}`);
      }
    } catch (e: any) {
      fail++;
      console.warn(`failed vehicle=${vehicleId}: ${e?.message || String(e)}`);
    }

    if (opts.delayMs > 0) await sleep(opts.delayMs);
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



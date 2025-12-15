#!/usr/bin/env node
/**
 * Classic.com Auctions Index + Deep Import
 *
 * 1) Call `scrape-multi-source` on https://www.classic.com/auctions/ to enqueue listing URLs into import_queue.
 * 2) Read queued URLs for that source and invoke `import-classic-auction` for each.
 * 3) Mark queue items complete with vehicle_id.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Options = {
  maxListings: number;
  limit: number;
  delayMs: number;
  dryRun: boolean;
};

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
  const opts: Options = { maxListings: 2000, limit: 1200, delayMs: 250, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-listings' && argv[i + 1]) opts.maxListings = Math.max(1, Math.min(5000, Number(argv[++i])));
    if (a === '--limit' && argv[i + 1]) opts.limit = Math.max(1, Math.min(5000, Number(argv[++i])));
    if (a === '--delay-ms' && argv[i + 1]) opts.delayMs = Math.max(0, Math.min(5000, Number(argv[++i])));
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
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
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key to invoke Edge Functions');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for DB updates');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const scrapeMultiSourceUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
  const importClassicUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-classic-auction`;

  console.log(`Classic.com auctions import`);
  console.log(`Index: https://www.classic.com/auctions/`);
  console.log(`max_listings=${opts.maxListings} limit=${opts.limit} delay_ms=${opts.delayMs} mode=${opts.dryRun ? 'dry-run' : 'execute'}`);

  let sourceId: string | null = null;
  if (!opts.dryRun) {
    const seed = await postJson(scrapeMultiSourceUrl, INVOKE_KEY, {
      source_url: 'https://www.classic.com/auctions/',
      source_type: 'auction',
      extract_listings: true,
      extract_dealer_info: false,
      use_llm_extraction: false,
      cheap_mode: true,
      max_listings: opts.maxListings,
    });
    if (!seed?.success) throw new Error(seed?.error || 'scrape-multi-source failed');
    sourceId = seed.source_id || null;
    console.log(`Seeded: listings_found=${seed.listings_found} queued=${seed.listings_queued} source_id=${sourceId}`);
  }

  if (!sourceId) {
    console.log('No source_id (dry-run or seed failure); exiting.');
    return;
  }

  const { data: queueRows, error: qErr } = await supabase
    .from('import_queue')
    .select('id, listing_url, status')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  if (qErr) throw qErr;

  const pending = (queueRows || []).filter((r: any) => r.status !== 'complete');
  console.log(`Queue rows fetched=${queueRows?.length || 0} pending=${pending.length}`);

  let ok = 0;
  let fail = 0;

  for (const row of pending) {
    const url = String(row.listing_url || '');
    if (!url) continue;
    try {
      if (opts.dryRun) {
        console.log(`[dry] would import ${url}`);
        continue;
      }

      const r = await postJson(importClassicUrl, INVOKE_KEY, { url });
      if (!r?.success) throw new Error(r?.error || 'import-classic-auction failed');

      const vehicleId = r.vehicle_id || null;
      if (vehicleId) {
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }

      ok++;
      if (ok % 25 === 0) console.log(`progress ok=${ok} fail=${fail}`);
    } catch (e: any) {
      fail++;
      console.warn(`failed ${url}: ${e?.message || String(e)}`);
    }

    if (opts.delayMs > 0) await sleep(opts.delayMs);
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});



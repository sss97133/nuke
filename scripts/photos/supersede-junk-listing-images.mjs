#!/usr/bin/env node
// Feed a list of vehicles to supersede_junk_listing_images: supersede listing page furniture (sidebar thumbnails,
// flags, web-assets, SVGs) and Cars & Bids cards for other lots captured from the same page, and give each such cover
// the vehicle's own best photo through the cover recompute.
//
//   dotenvx run -- node scripts/photos/supersede-junk-listing-images.mjs <list.json> [--apply] [--batch N] [--limit N] [--log <file>]
//
// The list is a JSON array of vehicle ids or of {vehicle_id} objects, or JSONL of either. Batches default to 25
// vehicles (at most 100, the writer's bound). Without --apply every call is a dry run: the writer reports what it would
// supersede and repair and changes nothing. A failed call (network, 5xx, empty body) is retried 4 times, then the run
// stops. Each call's result is one JSONL line in --log (default ~/nuke-logs/junk-listing-images-<date>/run-<time>.jsonl);
// the vehicles with no usable photo are collected in <log>.no-usable-image.json. A rerun of the same list is a no-op.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const opts = { apply: false, batch: 25, limit: Infinity, list: null, log: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--apply') opts.apply = true;
    else if (a === '--log') opts.log = value();
    else if (a === '--batch') opts.batch = Number(value());
    else if (a === '--limit') opts.limit = Number(value());
    else if (!a.startsWith('--') && !opts.list) opts.list = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.list) throw new Error('name a list file');
  if (!Number.isInteger(opts.batch) || opts.batch < 1 || opts.batch > 100) throw new Error('--batch is 1 to 100');
  if (opts.limit !== Infinity && (!Number.isInteger(opts.limit) || opts.limit < 1)) throw new Error('--limit is a positive integer');
  return opts;
}

// Vehicle ids from a JSON array or JSONL, as bare ids or {vehicle_id}; duplicates dropped, order kept.
export function readList(text) {
  const t = text.trim();
  const items = t.startsWith('[') ? JSON.parse(t) : t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const ids = items.map((it, n) => {
    const id = typeof it === 'string' ? it : it?.vehicle_id;
    if (!UUID.test(id ?? '')) throw new Error(`item ${n + 1}: needs a vehicle id`);
    return id.toLowerCase();
  });
  return [...new Set(ids)];
}

export function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function addTally(total, tally) {
  for (const [k, v] of Object.entries(tally ?? {})) total[k] = (total[k] ?? 0) + v;
  return total;
}

async function credentials() {
  const { projectSecretKey } = await import('../../supabase/functions/_shared/supabaseKeys.ts');
  const key = process.env.SUPABASE_SECRET_KEY ?? projectSecretKey((name) => process.env[name]);
  if (!key?.startsWith('sb_secret_')) throw new Error('a sb_secret_ key is required (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY)');
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!url?.startsWith('https://')) throw new Error('SUPABASE_URL is required');
  return { url: url.replace(/\/$/, ''), key };
}

async function callWriter(creds, ids, apply) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${creds.url}/rest/v1/rpc/supersede_junk_listing_images`, {
        method: 'POST',
        headers: { apikey: creds.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_vehicle_ids: ids, p_apply: apply }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.text();
      if (res.status >= 400 && res.status < 500) return { http: res.status, error: body.slice(0, 500) };
      if (!res.ok || !body.trim()) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
      return { http: res.status, result: JSON.parse(body) };
    } catch (err) {
      if (attempt >= 5) return { http: 0, error: err.message };
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

async function feed(opts) {
  const creds = await credentials();
  const ids = readList(readFileSync(opts.list, 'utf8')).slice(0, opts.limit);
  const stamp = new Date().toISOString();
  const log = opts.log ?? join(homedir(), 'nuke-logs', `junk-listing-images-${stamp.slice(0, 10).replaceAll('-', '')}`,
    `run-${stamp.replace(/[:.]/g, '')}.jsonl`);
  mkdirSync(dirname(log), { recursive: true });
  const total = {};
  const noImage = [];
  const parts = batches(ids, opts.batch);
  for (const [n, part] of parts.entries()) {
    const out = await callWriter(creds, part, opts.apply);
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), batch: n + 1, of: parts.length, apply: opts.apply,
      sent: part.length, ...out }) + '\n');
    if (out.error) throw new Error(`batch ${n + 1}: HTTP ${out.http} ${out.error.slice(0, 200)} (log ${log})`);
    addTally(total, out.result.tally);
    noImage.push(...(out.result.no_usable_image ?? []));
    console.log(JSON.stringify({ batch: n + 1, of: parts.length, tally: out.result.tally }));
    await new Promise((r) => setTimeout(r, 200));
  }
  writeFileSync(`${log}.no-usable-image.json`, JSON.stringify(noImage));
  console.log(JSON.stringify({ apply: opts.apply, vehicles: ids.length, total, log }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await feed(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

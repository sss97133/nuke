#!/usr/bin/env node
// Send a listing's photo URLs to the fb-photo-upload function with the project secret key.
//
//   dotenvx run -- node scripts/photos/upload-listing-photos.mjs <vehicle_id> <urls file> [--shifted] [--batch N] [--dry-run]
//
// fb-photo-upload stores each photo under <vehicle_id>/fb-marketplace/ in the vehicle-photos bucket and answers the
// service key only, so a browser page cannot call it. Collect the URLs in the page, save them to a file (one per
// line, or a JSON array) and run this. --shifted reads URLs whose characters the collecting page moved up one code
// point each, and moves them back. The function fetches the URLs itself, one after another: 3 per call by default.
// Prints one line per call and a total. Exits 1 when a photo failed or none was stored, and 2 before any call when the
// arguments, the file, one of its entries or the key is wrong.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNCTION_ROUTE = '/functions/v1/fb-photo-upload';

export function parseArgs(argv) {
  const opts = { vehicleId: null, file: null, shifted: false, batch: 3, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shifted') opts.shifted = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--batch') {
      if (i + 1 >= argv.length) throw new Error('--batch needs a value');
      opts.batch = Number(argv[++i]);
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 2) throw new Error('usage: upload-listing-photos.mjs <vehicle_id> <urls file> [--shifted] [--batch N] [--dry-run]');
  [opts.vehicleId, opts.file] = rest;
  if (!UUID.test(opts.vehicleId)) throw new Error('the first argument must be a vehicle id');
  if (!Number.isInteger(opts.batch) || opts.batch < 1 || opts.batch > 10) throw new Error('--batch must be a whole number from 1 to 10');
  return opts;
}

export function unshift(text) {
  return Array.from(text, (c) => String.fromCodePoint(c.codePointAt(0) - 1)).join('');
}

// One URL per line, or a JSON array of strings. Blank lines and repeats are dropped; anything that is not an https
// URL is an error, so a wrong --shifted setting fails here instead of sending junk to the function.
export function readUrls(text, { shifted = false } = {}) {
  const trimmed = text.trim();
  let items;
  if (trimmed.startsWith('[')) {
    items = JSON.parse(trimmed);
    if (!Array.isArray(items) || items.some((u) => typeof u !== 'string')) throw new Error('the JSON file must be an array of strings');
  } else {
    items = trimmed.split(/\r?\n/);
  }
  const urls = [];
  for (const raw of items) {
    const line = raw.trim();
    if (!line) continue;
    const url = shifted ? unshift(line) : line;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`not a URL (entry ${urls.length + 1}); check --shifted`);
    }
    if (parsed.protocol !== 'https:') throw new Error(`not an https URL (entry ${urls.length + 1}); check --shifted`);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function credentials() {
  const { projectSecretKey } = await import('../../supabase/functions/_shared/supabaseKeys.ts');
  const key = process.env.SUPABASE_SECRET_KEY ?? projectSecretKey((name) => process.env[name]);
  if (!key?.startsWith('sb_secret_')) throw new Error('a sb_secret_ key is required (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY)');
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!url?.startsWith('https://')) throw new Error('SUPABASE_URL is required');
  return { url: url.replace(/\/$/, ''), key };
}

// Posts the URLs in batches and returns the counts. A call the function refuses, or that fails on the way, counts
// every URL in it as failed: nothing is assumed stored without the function saying so.
export async function send({ url, key }, { vehicleId, batch }, urls, { fetchImpl = fetch, log = console.log } = {}) {
  const total = { urls: urls.length, stored: 0, failed: 0 };
  for (const [n, group] of batches(urls, batch).entries()) {
    const label = `call ${n + 1}`;
    let res;
    let text;
    try {
      res = await fetchImpl(url + FUNCTION_ROUTE, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, image_urls: group }),
        signal: AbortSignal.timeout(180_000),
      });
      text = await res.text();
    } catch (err) {
      total.failed += group.length;
      log(`${label}: ${group.length} failed, request error: ${err.message}`);
      continue;
    }
    if (!res.ok) {
      total.failed += group.length;
      log(`${label}: ${group.length} failed, HTTP ${res.status} ${text.slice(0, 160)}`);
      continue;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      total.failed += group.length;
      log(`${label}: ${group.length} failed, the answer was not JSON`);
      continue;
    }
    const stored = Number(body.uploaded ?? 0);
    const failed = group.length - stored;
    total.stored += stored;
    total.failed += failed;
    const reasons = (body.results ?? []).filter((r) => !r.success).map((r) => `#${r.index + 1} ${r.error}`);
    log(`${label}: stored ${stored}, failed ${failed}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
  }
  return total;
}

// Everything that can be wrong before a call is made: the arguments, the file and its entries. Each throws, and main
// answers all of them with exit 2, so a wrapper that retries on exit 1 (an upload that failed) never resends bad input.
export function inputs(argv, { read = (file) => readFileSync(file, 'utf8') } = {}) {
  const opts = parseArgs(argv);
  let text;
  try {
    text = read(opts.file);
  } catch (err) {
    throw new Error(`cannot read the urls file (${err.code ?? 'error'})`);
  }
  const urls = readUrls(text, { shifted: opts.shifted });
  if (urls.length === 0) throw new Error('the file holds no URL');
  return { opts, urls };
}

async function main() {
  let opts, urls, target;
  try {
    ({ opts, urls } = inputs(process.argv.slice(2)));
    if (!opts.dryRun) target = await credentials();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.dryRun) {
    console.log(`dry run: ${urls.length} urls for vehicle ${opts.vehicleId} in ${batches(urls, opts.batch).length} calls; nothing sent`);
    return;
  }
  const total = await send(target, opts, urls);
  console.log(`total: ${total.urls} urls, stored ${total.stored}, failed ${total.failed}`);
  if (total.failed > 0 || total.stored === 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

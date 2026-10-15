#!/usr/bin/env node
// Find the phone rows that point at another photo's bytes, and hold them through hold_wrong_byte_images.
//
//   dotenvx run -- node scripts/photos/hold-wrong-byte-rows.mjs --build <list.jsonl> --user <uid>
//   dotenvx run -- node scripts/photos/hold-wrong-byte-rows.mjs <list.jsonl> [--apply] [--limit N] [--batch N] [--log <file>]
//
// The phone stored photos at users/<uid>/capture-relay/<camera filename>; names wrap at IMG_9999, and an upload that
// met an existing object took "already exists" as success, so a later photo's row points at an earlier photo's object.
// --build reads every capture_relay_ios row of the user, downloads each storage object a row points at and hashes it
// (the row's file_hash is the SHA-256 of the bytes the phone uploaded), and writes one line per row whose file_hash is
// not its object's hash: {image_id, storage_path, object_sha256, row_file_hash}. For each such photo it also hashes the
// user's other rows with that file_hash (an iphoto copy, say) and names the earliest whose object matches as the
// canonical row. Object hashes are cached in <list>.objects.jsonl, so a rerun resumes.
// Feeding sends the list to hold_wrong_byte_images in batches (default 100, at most 500). Without --apply every call is
// a dry run: the writer reports what it would hold and link and changes nothing. Each call's result is one JSONL line in
// --log (default ~/nuke-logs/wrong-bytes-<date>/run-<time>.jsonl). Re-uploads that land later under a content path
// are found by the writer itself, so rerunning the same list links them.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const BUCKET = 'vehicle-photos';

export function parseArgs(argv) {
  const opts = { apply: false, batch: 100, limit: Infinity, list: null, build: false, user: null, log: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--apply') opts.apply = true;
    else if (a === '--build') { opts.build = true; opts.list = value(); }
    else if (a === '--user') opts.user = value();
    else if (a === '--log') opts.log = value();
    else if (a === '--batch') opts.batch = Number(value());
    else if (a === '--limit') opts.limit = Number(value());
    else if (!a.startsWith('--') && !opts.list) opts.list = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.list) throw new Error('name a list file');
  if (!Number.isInteger(opts.batch) || opts.batch < 1 || opts.batch > 500) throw new Error('--batch is 1 to 500');
  if (opts.limit !== Infinity && (!Number.isInteger(opts.limit) || opts.limit < 1)) throw new Error('--limit is a positive integer');
  if (opts.build && !UUID.test(opts.user ?? '')) throw new Error('--build needs --user <uuid>');
  if (opts.build && opts.apply) throw new Error('--build only writes the list; feed it in a second run');
  return opts;
}

// The object a row points at: its storage_path, else the path inside its public URL.
export function pathOf(row) {
  if (row.storage_path) return row.storage_path;
  const m = /\/storage\/v1\/object\/public\/vehicle-photos\/(.+)$/.exec(row.image_url ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

export const isContentPath = (row) =>
  Boolean(row.file_hash) && (pathOf(row) ?? '').startsWith(`users/${row.user_id}/capture-relay/${row.file_hash}/`);

// Rows whose file_hash is not the SHA-256 of the object they point at. objectSha maps path -> sha256.
export function findWrongRows(rows, objectSha) {
  const wrong = [];
  for (const r of rows) {
    const p = pathOf(r);
    if (!p || !r.file_hash) continue;
    const sha = objectSha.get(p);
    if (!sha) throw new Error(`no object hash for ${r.id}`);
    if (sha !== r.file_hash) wrong.push({ image_id: r.id, storage_path: p, object_sha256: sha, row_file_hash: r.file_hash });
  }
  return wrong.sort((a, b) => a.image_id.localeCompare(b.image_id));
}

// The earliest copy of a photo whose object hashes to its file_hash, among rows that are not wrong themselves.
// Content-path rows are left to the writer, which prefers them.
export function chooseCanonical(fileHash, siblings, objectSha, wrongIds) {
  return siblings
    .filter((s) => s.file_hash === fileHash && !s.is_superseded && !wrongIds.has(s.id) && !isContentPath(s))
    .filter((s) => objectSha.get(pathOf(s)) === fileHash)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0] ?? null;
}

export function readList(text) {
  return text.split('\n').filter((l) => l.trim()).map((l, n) => {
    const it = JSON.parse(l);
    if (!UUID.test(it.image_id ?? '') || !it.storage_path || !HEX64.test(it.object_sha256 ?? '')) {
      throw new Error(`line ${n + 1}: needs image_id, storage_path, object_sha256`);
    }
    const item = { image_id: it.image_id, storage_path: it.storage_path, object_sha256: it.object_sha256 };
    if (it.canonical_id) {
      Object.assign(item, { canonical_id: it.canonical_id, canonical_storage_path: it.canonical_storage_path,
        canonical_sha256: it.canonical_sha256 });
    }
    return item;
  });
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

async function getJson({ url, key }, route) {
  const res = await fetch(url + route, { headers: { apikey: key }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`GET ${route.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function hashObject({ url, key }, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const route = `/storage/v1/object/authenticated/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
      const res = await fetch(url + route, { headers: { apikey: key }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return { p: path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    } catch (err) {
      if (attempt >= 4) throw new Error(`object ${path}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function hashAll(creds, paths, cacheFile) {
  const sha = new Map();
  if (existsSync(cacheFile)) {
    for (const l of readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) {
      const d = JSON.parse(l);
      sha.set(d.p, d.sha256);
    }
  }
  const todo = [...new Set(paths)].filter((p) => !sha.has(p));
  for (let i = 0; i < todo.length; i += 8) {
    for (const d of await Promise.all(todo.slice(i, i + 8).map((p) => hashObject(creds, p)))) {
      appendFileSync(cacheFile, JSON.stringify(d) + '\n');
      sha.set(d.p, d.sha256);
    }
    if (i % 400 === 0) console.error(`hashed ${i + 8 > todo.length ? todo.length : i + 8} of ${todo.length}`);
  }
  return sha;
}

async function build(opts) {
  const creds = await credentials();
  const cols = 'id,user_id,storage_path,image_url,file_hash,created_at,is_superseded';
  const rows = [];
  for (let last = '00000000-0000-0000-0000-000000000000'; ;) {
    const page = await getJson(creds, `/rest/v1/vehicle_images?select=${cols}&user_id=eq.${opts.user}` +
      `&source=eq.capture_relay_ios&id=gt.${last}&order=id&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) break;
    last = page[page.length - 1].id;
  }
  const cache = `${opts.list}.objects.jsonl`;
  const located = rows.filter((r) => pathOf(r));
  let sha = await hashAll(creds, located.map(pathOf), cache);
  const wrong = findWrongRows(located, sha);
  const wrongIds = new Set(wrong.map((w) => w.image_id));

  // Other rows of the same photos, then the hashes of their objects.
  const photos = [...new Set(wrong.map((w) => w.row_file_hash))];
  const siblings = [];
  for (const chunk of batches(photos, 40)) {
    siblings.push(...await getJson(creds, `/rest/v1/vehicle_images?select=${cols}&user_id=eq.${opts.user}` +
      `&file_hash=in.(${chunk.join(',')})`));
  }
  const candidates = siblings.filter((s) => !wrongIds.has(s.id) && !s.is_superseded && !isContentPath(s) && pathOf(s));
  sha = await hashAll(creds, candidates.map(pathOf), cache);
  let named = 0;
  const lines = wrong.map((w) => {
    const c = chooseCanonical(w.row_file_hash, candidates, sha, wrongIds);
    if (!c) return w;
    named += 1;
    return { ...w, canonical_id: c.id, canonical_storage_path: pathOf(c), canonical_sha256: w.row_file_hash };
  });
  writeFileSync(opts.list, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  console.log(JSON.stringify({
    measured_at: new Date().toISOString(), user_id: opts.user, rows: rows.length, rows_with_object: located.length,
    rows_hashed_against_object: located.filter((r) => r.file_hash).length, objects_hashed: new Set(located.map(pathOf)).size,
    wrong_rows: wrong.length, wrong_photos: photos.length, wrong_paths: new Set(wrong.map((w) => w.storage_path)).size,
    with_canonical_copy: named, list: opts.list,
  }));
}

async function feed(opts) {
  const creds = await credentials();
  const items = readList(readFileSync(opts.list, 'utf8')).slice(0, opts.limit);
  const stamp = new Date().toISOString();
  const log = opts.log ?? join(homedir(), 'nuke-logs', `wrong-bytes-${stamp.slice(0, 10).replaceAll('-', '')}`,
    `run-${stamp.replace(/[:.]/g, '')}.jsonl`);
  mkdirSync(dirname(log), { recursive: true });
  const run = `hold-wrong-byte-rows.mjs ${opts.apply ? 'apply' : 'dry-run'} ${stamp}`;
  const total = {};
  const parts = batches(items, opts.batch);
  for (const [n, part] of parts.entries()) {
    const res = await fetch(`${creds.url}/rest/v1/rpc/hold_wrong_byte_images`, {
      method: 'POST',
      headers: { apikey: creds.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_items: part, p_apply: opts.apply, p_run: run }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.text();
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), batch: n + 1, of: parts.length, apply: opts.apply,
      sent: part.length, http: res.status, result: res.ok ? JSON.parse(body) : body.slice(0, 500) }) + '\n');
    if (!res.ok) throw new Error(`batch ${n + 1}: HTTP ${res.status} ${body.slice(0, 200)} (log ${log})`);
    const out = JSON.parse(body);
    addTally(total, out.tally);
    console.log(JSON.stringify({ batch: n + 1, of: parts.length, tally: out.tally, vehicles: out.vehicles }));
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(JSON.stringify({ apply: opts.apply, items: items.length, total, log }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    await (opts.build ? build(opts) : feed(opts));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

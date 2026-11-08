#!/usr/bin/env node
// Offline perceptual match for the garage evidence chain. The SQL preview / derive_vehicle_relationships no longer scans
// vehicle_images for Hamming distance (it timed out); it reads the dhash_matches CTE, which this script fills.
//
//   node scripts/garage/dhash-match.mjs --dry-run --user <uuid> [--max-distance 6] [--out /workspace/dhash_matches.sql]
//
// 1. Reads the account's origin-unknown photos (user_upload, bucket-root '<uuid>.jpg' or 'unorganized/' path, no camera make /
//    model, taken_at or GPS) that have no dhash yet, with the vehicle's year / make / model family.
// 2. Computes their dhash locally (64 bits, 9x8 grayscale, 16 hex characters) with `sharp`, which must be installed
//    (npm i --no-save sharp); the decoder is the only dependency and is imported lazily.
// 3. Reads scraped listing images WITH a dhash from vehicles of the same make, year +-1 and model family, and compares locally.
// 4. Prints the dhash_matches VALUES CTE (image_id, matched_image_id, matched_source, hamming_distance) to paste over the
//    placeholder; with no match it prints the empty placeholder. Nothing is written to a database (--dry-run is the only mode).
// SQL runs through psql + DATABASE_URL (read-only session) or the management API + SUPABASE_ACCESS_TOKEN, like scene-sessions.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { publicUrl } from './scene-sessions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT = 'qkgaybvrernstplzjaam';
const SCRAPED = `(regexp_replace(lower(btrim(coalesce(s.source, ''))), '[-\\s]+', '_', 'g')
        IN ('bat', 'mecum', 'classic_com', 'classiccom', 'craigslist', 'url_scraper', 'cars_and_bids', 'carsandbids')
      OR lower(coalesce(s.image_url, '')) ~ '^https?://([a-z0-9-]+\\.)*(bringatrailer|carsandbids|mecum|classic|craigslist|hemmings|pcarmarket|cargurus|autotrader)\\.(com|org)(/|$)')`;

// Origin-unknown photos of the account without a dhash.
export function unknownPhotosSql(userId) {
  if (!UUID.test(userId ?? '')) throw new Error('--user must be a uuid');
  return `SELECT coalesce(jsonb_agg(jsonb_build_object('image_id', vi.id, 'image_url', vi.image_url, 'storage_path', vi.storage_path,
         'year', v.year, 'make', lower(btrim(v.make)), 'family', normalize_vehicle_model_family(v.model))), '[]'::jsonb) AS r
  FROM vehicle_images vi JOIN vehicles v ON v.id = vi.vehicle_id
 WHERE vi.user_id = '${userId.toLowerCase()}'::uuid AND vi.dhash IS NULL
   AND regexp_replace(lower(btrim(coalesce(vi.source, ''))), '[-\\s]+', '_', 'g') = 'user_upload'
   AND lower(coalesce(vi.storage_path, '')) ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+|unorganized/.*)$'
   AND nullif(btrim(vi.exif_data->>'camera_make'), '') IS NULL AND nullif(btrim(vi.exif_data->>'camera_model'), '') IS NULL
   AND vi.taken_at IS NULL AND vi.latitude IS NULL AND vi.longitude IS NULL
   AND v.make IS NOT NULL AND v.year IS NOT NULL AND v.deleted_at IS NULL`;
}

// Scraped listing images with a dhash, from vehicles of the same make, year +-1 and model family.
export function candidatesSql({ year, make, family }) {
  const lit = (t) => `'${String(t).replace(/'/g, "''")}'`;
  if (!Number.isInteger(year)) throw new Error('year must be an integer');
  return `SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'source', s.source, 'dhash', lower(s.dhash))), '[]'::jsonb) AS r
  FROM vehicles v JOIN vehicle_images s ON s.vehicle_id = v.id
 WHERE lower(btrim(v.make)) = ${lit(make)} AND v.year BETWEEN ${year - 1} AND ${year + 1}
   AND normalize_vehicle_model_family(v.model) IS NOT DISTINCT FROM ${family == null ? 'NULL' : lit(family)}
   AND lower(s.dhash) ~ '^[0-9a-f]{16}$' AND ${SCRAPED}`;
}

// dhash from a 9x8 grayscale buffer (row-major, 72 bytes): bit = left pixel brighter than its right neighbour, 64 bits -> 16 hex.
export function dhashFromGray9x8(g) {
  if (g.length !== 72) throw new Error('expected 72 grayscale bytes');
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}
export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// The nearest candidate per photo within maxDistance (ties: smaller id).
export function matchAll(photos, candidatesFor, maxDistance = 6) {
  const out = [];
  for (const p of photos) {
    let best = null;
    for (const c of candidatesFor(p)) {
      if (c.id === p.image_id) continue;
      const d = hamming(p.dhash, c.dhash);
      if (d <= maxDistance && (!best || d < best.d || (d === best.d && c.id < best.c.id))) best = { d, c };
    }
    if (best) out.push({ image_id: p.image_id, matched_image_id: best.c.id, matched_source: best.c.source, hamming_distance: best.d });
  }
  return out;
}

export function valuesCte(matches) {
  const q = (t) => (t == null ? 'NULL::text' : `'${String(t).replace(/'/g, "''")}'`);
  const head = `dhash_matches AS (\n  SELECT t.image_id, t.matched_image_id, t.matched_source, t.hamming_distance\n`;
  if (!matches.length) {
    return head + `    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::int)) t(image_id, matched_image_id, matched_source, hamming_distance)\n   WHERE false -- (dhash_matches)\n),`;
  }
  const rows = matches.map((m) => `(${q(m.image_id)}::uuid, ${q(m.matched_image_id)}::uuid, ${q(m.matched_source)}, ${m.hamming_distance})`);
  return head + `    FROM (VALUES\n      ${rows.join(',\n      ')}) t(image_id, matched_image_id, matched_source, hamming_distance)\n   WHERE true -- (dhash_matches)\n),`;
}

async function runSql(sql) {
  if (process.env.DATABASE_URL) {
    try {
      const out = execFileSync('psql', [process.env.DATABASE_URL, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        { env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' }, encoding: 'utf8', maxBuffer: 1 << 28 });
      return JSON.parse(out.trim());
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`management API ${res.status}`);
    const j = await res.json();
    return typeof j[0].r === 'string' ? JSON.parse(j[0].r) : j[0].r;
  }
  return null;
}

async function dhashOfUrl(sharp, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const raw = await sharp(Buffer.from(await res.arrayBuffer())).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  return dhashFromGray9x8(raw);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  if (!args.includes('--dry-run')) { console.error('--dry-run is required: this script never writes to a database'); process.exit(2); }
  let sql;
  try { sql = unknownPhotosSql(opt('user')); } catch (e) { console.error(e.message); process.exit(2); }
  const photos = await runSql(sql);
  if (!photos) { console.error('no database credentials (DATABASE_URL + psql, or SUPABASE_ACCESS_TOKEN): nothing was run. SQL:\n'); console.log(sql); process.exit(3); }
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { console.error('sharp is not installed (npm i --no-save sharp)'); process.exit(4); }
  const maxD = Number(opt('max-distance', 6));
  const cache = new Map();
  const hashed = [];
  for (const p of photos) {
    const url = publicUrl(p);
    if (!url) continue;
    try { hashed.push({ ...p, dhash: await dhashOfUrl(sharp, url) }); } catch (e) { console.error(`skip ${p.image_id}: ${e.message}`); }
  }
  for (const p of hashed) {
    const k = `${p.year}|${p.make}|${p.family}`;
    if (!cache.has(k)) cache.set(k, await runSql(candidatesSql(p)) ?? []);
  }
  const matches = matchAll(hashed, (p) => cache.get(`${p.year}|${p.make}|${p.family}`) ?? [], maxD);
  const cte = valuesCte(matches);
  const out = opt('out');
  if (out) writeFileSync(out, cte + '\n');
  console.error(`${photos.length} origin-unknown photos without dhash, ${hashed.length} hashed, ${matches.length} matched within ${maxD} bits`);
  console.log(cte);
}

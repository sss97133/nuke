#!/usr/bin/env node
/**
 * scripts/data/readme-stats.mjs
 *
 * Measures the system and rewrites two generated blocks:
 *   README.md               <!-- stats:start --> … <!-- stats:end -->          (the live database)
 *   docs/library/README.md  <!-- library-stats:start --> … <!-- library-stats:end --> (the library's own files)
 *
 * Every database query runs inside `begin read only … commit` on the Supabase
 * Management API (the same path scripts/data/q.sh uses), so this script cannot
 * write to the database. It needs SUPABASE_ACCESS_TOKEN in the environment.
 *
 *   dotenvx run -q -- node scripts/data/readme-stats.mjs            # rewrite both blocks
 *   dotenvx run -q -- node scripts/data/readme-stats.mjs --dry-run  # print them only
 *
 * Scheduled daily by .github/workflows/update-stats.yml. Every number in those
 * blocks comes from here; none is typed by hand.
 */
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'qkgaybvrernstplzjaam';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = resolve(ROOT, 'README.md');
const LIBRARY = resolve(ROOT, 'docs', 'library');
const LIBRARY_README = resolve(LIBRARY, 'README.md');
const DRY = process.argv.includes('--dry-run');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('readme-stats: SUPABASE_ACCESS_TOKEN is not set');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function q(sql, attempt = 1) {
  const query = `begin read only; set local statement_timeout = '45s'; ${sql}; commit;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (res.status === 429 || res.status >= 500) {
    // The Management API rate-limits per token; back off and try again.
    if (attempt >= 5) throw new Error(`gave up after ${attempt} attempts (${res.status}): ${text.slice(0, 200)}`);
    const wait = (Number(res.headers.get('retry-after')) || 15 * attempt) * 1000;
    console.error(`readme-stats: ${res.status} from the API, retrying in ${wait / 1000}s (${attempt}/5)`);
    await sleep(wait);
    return q(sql, attempt + 1);
  }
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* handled below */ }
  if (!res.ok || !Array.isArray(rows)) {
    throw new Error(`query failed (${res.status}): ${text.slice(0, 300)}\n  ${sql.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  // Be polite to production: a short pause between the eight queries.
  await sleep(1500);
  return rows;
}

// Tables reported on, in display order. Rows are the planner's estimate (pg_class.reltuples).
const TABLES = {
  auction_comments: 'Auction comments (the auction log)',
  bat_bids: 'Bids',
  vehicle_observations: 'Observations (the fact log)',
  vehicle_images: 'Images',
  vehicles: 'Vehicles',
  bat_listings: 'Listings (BaT)',
  external_identities: 'External identities',
  organizations: 'Organizations',
};

const num = (x) => Number(x).toLocaleString('en-US');
const rows3 = (x) => {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'unknown';
  // Three significant figures with a unit; the 0.9995 threshold picks the next unit
  // up before toPrecision would round into exponent form (999,741 -> 1.00M, not 1.00e+3K).
  for (const [unit, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (v >= unit * 0.9995) return `${(v / unit).toPrecision(3)}${suffix}`;
  }
  return num(v);
};
const pct = (part, whole) => {
  const p = (100 * Number(part)) / Number(whole);
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};
const stamp = () => `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function replaceBlock(file, start, end, block) {
  const text = readFileSync(file, 'utf8');
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`${relative(ROOT, file)} has no "${start} … ${end}" block`);
  writeFileSync(file, text.slice(0, a) + block + text.slice(b + end.length));
}

async function databaseBlock() {
  // Sequential on purpose: eight light queries, one at a time, against production.
  const [pg] = await q(`select split_part(version(), ' ', 2) as pg`);
  const [atlas] = await q(`
    select count(*)                                                        as tables,
           count(*) filter (where coalesce(est_rows, 0) > 0)               as tables_non_empty,
           sum(n_cols)                                                     as cols,
           sum(n_cols_described)                                           as cols_described,
           count(*) filter (where coalesce(est_rows, 0) > 0
                              and coalesce(fk_in, 0) + coalesce(fk_out, 0) = 0) as islands,
           count(*) filter (where coalesce(undeclared_stmts_30d, 0) > 0)   as undeclared
      from v_schema_atlas`);
  const [jobs] = await q(`
    select count(*) filter (where active)                                   as active,
           count(*) filter (where active and coalesce(failed_24h, 0) > 0)   as failing
      from v_job_health`);
  const ests = await q(`
    select c.relname, c.reltuples::bigint as est
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname in (${Object.keys(TABLES).map((t) => `'${t}'`).join(', ')})`);
  const [veh] = await q(`
    select count(*) as n, count(vin) as with_vin,
           count(*) filter (where status = 'active') as active,
           count(*) filter (where is_public)         as public
      from vehicles tablesample system (2)`);
  const [img] = await q(`
    select count(*) as n, count(vehicle_zone) as zoned, count(vision_analyzed_at) as analyzed,
           count(*) filter (where ai_processing_status = 'completed') as ai_done
      from vehicle_images tablesample system (0.1)`);
  const [com] = await q(`
    select count(*) as n,
           count(*) filter (where external_identity_id is not null
                               or author_external_identity_id is not null) as keyed,
           count(sentiment_score) as scored
      from auction_comments tablesample system (0.2)`);

  const est = Object.fromEntries(ests.map((r) => [r.relname, Number(r.est)]));
  const row = (t, coverage = '') => `| ${TABLES[t]} | ${rows3(est[t])} | ${coverage} |`;

  return [
    '<!-- stats:start -->',
    `Measured ${stamp()} from the live database by [\`scripts/data/readme-stats.mjs\`](scripts/data/readme-stats.mjs), ` +
      `run daily by [\`update-stats.yml\`](.github/workflows/update-stats.yml). ` +
      'Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.',
    '',
    '| | Rows | Coverage (sampled) |',
    '|---|---|---|',
    row('auction_comments', `${pct(com.keyed, com.n)} author keyed to an identity · ${pct(com.scored, com.n)} sentiment-scored (n=${num(com.n)})`),
    row('bat_bids'),
    row('vehicle_observations'),
    row('vehicle_images', `${pct(img.zoned, img.n)} zone-classified · ${pct(img.analyzed, img.n)} vision-analyzed · ${pct(img.ai_done, img.n)} AI-processed (n=${num(img.n)})`),
    row('vehicles', `${pct(veh.active, veh.n)} active · ${pct(veh.with_vin, veh.n)} with a VIN · ${pct(veh.public, veh.n)} public (n=${num(veh.n)})`),
    row('bat_listings'),
    row('external_identities'),
    row('organizations'),
    '',
    'The database describing itself (`v_schema_atlas`, `v_job_health`): ' +
      `${num(atlas.tables)} tables (${num(atlas.tables_non_empty)} non-empty) · ` +
      `${num(atlas.cols_described)} of ${num(atlas.cols)} columns described (${pct(atlas.cols_described, atlas.cols)}) · ` +
      `${num(atlas.islands)} non-empty tables with no foreign key in or out · ` +
      `${num(atlas.undeclared)} tables with an undeclared writer in the last 30 days · ` +
      `${num(jobs.active)} scheduled jobs active, ${num(jobs.failing)} with a failure in the last 24 h · ` +
      `Postgres ${pg.pg}.`,
    '<!-- stats:end -->',
  ].join('\n');
}

// The library measured from its own files: markdown files and their lines, per shelf.
function libraryBlock() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      const st = lstatSync(p); // symlinks (working-papers -> ../../writing) are not followed
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.endsWith('.md')) files.push(p);
    }
  };
  walk(LIBRARY);

  const shelves = new Map();
  for (const f of files) {
    const parts = relative(LIBRARY, f).split('/');
    const shelf = parts.length === 1 ? '(top level)' : parts.length === 2 ? parts[0] : `${parts[0]}/${parts[1]}`;
    const lines = readFileSync(f, 'utf8').split('\n').length - 1;
    const s = shelves.get(shelf) ?? { files: 0, lines: 0 };
    s.files += 1;
    s.lines += lines;
    shelves.set(shelf, s);
  }
  const total = { files: 0, lines: 0 };
  const rows = [...shelves.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([shelf, s]) => {
    total.files += s.files;
    total.lines += s.lines;
    return `| \`${shelf}\` | ${num(s.files)} | ${num(s.lines)} |`;
  });

  return [
    '<!-- library-stats:start -->',
    `Measured ${stamp()} from the files in this directory by [\`scripts/data/readme-stats.mjs\`](../../scripts/data/readme-stats.mjs), ` +
      'run daily by `update-stats.yml`. Markdown files and their line counts, per shelf. Nothing here is typed by hand.',
    '',
    '| Shelf | Files | Lines |',
    '|---|---:|---:|',
    ...rows,
    `| **Total** | **${num(total.files)}** | **${num(total.lines)}** |`,
    '<!-- library-stats:end -->',
  ].join('\n');
}

async function main() {
  const db = await databaseBlock();
  const lib = libraryBlock();
  if (DRY) {
    console.log(db, '\n', lib);
    return;
  }
  replaceBlock(README, '<!-- stats:start -->', '<!-- stats:end -->', db);
  replaceBlock(LIBRARY_README, '<!-- library-stats:start -->', '<!-- library-stats:end -->', lib);
  console.log(db, '\n', lib);
}

main().catch((e) => {
  console.error(`readme-stats: ${e.message}`);
  process.exit(1);
});

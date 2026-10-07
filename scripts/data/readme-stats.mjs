#!/usr/bin/env node
/**
 * scripts/data/readme-stats.mjs
 *
 * Measures the system and rewrites three generated blocks:
 *   README.md               <!-- stats:start --> … <!-- stats:end -->          (the live database)
 *   docs/library/README.md  <!-- library-stats:start --> … <!-- library-stats:end --> (the library's own files)
 *   docs/POSITIONING.md     <!-- evidence:start --> … <!-- evidence:end -->    (graded predictions, stack registry, vein V012)
 *
 * Every database query runs inside `begin read only … commit` on the Supabase
 * Management API (the same path scripts/data/q.sh uses), so this script cannot
 * write to the database. It needs SUPABASE_ACCESS_TOKEN in the environment.
 *
 * All three blocks are measured before any file is written. When a query fails, the error is printed, the exit code
 * is 1 and no file changes, so the previous blocks stay in place; each block carries its own measured-at time, so a
 * stale one shows its age.
 *
 *   dotenvx run -q -- node scripts/data/readme-stats.mjs            # rewrite the three blocks
 *   dotenvx run -q -- node scripts/data/readme-stats.mjs --dry-run  # print them only
 *
 * Scheduled daily by .github/workflows/update-stats.yml. Every number in those
 * blocks comes from here; none is typed by hand, except the two constants marked in the evidence section: the replay
 * line cited from a pull request (REPLAY) and the band width each model states (BAND).
 */
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'qkgaybvrernstplzjaam';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = resolve(ROOT, 'README.md');
const LIBRARY = resolve(ROOT, 'docs', 'library');
const LIBRARY_README = resolve(LIBRARY, 'README.md');
const POSITIONING = resolve(ROOT, 'docs', 'POSITIONING.md');
const DRY = process.argv.includes('--dry-run');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('readme-stats: SUPABASE_ACCESS_TOKEN is not set');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function q(sql, attempt = 1, t0 = Date.now()) {
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
    return q(sql, attempt + 1, t0);
  }
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* handled below */ }
  if (!res.ok || !Array.isArray(rows)) {
    throw new Error(`query failed (${res.status}): ${text.slice(0, 300)}\n  ${sql.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  // Time every query on stderr, so a slow one shows in the job log long before it reaches the 45 s limit.
  console.error(`readme-stats: ${((Date.now() - t0) / 1000).toFixed(1)}s  ${sql.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
  // Be polite to production: a short pause between queries.
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

// The file's text with the block between its two markers replaced. Throws when a marker is missing; writes nothing.
function spliceBlock(file, start, end, block) {
  const text = readFileSync(file, 'utf8');
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`${relative(ROOT, file)} has no "${start} … ${end}" block`);
  return text.slice(0, a) + block + text.slice(b + end.length);
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

// ---- docs/POSITIONING.md: the evidence block ---------------------------------------------------------------------
// The grading is read where it is kept: hammer_predictions (one row per prediction), v_prediction_lot_grades (one row
// per model, lot and horizon) and prediction_accuracy (one row per model, over horizon 'last'). The unit is the lot.

// The band each model states, in percent, from the comments on hammer_predictions.predicted_low and on
// prediction_accuracy: models 30 and 31 state p10 to p90, model 24 p25 to p75. A model not listed here prints
// "band width unknown", never a guess.
const BAND = { 24: 50, 30: 80, 31: 80 };

// The live-lot reader's replay is a script run (scripts/market/replay-live-lot-reader.sql), not a view, so its line is
// cited from the body of PR #771 (merged 2026-10-07; table "T-2 min, exact scheduled close") and never recomputed here.
const REPLAY = { pr: 771, date: '2026-10-07', held: 257, of: 311, closes: '2026-10-05 to 06' };

// Tenths of a percent, rounded half away from zero on the two-decimal text Postgres returns, the way Postgres rounds
// (26.15 is 26.2; Number#toFixed on the binary float would say 26.1).
const tenths = (x) => {
  const h = Math.round(Number(x) * 100);
  return ((Math.sign(h) * Math.floor((Math.abs(h) + 5) / 10)) / 10).toFixed(1);
};
const signedTenths = (x) => {
  const t = tenths(x);
  return t.startsWith('-') ? `−${t.slice(1)}` : `+${t}`;
};
// A missing figure stops the run: a block with a hole in it is worse than the block it would replace.
const need = (v, what) => {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) throw new Error(`${what} is missing or not a number`);
  return v;
};

async function evidenceBlock() {
  try {
    // Sequential on purpose: eight light reads, one at a time, against production.
    const [pred] = await q(`
      select count(*) as prediction_rows, count(auction_event_id) as keyed_rows,
             count(distinct auction_event_id) as lots
        from hammer_predictions`);
    const models = await q(`select * from prediction_accuracy order by model_version desc`);
    const [sold] = await q(`
      select count(distinct lot) as lots
        from v_prediction_lot_grades
       where horizon = 'last' and actual_hammer is not null`);
    const basis = await q(`
      select model_version, close_basis, count(*) as n
        from v_prediction_lot_grades
       where horizon = 'last' and actual_hammer is not null
       group by 1, 2`);
    const [reg] = await q(`
      select count(*) as stacks, count(*) filter (where status = 'measured') as measured,
             count(*) filter (where coverage >= 0.9) as at_09, round(avg(coverage), 2) as mean_cov
        from v_stacks`);
    const named = await q(`
      select stack_id, version, status, coverage, n_needs, n_present, n_partial, n_missing,
             thesis_vein_id, thesis_vein_version
        from v_stacks
       where stack_id in ('SA', 'S03')`);
    const sa = named.find((r) => r.stack_id === 'SA');
    const s03 = named.find((r) => r.stack_id === 'S03');
    if (!sa || !s03) throw new Error('v_stacks has no row for SA or S03');
    if (s03.thesis_vein_id !== 'V012' || !Number.isInteger(s03.thesis_vein_version)) {
      throw new Error(`S03 cites ${s03.thesis_vein_id} v${s03.thesis_vein_version}, not V012: the vein line is written for V012`);
    }
    const veins = await q(`
      select version, status, parameters -> 'discovery' as discovery
        from vein_ledger
       where vein_id = 'V012'
       order by version desc`);
    const [runs] = await q(`
      select count(*) as runs, count(*) filter (where counts) as grading_runs,
             (array_agg(coalesce(result ->> 'as_of', window_to::text) order by ran_at desc)
                filter (where sample = 'discovery'))[1] as discovery_as_of
        from vein_runs
       where vein_id = 'V012' and version = ${s03.thesis_vein_version}`);

    // The grading. A lot is graded once per model that priced it, so grades (the sum over models) can exceed lots.
    const graded = models.filter((m) => Number(m.scored) > 0);
    if (!graded.length) throw new Error('prediction_accuracy has no model with a graded lot');
    const grades = graded.reduce((s, m) => s + Number(m.scored), 0);
    need(pred.lots, 'distinct lots predicted');
    need(sold.lots, 'distinct sold lots graded');
    need(reg.mean_cov, 'mean stack coverage');
    need(sa.coverage, 'SA coverage');
    if (Number(sold.lots) > grades) throw new Error(`${sold.lots} distinct sold lots exceed ${grades} model-lot grades`);

    const closeOf = (model) => {
      const c = { scheduled: 0, final: 0, predicted: 0, other: 0 };
      for (const b of basis) {
        if (Number(b.model_version) !== Number(model)) continue;
        c[['scheduled', 'final', 'predicted'].includes(b.close_basis) ? b.close_basis : 'other'] += Number(b.n);
      }
      return c;
    };
    const modelRow = (m) => {
      const c = closeOf(m.model_version);
      const band = BAND[m.model_version];
      const held = Number(m.bands_scored) > 0
        ? `${num(m.bands_held)} of ${num(m.bands_scored)} = ${m.band_hold_pct}% (${band ? `${band}% band` : 'band width unknown'})`
        : 'no band stated';
      const close = `${num(c.scheduled)} / ${num(c.final)} / ${num(c.predicted)}${c.other ? ` + ${num(c.other)} other` : ''}`;
      return (
        `| ${m.model_version} | ${num(m.scored)} of ${num(m.total_predictions)} ` +
        `| ${tenths(need(m.median_abs_error_pct, `model ${m.model_version} median error`))}% ` +
        `| ${signedTenths(need(m.avg_bias_pct, `model ${m.model_version} bias`))}% | ${held} | ${close} |`
      );
    };

    // V012 as the registry cites it (S03's thesis vein), beside the ledger's current line.
    const current = veins[0];
    const cited = veins.find((v) => v.version === s03.thesis_vein_version);
    if (!cited) throw new Error(`vein_ledger has no V012 v${s03.thesis_vein_version}, which S03 cites`);
    const d = cited.discovery ?? {};
    const buyers = need(d.distinct_buyers, 'V012 discovery distinct_buyers');
    const top1 = need(d.top_1pct_share_of_lots_pct, 'V012 discovery top_1pct_share_of_lots_pct');
    const won50 = need(d.won_50_or_more, 'V012 discovery won_50_or_more');
    const asOf = Number(runs.runs) > 0 && runs.discovery_as_of ? `, as of ${runs.discovery_as_of}` : '';

    return [
      '<!-- evidence:start -->',
      `Measured ${stamp()} from the live database by [\`scripts/data/readme-stats.mjs\`](../scripts/data/readme-stats.mjs), ` +
        'run daily by [`update-stats.yml`](../.github/workflows/update-stats.yml). Read-only. ' +
        "The unit is the lot, never a prediction row: a model's grade for a lot is its last prediction before the lot's close, " +
        "against the lot's winning bid in `auction_events`. The close is the scheduled one where live frames hold it, else the " +
        'final one, else the one the predictor believed (`predicted`). Models with no graded lot are not listed.',
      '',
      '| Model | Sold lots graded, of lots ended | Median absolute error | Bias (mean signed error) | Hammer inside its stated band | Close: scheduled / final / predicted |',
      '|---|---|---|---|---|---|',
      ...graded.map(modelRow),
      '',
      `- **Lots predicted:** ${num(pred.lots)} distinct lots, in ${num(pred.keyed_rows)} of ${num(pred.prediction_rows)} prediction rows; ` +
        `${num(Number(pred.prediction_rows) - Number(pred.keyed_rows))} rows are not keyed to a lot yet (\`hammer_predictions\`, distinct \`auction_event_id\`).`,
      `- **Lots graded:** ${num(sold.lots)} distinct sold lots, and ${num(grades)} model-lot grades in all, because a lot priced by more than one ` +
        'model is graded once for each (`v_prediction_lot_grades`, horizon `last`, with a hammer; the table is `prediction_accuracy`).',
      `- **Stacks:** ${num(reg.stacks)} registered, ${num(reg.measured)} at status measured; ${num(reg.at_09)} at coverage 0.9 or above; ` +
        `mean coverage ${reg.mean_cov} (\`v_stacks\`). Order book SA v${sa.version}: coverage ${Number(sa.coverage).toFixed(2)}, ` +
        `${num(sa.n_present)} of ${num(sa.n_needs)} needs present, ${num(sa.n_partial)} partial, ${num(sa.n_missing)} missing; status ${sa.status}.`,
      `- **Thesis vein V012 v${cited.version}** (cited by S03; \`vein_ledger\`, status ${cited.status}` +
        `${current.version !== cited.version ? `; the ledger's current line is v${current.version}` : ''}): ` +
        `${num(buyers)} distinct buyers, the top 1% took ${top1}% of lots, ${num(won50)} won 50 or more (discovery run${asOf}). ` +
        `Runs that can grade it: ${num(runs.grading_runs)} of ${num(runs.runs)} (\`vein_runs\`).`,
      `- **Live-lot reader replay** (cited from PR #${REPLAY.pr}, ${REPLAY.date}; a replay, not a view, so not recomputed here): ` +
        `2 minutes before the scheduled close the hammer sat inside its 80% band on ${REPLAY.held} of ${REPLAY.of} lots the live collector ` +
        `followed (closes ${REPLAY.closes}) = ${((100 * REPLAY.held) / REPLAY.of).toFixed(1)}%. ` +
        "Not out-of-sample: the band's shape was chosen after seeing these lots.",
      '<!-- evidence:end -->',
    ].join('\n');
  } catch (e) {
    throw new Error(`evidence block for docs/POSITIONING.md failed, previous block left in place: ${e.message}`);
  }
}

async function main() {
  const db = await databaseBlock();
  const lib = libraryBlock();
  const evidence = await evidenceBlock();
  if (DRY) {
    console.log(db, '\n', lib, '\n', evidence);
    return;
  }
  // Splice all three before writing any, so a missing marker in one file leaves every file as it was.
  const writes = [
    [README, spliceBlock(README, '<!-- stats:start -->', '<!-- stats:end -->', db)],
    [LIBRARY_README, spliceBlock(LIBRARY_README, '<!-- library-stats:start -->', '<!-- library-stats:end -->', lib)],
    [POSITIONING, spliceBlock(POSITIONING, '<!-- evidence:start -->', '<!-- evidence:end -->', evidence)],
  ];
  for (const [file, text] of writes) writeFileSync(file, text);
  console.log(db, '\n', lib, '\n', evidence);
}

main().catch((e) => {
  console.error(`readme-stats: ${e.message}`);
  process.exit(1);
});

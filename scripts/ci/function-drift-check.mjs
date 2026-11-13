#!/usr/bin/env node
/**
 * scripts/ci/function-drift-check.mjs
 *
 * Drift between the SQL functions the migrations define and the ones the live database runs. Repo law 1 ("the repo is
 * not prod"): on 2026-11-06 receipt_type_signals was hot-patched in production and no migration carried it.
 *
 * Reads only. It compares the body of each `public` function (the text between the dollar quotes, whitespace collapsed)
 * from the latest migration that defines it with the live pg_proc.prosrc, and lists
 *   DRIFTED     live body differs from the last migration that created it (the migration or prod is stale)
 *   UNMIGRATED  live public function that no migration creates
 *   DROPPED     a function a migration creates that live no longer has (informational)
 * It prints names, argument counts and 12-hex digests, never a body, a URL or a token. Exit 1 when anything DRIFTED
 * (or UNMIGRATED with --strict), 2 on a usage or connection error.
 *
 * Live source, first that applies (a connection string is passed to psql through the environment, not argv):
 *   --live-json FILE   offline mode: rows [{name, nargs, body}] you fetched earlier (also what the tests use)
 *   --live-digests FILE  offline, digests only: rows [{name, args, md5}] where md5 = md5(prosrc) and args = identity args.
 *                      The migration body is hashed raw (md5, no whitespace collapse), so a whitespace-only difference
 *                      counts as drift in this mode.
 *   --markdown FILE    also write a names-only report (counts + names) to FILE
 *   DATABASE_URL (or SUPABASE_DB_URL)  psql with default_transaction_read_only=on
 *   SUPABASE_ACCESS_TOKEN              Management API read query (project ref SUPABASE_PROJECT_REF, default qkgaybvrernstplzjaam)
 *
 *   node scripts/ci/function-drift-check.mjs [--migrations DIR] [--strict] [--json] [--live-json FILE]
 *   node --test scripts/ci/function-drift-check.test.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const LIVE_SQL = `
  select coalesce(json_agg(json_build_object('name', p.proname, 'nargs', p.pronargs, 'body', p.prosrc) order by p.proname, p.oid), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

export const normBody = (s) => s.replace(/\s+/g, ' ').trim();
export const md5 = (s) => createHash('md5').update(s).digest('hex');
// digests-only live rows -> {name, nargs, md5}
export const fromDigests = (rows) => rows.map((r) => ({ name: r.name, nargs: countArgs(r.args || ''), md5: r.md5 }));
export const digest = (s) => createHash('sha256').update(normBody(s)).digest('hex').slice(0, 12);

// Index of the ')' that closes the '(' at `open`, skipping quotes; -1 when unbalanced.
function matchParen(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i = sql.indexOf("'", i + 1); if (i < 0) return -1; }
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

export function countArgs(list) {
  let depth = 0, n = 0, seen = false;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "'") { i = list.indexOf("'", i + 1); if (i < 0) break; seen = true; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { if (seen) n++; seen = false; continue; }
    if (!/\s/.test(c)) seen = true;
  }
  return n + (seen ? 1 : 0);
}

const unq = (n) => n.replace(/"/g, '').toLowerCase();
const CREATE_RE = /^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?(?:function|procedure)[ \t]+(?:public\.)?("?[A-Za-z_][\w]*"?)[ \t]*\(/gim;
const DROP_RE = /^[ \t]*drop[ \t]+(?:function|procedure)[ \t]+(?:if[ \t]+exists[ \t]+)?(?:public\.)?("?[A-Za-z_][\w]*"?)[ \t]*\(/gim;

// Definitions in one migration's text, in order: {name, nargs, body} or {drop: name}. Lines that start with `--` never match.
export function parseMigration(sql) {
  const events = [];
  for (const m of sql.matchAll(CREATE_RE)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) continue;
    const tail = sql.slice(close + 1);
    const q = /\$([A-Za-z_]*)\$/.exec(tail);
    if (!q) continue; // AS 'string' bodies are not read
    const end = tail.indexOf(q[0], q.index + q[0].length);
    if (end < 0) continue;
    events.push({ at: m.index, name: unq(m[1]), nargs: countArgs(sql.slice(open + 1, close)), body: tail.slice(q.index + q[0].length, end) });
  }
  for (const m of sql.matchAll(DROP_RE)) events.push({ at: m.index, drop: unq(m[1]) });
  return events.sort((a, b) => a.at - b.at);
}

// Latest definitions across migration files given in version order: Map "name/nargs" -> {name, nargs, body, file}.
export function latestDefinitions(files) {
  const defs = new Map();
  for (const { file, sql } of files) {
    for (const e of parseMigration(sql)) {
      if (e.drop) { for (const k of [...defs.keys()]) if (defs.get(k).name === e.drop) defs.delete(k); continue; }
      defs.set(`${e.name}/${e.nargs}`, { name: e.name, nargs: e.nargs, body: e.body, file });
    }
  }
  return defs;
}

const ldig = (r) => (r.md5 ? r.md5.slice(0, 12) : digest(r.body));

export function compare(defs, live) {
  const liveBy = new Map();
  for (const r of live) {
    const k = `${r.name}/${r.nargs}`;
    if (!liveBy.has(k)) liveBy.set(k, []);
    liveBy.get(k).push(r);
  }
  const drifted = [], unmigrated = [], dropped = [];
  for (const [k, rows] of liveBy) {
    const d = defs.get(k);
    if (!d) { for (const r of rows) unmigrated.push({ name: r.name, nargs: r.nargs, live: ldig(r) }); continue; }
    const want = normBody(d.body), wantMd5 = md5(d.body);
    // same name and argument count can be two overloads; then any live body equal to the migration's is a match
    if (!rows.some((r) => (r.md5 ? r.md5 === wantMd5 : normBody(r.body) === want))) {
      for (const r of rows) drifted.push({ name: r.name, nargs: r.nargs, file: d.file, live: ldig(r), migration: r.md5 ? wantMd5.slice(0, 12) : digest(d.body), overloads: rows.length });
    }
  }
  for (const [k, d] of defs) if (!liveBy.has(k)) dropped.push({ name: d.name, nargs: d.nargs, file: d.file });
  return { drifted, unmigrated, dropped };
}

export function loadMigrations(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((file) => ({ file, sql: readFileSync(path.join(dir, file), 'utf8') }));
}

export function formatReport(res, { strict = false } = {}) {
  const line = (r) => `  ${r.name}/${r.nargs}` + (r.file ? `  ${r.file}` : '') + (r.live ? `  live=${r.live}` : '') + (r.migration ? ` migration=${r.migration}` : '');
  const out = [
    `DRIFTED (live body differs from latest migration): ${res.drifted.length}`, ...res.drifted.map(line),
    `UNMIGRATED (live public function no migration creates)${strict ? '' : ' [informational without --strict]'}: ${res.unmigrated.length}`, ...res.unmigrated.map(line),
    `DROPPED (migration creates it, live lacks it) [informational]: ${res.dropped.length}`, ...res.dropped.map(line),
  ];
  return out.join('\n');
}
export const exitCode = (res, strict) => (res.drifted.length || (strict && res.unmigrated.length) ? 1 : 0);

// Names-only markdown: counts, then each function once per name/nargs. No bodies, no digests.
export function formatMarkdown(res, { date, liveCount, migrationCount }) {
  const names = (a) => [...new Set(a.map((r) => `${r.name}/${r.nargs}`))].sort();
  const sec = (title, a) => { const n = names(a); return `## ${title}: ${n.length}\n\n` + (n.length ? n.map((x) => `- \`${x}\``).join('\n') : '_none_') + '\n'; };
  return [
    `# Function drift, live public schema vs repo migrations (${date})`, '',
    `Produced by \`scripts/ci/function-drift-check.mjs --live-digests\`. Live: ${liveCount} public function overloads (name, identity args, md5(prosrc), read-only fetch); repo: ${migrationCount} distinct name/arg-count definitions parsed from \`supabase/migrations\`. Names are \`name/argument-count\`; no bodies.`, '',
    'Limits: only \`$tag$...$tag$\` bodies are parsed (\`AS \'string\'\` bodies are not read, so they appear under live-with-no-migration); the live digest is of the raw body, so a whitespace-only difference counts as drifted; overloads sharing a name and argument count are compared as a set; extension-owned functions are excluded only if the live fetch excluded them. A historical list, not authority to reapply or delete anything.', '',
    sec('Drifted (latest migration body differs from live)', res.drifted),
    sec('Live with no migration', res.unmigrated),
    sec('Migration defines it, live lacks it', res.dropped),
  ].join('\n');
}

function fetchLive() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (url) {
    const r = spawnSync('psql', ['-X', '-qAt', '-c', LIVE_SQL], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      env: { PATH: process.env.PATH, PGDATABASE: url, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=60000' },
    });
    if (r.status !== 0) throw new Error('psql failed (connection details withheld)');
    return JSON.parse(r.stdout);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token) {
    const ref = process.env.SUPABASE_PROJECT_REF || 'qkgaybvrernstplzjaam';
    return fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: LIVE_SQL, read_only: true }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Management API answered ${res.status}`);
      const j = await res.json();
      const v = j?.[0]?.coalesce ?? Object.values(j?.[0] ?? {})[0];
      return typeof v === 'string' ? JSON.parse(v) : v;
    });
  }
  throw new Error('no live source: set DATABASE_URL, or SUPABASE_ACCESS_TOKEN, or pass --live-json FILE');
}

async function main(argv) {
  const opt = { migrations: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations'), strict: false, json: false, liveJson: null, liveDigests: null, markdown: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strict') opt.strict = true;
    else if (argv[i] === '--json') opt.json = true;
    else if (argv[i] === '--migrations') opt.migrations = argv[++i];
    else if (argv[i] === '--live-json') opt.liveJson = argv[++i];
    else if (argv[i] === '--live-digests') opt.liveDigests = argv[++i];
    else if (argv[i] === '--markdown') opt.markdown = argv[++i];
    else { console.error(`unknown argument ${argv[i]}`); return 2; }
  }
  try {
    const live = opt.liveDigests ? fromDigests(JSON.parse(readFileSync(opt.liveDigests, 'utf8')))
      : opt.liveJson ? JSON.parse(readFileSync(opt.liveJson, 'utf8')) : await fetchLive();
    const defs = latestDefinitions(loadMigrations(opt.migrations));
    const res = compare(defs, live);
    if (opt.markdown) writeFileSync(opt.markdown, formatMarkdown(res, { date: new Date().toISOString().slice(0, 10), liveCount: live.length, migrationCount: defs.size }));
    console.log(opt.json ? JSON.stringify(res, null, 2) : formatReport(res, opt));
    return exitCode(res, opt.strict);
  } catch (e) {
    console.error(`function-drift-check: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)));

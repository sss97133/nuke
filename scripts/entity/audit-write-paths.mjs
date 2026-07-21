#!/usr/bin/env node
// scripts/entity/audit-write-paths.mjs — THE DOOR CENSUS.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ────────────────────────────────────────────────────────────────────────────
// scripts/entity/write.mjs made ONE door safe. This file finds every OTHER
// door and fails when a new one is cut.
//
// The defect class is not "a bad value got in". It is "a value got in through
// a path nobody was watching". Every measured defect on the client surface —
// Elan villas at 294 USD/week against a merchant's 22,000; a WIMCO nightly
// rate served with a hardcoded "/week"; BODY+SOUL wearing an Indonesian
// gambling site's wordmark; 244 villas wearing their agency's logo — arrived
// through a `.update()` in a script that nobody was going to read again.
// Closing those specific holes does not stop the next script, written next
// week, from cutting a fresh one. This does.
//
// It is a CENSUS, not a linter. It does not judge whether a write is correct.
// It answers one question per site: is this door watched? A door is watched if
// it goes through writeField/writeFields, or if a human wrote down, in the
// baseline, why it does not have to.
//
// ────────────────────────────────────────────────────────────────────────────
// RUN
// ────────────────────────────────────────────────────────────────────────────
//   npm run entity:audit-writes            # census + drift check, exit 1 on drift
//   npm run entity:audit-writes -- --list  # full table, every site, no exit code drama
//   npm run entity:audit-writes -- --json  # machine-readable
//   npm run entity:audit-writes -- --update-baseline   # accept current state
//
// NOT wired into any git hook. Deliberately. A hook that fails a commit for a
// data-provenance reason will be bypassed with --no-verify the first time it is
// inconvenient, and then it is worse than nothing because it looks like cover.
// Run it in the nightly job or before a release; that is where it belongs.
//
// ────────────────────────────────────────────────────────────────────────────
// WHY A BASELINE AND NOT "ZERO UNGATED WRITES"
// ────────────────────────────────────────────────────────────────────────────
// There are ~40 pre-existing sites. A check that fails at 40 on day one is
// noise, gets ignored, and dies. So the baseline records the doors that exist
// TODAY, each with a status a human chose, and the check fails only on a door
// that is NOT in it. Fingerprints are `file|table|kind|sorted(columns)` — NOT
// line numbers — so refactoring a file does not cry wolf, but a new column, a
// new table, or a new file does.
//
// Statuses a baseline entry may carry (this file does not invent them; a human
// writes them):
//   gated       — goes through writeField/writeFields
//   quarantine  — a repair/quarantine script that PRESERVES rather than asserts
//                 (quarantine-elan-prices, repair-blank-marks, clean-org-defects)
//   one-off     — ran once, not scheduled, not deployed; left for the record
//   live-ungated— scheduled or deployed and NOT gated. This is the debt list.
//                 It is a status, not an absolution.
//   read-only   — matched by the scanner but writes nothing served
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT IT CANNOT SEE (stated so nobody trusts it further than it goes)
// ────────────────────────────────────────────────────────────────────────────
//  - It is a text scanner, not a type-checker. `db.from(tbl)` with a variable
//    table name is invisible. So is a write through a helper that takes the
//    table as an argument.
//  - `.update(someVar)` columns are resolved by a backwards scan for
//    `someVar.<key> =` / `someVar = {...}`. When that fails the site is
//    reported with columns `<unresolved>` and treated as touching served
//    columns — fail-closed, because guessing "probably harmless" is the exact
//    move that produced the defects.
//  - It cannot see a write made from the Supabase dashboard, from psql, from
//    an MCP execute_sql call, or by an agent with the service-role key. Those
//    are outside any static check by construction.
//  - SQL text inside a JS string (the `restore:` recovery paths that
//    quarantine scripts store in metadata) is reported as `sql-literal` and
//    does NOT count as a door: it is a recorded undo, never executed here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NUKE = path.resolve(HERE, '../..');
const LOFFICIEL = '/Users/skylar/lofficiel-concierge';
const BASELINE = path.join(HERE, 'write-paths.baseline.json');

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

// ════════════════════════════════════════════════════════════════════════════
// THE SERVED SURFACE
// ════════════════════════════════════════════════════════════════════════════
// A column is SERVED if a client surface renders it. This list is seeded from
// validate.mjs's SUBJECTS registry (priceFields + imageFields — the columns the
// gate already knows how to judge) and extended with the identity/prose columns
// that carried real defects to a surface: description (BODY+SOUL's wordmark
// arrived next to a scraped description), website (MEDIFLIGHT matched to
// Oklahoma), latitude/longitude (a St Barth restaurant pinned in Dordogne),
// price_currency/price_period (388 WIMCO nightly rates labelled /week).
//
// `metadata` is deliberately NOT served: it is where quarantine, provenance and
// recovery paths live. A write to metadata is how a value is held BACK from the
// surface. Flagging it would punish the correct behaviour.
const SERVED = {
  organizations: new Set([
    'name', 'business_name', 'description', 'logo_url', 'banner_url', 'website',
    'phone', 'email', 'address', 'city', 'state', 'zip_code', 'country',
    'latitude', 'longitude', 'social_links', 'hourly_rate_min', 'hourly_rate_max',
    'asking_price', 'services_offered', 'specializations', 'hours_of_operation',
    'verification_level', 'entity_type', 'org_type', 'business_type', 'slug',
  ]),
  properties: new Set([
    'name', 'description', 'base_price', 'sale_price', 'price_currency',
    'price_period', 'sale_price_currency', 'images', 'primary_image_url',
    'city', 'region', 'country', 'latitude', 'longitude', 'bedrooms',
    'bathrooms', 'max_guests', 'amenities', 'slug', 'status',
  ]),
  concierge_products: new Set([
    'name', 'description', 'price', 'currency', 'price_unit', 'image_url',
    'images', 'brand', 'category', 'availability', 'url', 'slug',
  ]),
};
const TABLES = Object.keys(SERVED);

const WRITE_VERBS = ['update', 'upsert', 'insert', 'delete'];
const EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.py', '.sql']);
// `worktrees` and `checkpoints` hold full COPIES of the tree (the Stop hook and
// EnterWorktree keep them). Scanning them reports every door 3-6 times and the
// census becomes unreadable. They are not doors — they are snapshots of doors.
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage',
  '.venv', '.venv-numbers', '__pycache__', '.turbo', 'out', '.vercel', '.temp',
  'worktrees', 'checkpoints', 'backups', '_retired', '_archive', 'archive', '_tmp']);

// ════════════════════════════════════════════════════════════════════════════
// FILE WALK
// ════════════════════════════════════════════════════════════════════════════
function* walk(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') {
      if (SKIP_DIR.has(e.name)) continue;
    }
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(e.name))) yield p;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CHAIN PARSING
// ════════════════════════════════════════════════════════════════════════════
// From a `.from('T')` / `.table('T')` match, walk forward to the end of the
// STATEMENT (first `;` at depth <= 0, or a hard cap) and look for a write verb
// inside it. Supabase chains are `db.from('x').update({...}).eq(...)`, so the
// verb always follows the table and always inside the same statement.
function statementFrom(src, start) {
  let depth = 0;
  const cap = Math.min(src.length, start + 6000);
  for (let i = start; i < cap; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if ((ch === ';' || ch === '\n') && depth <= 0) {
      // a newline only ends the statement if the next non-space char cannot
      // continue a chain (i.e. is not `.`)
      if (ch === ';') return src.slice(start, i);
      const rest = src.slice(i + 1);
      const m = rest.match(/^\s*/);
      if (rest[m[0].length] !== '.') return src.slice(start, i);
    }
  }
  return src.slice(start, cap);
}

// Balanced argument text of `verb(` starting at the index of the open paren.
function balancedArg(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length && i < openIdx + 8000; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}

// The FIRST argument only. `.upsert(rows, { onConflict, ignoreDuplicates })`
// has an options object as arg 2; reading keys from the whole argument text
// reported `onConflict, ignoreDuplicates` as the columns being written.
function firstArg(arg) {
  let depth = 0, inStr = null;
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i];
    if (inStr) { if (ch === inStr && arg[i - 1] !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) return arg.slice(0, i);
  }
  return arg;
}

// Top-level object keys inside an argument. Only depth-1 keys count: nested
// `metadata: { price_quarantine: {...} }` must report `metadata`, not the
// quarantine internals.
function topLevelKeys(arg) {
  const keys = [];
  let depth = 0, inStr = null;
  const brace = arg.indexOf('{');
  if (brace === -1) return keys;
  for (let i = brace; i < arg.length; i++) {
    const ch = arg[i];
    if (inStr) { if (ch === inStr && arg[i - 1] !== '\\') inStr = null; continue; }
    // A KEY IS TESTED BEFORE A STRING IS OPENED. Ordering bug, measured: with
    // the string branch first, `{"latitude": ..., "longitude": ...}` reported
    // ZERO columns — every quoted key was consumed as an opaque string literal.
    // That silently turned ingest_field_survey.py's coordinate PATCHes (the
    // class that pinned a St Barth restaurant in Dordogne) into <unresolved>.
    // JS object literals mostly use bare keys so the bug hid there; Python and
    // JSON bodies quote everything, which is exactly where it mattered.
    if (depth === 1) {
      const km = /^([A-Za-z_$][\w$]*|'[^']+'|"[^"]+")\s*:/.exec(arg.slice(i));
      if (km && /[\s{,]/.test(arg[i - 1] ?? '{')) {
        keys.push(km[1].replace(/['"]/g, ''));
        i += km[0].length - 1;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; if (depth === 0) break; continue; }
  }
  return keys;
}

// `.update(upd)` — resolve `upd` by scanning the file for what it is built from.
function resolveVar(src, name) {
  const keys = new Set();
  // `const x = {` (JS) and bare `x = {` (Python) both declare the payload.
  // Without the Python form every dict body in ingest_shopify_catalog.py and
  // ingest_field_survey.py resolved to <unresolved>.
  const objDecl = new RegExp(`(?:^|[\\s;])(?:const|let|var)?\\s*${name}\\s*=\\s*\\{`, 'gm');
  let m;
  while ((m = objDecl.exec(src))) {
    const open = src.indexOf('{', m.index);
    for (const k of topLevelKeys(src.slice(open))) keys.add(k);
  }
  const propAssign = new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)\\s*=[^=]`, 'g');
  while ((m = propAssign.exec(src))) keys.add(m[1]);
  const bracketAssign = new RegExp(`\\b${name}\\[\\s*['"]([^'"]+)['"]\\s*\\]\\s*=[^=]`, 'g');
  while ((m = bracketAssign.exec(src))) keys.add(m[1]);
  const spread = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*\\.\\.\\.`, 'g');
  if (spread.test(src)) keys.add('<spread>');
  return [...keys];
}

function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

// ════════════════════════════════════════════════════════════════════════════
// GATE DETECTION
// ════════════════════════════════════════════════════════════════════════════
// A file is gated if it reaches the single guarded writer by ANY of its doors:
//   - JS/TS: imports writeField/writeFields from scripts/entity/write.mjs
//   - Python: imports assert_admitted from scripts/entity/preflight.py, which
//     shells out to the same writer. (ingest_wimco_villas.py takes this path;
//     it is a preflight the script must choose to call, not an unskippable
//     gate — recorded honestly in that file's own header.)
const GATE_IMPORT = /from\s+['"][^'"]*entity\/write\.mjs['"]|writeFields?\b|assert_admitted|from\s+preflight\b/;
const WAIVER = /entity-write-gate:\s*allow(?:\s+(.*))?/;

function waiverNear(src, idx) {
  const upto = src.slice(0, idx);
  const lines = upto.split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const m = WAIVER.exec(lines[i]);
    if (m) return (m[1] || 'no reason given').trim();
  }
  const after = src.slice(idx, idx + 400).split('\n').slice(0, 2).join('\n');
  const m2 = WAIVER.exec(after);
  return m2 ? (m2[1] || 'no reason given').trim() : null;
}

// ════════════════════════════════════════════════════════════════════════════
// LIVENESS
// ════════════════════════════════════════════════════════════════════════════
// A door matters more when something opens it on a schedule. Evidence of live:
//   - it is a deployed edge function (supabase/functions/**)
//   - its filename appears in a package.json script
//   - its filename appears in a shell runner (*.sh) — night_jobs.sh, nightly_audit.sh
//   - it is application code under a frontend src/ (served on request)
function buildLiveIndex(roots) {
  // NOTE: `walk` filters to EXTS, which is code extensions only — it never
  // yields a .sh file. Reusing it here meant the shell-runner half of the
  // liveness test read NOTHING, and every script driven by a night job
  // (ingest_field_survey.py under field_walk_watch.sh) was filed "one-off".
  // A separate walker, on purpose.
  const hay = [];
  const walkSh = function* (dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIR.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walkSh(p);
      else if (/\.(sh|bash|zsh)$/.test(e.name)) yield p;
    }
  };
  for (const root of roots) {
    for (const p of walkSh(root)) { try { hay.push(fs.readFileSync(p, 'utf8')); } catch {} }
    const pj = path.join(root, 'package.json');
    if (fs.existsSync(pj)) { try { hay.push(fs.readFileSync(pj, 'utf8')); } catch {} }
  }
  const blob = hay.join('\n');
  return (relPath) => {
    const base = path.basename(relPath);
    const reasons = [];
    if (/supabase\/functions\//.test(relPath)) reasons.push('deployed edge function');
    if (/(^|\/)(src|app|pages|components)\//.test(relPath) && /\.tsx?$/.test(relPath)) reasons.push('application code (served on request)');
    // A basename search is only evidence when the basename is distinctive.
    // `index.ts` appears in every package.json ever written; matching on it
    // marked all 40 edge functions "referenced by a script".
    const GENERIC_BASENAME = /^(index|main|app|route|handler|mod|utils?|helpers?)\.(ts|tsx|js|mjs|cjs|py)$/;
    if (!GENERIC_BASENAME.test(base) && blob.includes(base)) reasons.push('referenced by a package.json script or shell runner');
    return reasons;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SCAN
// ════════════════════════════════════════════════════════════════════════════
function scanFile(abs, repoRoot) {
  const rel = path.relative(repoRoot, abs);
  const label = (repoRoot === NUKE ? '' : path.basename(repoRoot) + ':') + rel;
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const sites = [];
  const isSelf = /scripts\/entity\/(write|audit-write-paths|validate)\.mjs$/.test(rel);
  const fileGated = GATE_IMPORT.test(src);

  // ── client-library chains ────────────────────────────────────────────────
  const fromRe = new RegExp(`\\.(?:from|table)\\(\\s*['"\`](${TABLES.join('|')})['"\`]\\s*\\)`, 'g');
  let m;
  while ((m = fromRe.exec(src))) {
    const table = m[1];
    const stmt = statementFrom(src, m.index);
    for (const verb of WRITE_VERBS) {
      const vIdx = stmt.indexOf(`.${verb}(`);
      if (vIdx === -1) continue;
      const openIdx = m.index + vIdx + verb.length + 1;
      const arg = firstArg(balancedArg(src, openIdx));
      let cols = topLevelKeys(arg);
      let unresolved = false;
      if (!cols.length) {
        const varName = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(arg)?.[1];
        if (varName) {
          cols = resolveVar(src, varName);
          if (!cols.length) { cols = ['<unresolved>']; unresolved = true; }
        } else if (verb === 'delete') {
          cols = ['<delete>'];
        } else { cols = ['<unresolved>']; unresolved = true; }
      }
      const served = cols.filter((c) => SERVED[table].has(c));
      const touchesServed = unresolved || cols.includes('<spread>') || served.length > 0 || verb === 'insert' || verb === 'delete';
      sites.push({
        file: label, line: lineOf(src, m.index), table, kind: verb,
        columns: cols.sort(), served_columns: served.sort(),
        touches_served: touchesServed, unresolved,
        gated: isSelf ? 'sanctioned-door' : fileGated ? 'file-imports-writer' : null,
        waiver: waiverNear(src, m.index),
      });
      break; // one verb per statement
    }
  }

  // ── raw PostgREST over HTTP ──────────────────────────────────────────────
  // The class the client-library scan cannot see, and the one that carried the
  // worst measured defects: ingest_shopify_catalog.py POSTs concierge_products
  // (the 0.12 EUR garment) and ingest_wimco_villas.py PATCHes properties (the
  // 388 nightly rates) entirely over `urllib`. No `.from()`, no `.update()`,
  // nothing for a supabase-js-shaped grep to match. A census that only knows
  // one client library is a census of the doors you already knew about.
  const restRe = new RegExp(`/rest/v1/(${TABLES.join('|')})\\b`, 'g');
  while ((m = restRe.exec(src))) {
    const table = m[1];
    const lineNo = lineOf(src, m.index);
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    // METHOD. The verb may sit before the URL (`req("GET", "/rest/v1/...")`)
    // or after it (`rest(f"/rest/v1/...", "PATCH", body)`, `{ method: 'PATCH' }`,
    // `curl -X POST`). Read prefix THEN suffix and take the first hit: scanning
    // a loose window around the line reported three GET reads in
    // ingest_shopify_catalog.py as POSTs, because a POST appeared later in the
    // same function.
    const prefix = src.slice(lineStart, m.index);
    const suffix = statementFrom(src, m.index);
    const VERB = /(?:^|["'`\s(,])(GET|POST|PATCH|PUT|DELETE)(?:["'`\s),]|$)/;
    const method = (VERB.exec(prefix) || VERB.exec(suffix) || [])[1]
      || (/-X\s+(GET|POST|PATCH|PUT|DELETE)/.exec(prefix + suffix) || [])[1];
    if (!method || method === 'GET') continue; // a read, not a door

    // PAYLOAD. Start the search AFTER the URL string literal closes — a Python
    // f-string URL is full of braces (`?id=eq.{org_id}`) and the first `{`
    // found from the match position is the interpolation, not the body.
    let q = null;
    for (let i = m.index; i >= lineStart; i--) { if (`"'\``.includes(src[i])) { q = src[i]; break; } }
    let urlEnd = m.index;
    if (q) { const e = src.indexOf(q, m.index); urlEnd = e === -1 ? m.index : e + 1; }
    const after = src.slice(urlEnd, urlEnd + 3000);
    let payload = '';
    // `JSON.stringify({...})` (JS) and `json.dumps({...})` (Python) both wrap
    // the body; ingest_field_survey.py PATCHes latitude/longitude through the
    // latter, and without it the coordinate writes read as <unresolved>.
    const enc = /JSON\.stringify\(|json\.dumps\(/.exec(after);
    const js = enc && enc.index < 600 ? enc.index : -1;
    const dash = /-d\s+'/.exec(after);
    if (js !== -1) payload = balancedArg(after, after.indexOf('(', js));
    else if (dash) payload = after.slice(dash.index + dash[0].length - 1);
    else {
      const brace = after.indexOf('{');
      if (brace !== -1 && brace < 600) payload = after.slice(brace);
    }
    let cols = payload ? topLevelKeys(payload) : [];
    if (!cols.length) {
      // `rows[i:i+B]` / `row` / `body` — take the identifier, drop any
      // slice/index suffix, and resolve where it was built.
      const varName = /,\s*([A-Za-z_$][\w$]*)\s*(?:\[[^\]]*\])?\s*[,)]/.exec(after.slice(0, 200))?.[1];
      if (varName && !/^(GET|POST|PATCH|PUT|DELETE)$/i.test(varName)) cols = resolveVar(src, varName);
    }
    if (!cols.length) cols = ['<unresolved>'];
    const served = cols.filter((c) => SERVED[table].has(c));
    sites.push({
      file: label, line: lineNo, table, kind: `rest-${method.toLowerCase()}`,
      columns: cols.sort(), served_columns: served.sort(),
      touches_served: served.length > 0 || cols.includes('<unresolved>') || cols.includes('<spread>'),
      unresolved: cols.includes('<unresolved>'),
      gated: isSelf ? 'sanctioned-door' : fileGated ? 'file-imports-writer' : null,
      waiver: waiverNear(src, m.index),
    });
  }

  // ── raw SQL ──────────────────────────────────────────────────────────────
  const sqlRe = new RegExp(`\\b(UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:public\\.)?(${TABLES.join('|')})\\b`, 'gi');
  const isSql = path.extname(abs) === '.sql';
  while ((m = sqlRe.exec(src))) {
    const verb = m[1].toUpperCase().split(/\s+/)[0].toLowerCase();
    const line = lineOf(src, m.index);
    const lineText = src.split('\n')[line - 1] || '';
    // SQL inside a JS/TS string literal that is being STORED (a `restore:` /
    // `apply:` recovery path) is not a door — it is a recorded undo.
    const literal = !isSql && /(restore|apply|sql|undo|recovery)\s*:/i.test(lineText);
    let cols = [];
    const tail = src.slice(m.index, m.index + 1200);
    if (verb === 'update') {
      const setM = /SET\s+([\s\S]*?)(?:WHERE|;|$)/i.exec(tail);
      if (setM) cols = [...setM[1].matchAll(/([A-Za-z_][\w]*)\s*=/g)].map((x) => x[1]);
    } else if (verb === 'insert') {
      const colM = /INSERT\s+INTO\s+(?:public\.)?\w+\s*\(([^)]*)\)/i.exec(tail);
      if (colM) cols = colM[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean);
    }
    if (!cols.length) cols = ['<unresolved>'];
    const served = cols.filter((c) => SERVED[m[2]].has(c));
    sites.push({
      file: label, line, table: m[2], kind: literal ? 'sql-literal' : `sql-${verb}`,
      columns: cols.sort(), served_columns: served.sort(),
      touches_served: !literal && (served.length > 0 || cols.includes('<unresolved>')),
      unresolved: cols.includes('<unresolved>'),
      gated: literal ? 'recorded-undo-not-executed' : isSelf ? 'sanctioned-door' : null,
      waiver: waiverNear(src, m.index),
    });
  }
  return sites;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const roots = [NUKE];
if (fs.existsSync(LOFFICIEL)) roots.push(LOFFICIEL);

const isLive = buildLiveIndex(roots);
let sites = [];
for (const root of roots) for (const f of walk(root)) sites = sites.concat(scanFile(f, root));

for (const s of sites) {
  s.live = isLive(s.file);
  s.fingerprint = `${s.file}|${s.table}|${s.kind}|${s.columns.join(',')}`;
}
sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const baseline = fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  : { generated_at: null, note: 'run --update-baseline', entries: {} };

// A site NEEDS a gate if it touches a served column and is not the sanctioned
// door, not a recorded undo, and carries no inline waiver.
const needsGate = sites.filter((s) =>
  s.touches_served && !s.gated && !s.waiver && s.kind !== 'sql-literal');

const NEW = needsGate.filter((s) => !baseline.entries[s.fingerprint]);
const GONE = Object.keys(baseline.entries).filter((fp) => !sites.some((s) => s.fingerprint === fp));

if (has('--update-baseline')) {
  const entries = {};
  for (const s of needsGate) {
    const prev = baseline.entries[s.fingerprint];
    entries[s.fingerprint] = {
      file: s.file, line: s.line, table: s.table, kind: s.kind,
      columns: s.columns, served_columns: s.served_columns,
      live: s.live, status: prev?.status ?? (s.live.length ? 'live-ungated' : 'one-off'),
      note: prev?.note ?? '',
    };
  }
  fs.writeFileSync(BASELINE, JSON.stringify({
    generated_at: new Date().toISOString(),
    note: 'Doors that existed when the census was taken. audit-write-paths.mjs fails on any door NOT listed here. Edit `status` and `note` by hand; regenerate with --update-baseline.',
    served_columns: Object.fromEntries(Object.entries(SERVED).map(([k, v]) => [k, [...v].sort()])),
    entries,
  }, null, 2) + '\n');
  console.log(`${C.g}baseline written${C.x} ${path.relative(NUKE, BASELINE)} — ${Object.keys(entries).length} doors recorded`);
  process.exit(0);
}

if (has('--json')) {
  console.log(JSON.stringify({ sites, needs_gate: needsGate.length, new_doors: NEW, closed_doors: GONE }, null, 2));
  process.exit(NEW.length ? 1 : 0);
}

// ── report ────────────────────────────────────────────────────────────────
const byTable = {};
for (const s of sites) (byTable[s.table] ??= []).push(s);

console.log(`\n${C.b}WRITE-PATH CENSUS — organizations / properties / concierge_products${C.x}`);
console.log(`${C.d}roots: ${roots.join(', ')}${C.x}`);
console.log(`${C.d}${sites.length} write sites found · ${needsGate.length} need a gate · ${Object.keys(baseline.entries).length} in baseline${C.x}\n`);

if (has('--list')) {
  for (const t of TABLES) {
    const rows = byTable[t] || [];
    if (!rows.length) continue;
    console.log(`${C.b}${t}${C.x} ${C.d}(${rows.length} sites)${C.x}`);
    for (const s of rows) {
      const status = s.gated ? `${C.g}${s.gated}${C.x}`
        : s.waiver ? `${C.c}waived: ${s.waiver}${C.x}`
        : baseline.entries[s.fingerprint] ? `${C.y}${baseline.entries[s.fingerprint].status}${C.x}`
        : s.touches_served ? `${C.r}UNGATED — NOT IN BASELINE${C.x}` : `${C.d}no served column${C.x}`;
      console.log(`  ${s.file}:${s.line}  ${C.d}${s.kind}${C.x}  ${status}`);
      console.log(`    ${C.d}cols:${C.x} ${s.columns.join(', ')}`);
      if (s.served_columns.length) console.log(`    ${C.y}served:${C.x} ${s.served_columns.join(', ')}`);
      if (s.live.length) console.log(`    ${C.c}live:${C.x} ${s.live.join('; ')}`);
    }
    console.log('');
  }
}

if (GONE.length) {
  console.log(`${C.d}${GONE.length} baseline door(s) no longer present (file moved, deleted, or gated):${C.x}`);
  for (const fp of GONE) console.log(`${C.d}  - ${fp}${C.x}`);
  console.log('');
}

if (NEW.length) {
  console.log(`${C.r}${C.b}FAIL — ${NEW.length} NEW UNGATED WRITE${NEW.length > 1 ? 'S' : ''} TO A SERVED COLUMN${C.x}\n`);
  for (const s of NEW) {
    console.log(`  ${C.r}${s.file}:${s.line}${C.x}  ${s.kind} ${s.table}`);
    console.log(`    columns: ${s.columns.join(', ')}`);
    if (s.served_columns.length) console.log(`    ${C.y}served columns: ${s.served_columns.join(', ')}${C.x}`);
    if (s.unresolved) console.log(`    ${C.d}columns could not be resolved statically — treated as served (fail-closed)${C.x}`);
    if (s.live.length) console.log(`    ${C.c}live: ${s.live.join('; ')}${C.x}`);
  }
  console.log(`\n${C.b}Each of these is a door with nobody at it. Three ways to close it:${C.x}`);
  console.log(`  1. Route the write through ${C.c}writeField/writeFields${C.x} (scripts/entity/write.mjs) — the real fix.`);
  console.log(`  2. If it writes only to metadata/quarantine and never to a surface, say so inline:`);
  console.log(`     ${C.d}// entity-write-gate: allow — preserves a candidate in metadata, never reaches a surface${C.x}`);
  console.log(`  3. If it is deliberate debt, record it: ${C.c}npm run entity:audit-writes -- --update-baseline${C.x}`);
  console.log(`     then edit ${C.d}scripts/entity/write-paths.baseline.json${C.x} and write the real reason in \`note\`.\n`);
  process.exit(1);
}

console.log(`${C.g}${C.b}PASS${C.x} — no ungated write to a served column outside the baseline.\n`);
const debt = Object.values(baseline.entries).filter((e) => e.status === 'live-ungated');
if (debt.length) {
  console.log(`${C.y}Standing debt: ${debt.length} live ungated door(s) recorded in the baseline.${C.x}`);
  for (const e of debt) console.log(`${C.d}  ${e.file}:${e.line} — ${e.table} ${e.kind} [${e.served_columns.join(', ') || e.columns.join(', ')}]${e.note ? ' — ' + e.note : ''}${C.x}`);
  console.log('');
}
process.exit(0);

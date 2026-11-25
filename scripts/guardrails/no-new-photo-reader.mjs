#!/usr/bin/env node
/**
 * GUARDRAIL: no-new-photo-reader
 *
 * Owner direction 2026-11-10 (docs/ledger/theory/data-machine.md, "Image analysis is the model asking", rule 8):
 * no new reader, prompt vocabulary or per-reader table for photos. Extend the registry (observation_properties,
 * grown through schema_proposals), the question store (evidence_judgment_requests) or the landing
 * (ingest-observation with observation_witnesses). On one vehicle five readers had each written their own words
 * into their own table and no observation carried a key; this check exists so the sixth cannot merge unnoticed.
 *
 * It looks only at what a change ADDS, compared with its base:
 *   1. a table created in a new migration that carries a photo key column (image_id, vehicle_image_id, photo_id),
 *      or that names a photo by its hash, path or URL and also holds a reading (a finding, a severity, a box);
 *   2. a new edge function folder whose name says it reads photos;
 *   3. a new script whose path says it reads photos, or that it looks for a flaw ("find rust", "scan for dents").
 * Each fails unless it is listed in scripts/guardrails/photo-stores.allow.json with a reason and where the
 * owner's approval is recorded (for a table: the approved schema_proposals row). An entry there is a statement
 * that the owner approved it; writing one without that is inventing his decision.
 *
 * Usage:
 *   no-new-photo-reader.mjs                 # compare HEAD with its base (CI: HEAD^1; local: merge-base with origin/main)
 *   no-new-photo-reader.mjs --base <rev>    # compare HEAD with <rev>
 * Exit: 0 clean, 1 violation, 2 setup error (the base could not be found).
 *
 * Limits, on purpose: it reads names and CREATE TABLE text, so it cannot see a reader hidden under a neutral
 * name, a prompt vocabulary added to an existing file, or a table created by hand in production. Those need the
 * gates in the writer and the database that the theory card lists as not built yet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements, allowMarkers } from './no-raw-testimony-insert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ALLOW = join(HERE, 'photo-stores.allow.json');
const PHOTO_KEYS = ['image_id', 'vehicle_image_id', 'photo_id'];
// A column that names one photo another way. It counts only when the table also holds a reading (HOLDS_A_READING),
// so a listing's photo_url column is left alone and rust_findings (photo_sha256, severity) is not.
const PHOTO_REF = /^(?:vehicle_)?(?:image|photo|picture)_(?:sha256|sha|hash|md5|path|url|uri|file|filename|key|ref)$/;
const HOLDS_A_READING = /(?<![a-z])(?:finding|detect|analy[sz]|classif|damage|rust|dent|defect|flaw|corrosion|scratch|crack|severity|confidence|bbox)/i;
// Whole words only: "identity" is not a dent, "trust" is not rust, "revision" is not vision.
const word = (alts) => new RegExp(`(?<![a-z])(?:${alts})(?:s|es|d|ed|y|ing)?(?![a-z])`, 'i');
const SUBJECT = /(image|photo|picture|(?<![a-z])vision(?![a-z])|(?<![a-z])frames?(?![a-z]))/i;
const FLAW = word('damage|dent|defect|flaw|corrosion|scratch|crack');
const RUST = word('rust');
const READS = /(analy[sz]|classif|detect|reader|read-|-read|extract|tagger|tagging|label|describ|caption|inspect|recogni|(?<![a-z])vision|ocr)/i;
// Verbs of looking that only count beside a flaw: "find_rust", "scan-for-dents", "crack-finder".
const LOOKS = /(?<![a-z])(?:find|scan|spot|grade|grading|assess|survey)/i;
// A script about a reader that does not itself read a photo: its heartbeat, its watch, its queue.
const BESIDE = /(heartbeat|watch|assay|status|monitor|queue|ledger|receipt-|report)/i;

/** Tables a migration creates that carry a photo key column: [{ table, column }]. */
export function tablesWithPhotoKey(sql) {
  const text = String(sql).replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found = [];
  const re = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  for (let m; (m = re.exec(text));) {
    // walk to the parenthesis that closes the column list
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; }
    const body = text.slice(re.lastIndex, i - 1);
    // split on commas that are not inside parentheses
    const cols = []; let d = 0, start = 0;
    for (let j = 0; j < body.length; j++) {
      if (body[j] === '(') d++; else if (body[j] === ')') d--; else if (body[j] === ',' && d === 0) { cols.push(body.slice(start, j)); start = j + 1; }
    }
    cols.push(body.slice(start));
    const table = m[1].replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
    const names = cols.map((c) => (c.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s/i) ?? [])[1]?.toLowerCase()).filter(Boolean);
    const key = names.find((n) => PHOTO_KEYS.includes(n))
      ?? (HOLDS_A_READING.test([table, ...names].join(' ')) ? names.find((n) => PHOTO_REF.test(n)) : undefined);
    if (key) found.push({ table, column: key });
  }
  return found;
}

/** Does a function folder name or a script path say that it reads photos? */
export function saysItReadsPhotos(nameOrPath) {
  const s = String(nameOrPath).replace(/([a-z0-9])([A-Z])/g, '$1-$2');   // findRust reads as find-Rust
  if ((SUBJECT.test(s) || FLAW.test(s)) && READS.test(s)) return true;
  if ((FLAW.test(s) || RUST.test(s)) && LOOKS.test(s)) return true;
  return RUST.test(s) && READS.test(s) && !/rust-analyzer/i.test(s);     // rust-detector, not the Rust language tool
}

/** Violations for a set of added files. `read(path)` returns a file's text; `existedInBase(path)` says whether a path existed before. */
export function violations(added, { read, existedInBase, allow }) {
  const out = [];
  const seenFn = new Set();
  for (const f of added) {
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(f)) {
      for (const t of tablesWithPhotoKey(read(f))) {
        if (!allow.tables?.[t.table]) out.push({ kind: 'table', what: t.table, where: f, detail: `column ${t.column}` });
      }
    }
    const fn = (f.match(/^supabase\/functions\/([^/_][^/]*)\//) ?? [])[1];
    if (fn && !seenFn.has(fn)) {
      seenFn.add(fn);
      if (!existedInBase(`supabase/functions/${fn}`) && saysItReadsPhotos(fn) && !allow.functions?.[fn]) out.push({ kind: 'function', what: fn, where: f, detail: 'new edge function' });
    }
    if (/^scripts\/.+\.(mjs|cjs|js|ts|py|sh)$/.test(f) && !/(\.test\.|\/test[_-]|_test\.)/.test(f) && !f.startsWith('scripts/guardrails/')) {
      if (saysItReadsPhotos(f) && !BESIDE.test(f.split('/').pop()) && !allow.scripts?.[f]) out.push({ kind: 'script', what: f, where: f, detail: 'new script' });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// Keys into the center (added 2026-11-24 after #3707, which passed this check while ratifying 22 registry rows with no
// proposal). Two more things a change may not ADD in a new migration:
//   4. vocabulary: an observation_properties row written with ratified_at (INSERT with that column, or UPDATE ... SET
//      ratified_at) when the same migration files no schema_proposals row. The registry grows through proposals.
//   5. center-key: a new table with a column that names a vehicle, photo, receipt or observation by id
//      (vehicle_id, image_id, receipt_id, sibling_receipt_id, ...) and no FOREIGN KEY on that column: inline
//      REFERENCES, a table-level FOREIGN KEY, or ALTER TABLE ... ADD ... FOREIGN KEY in the same file. A link held
//      in an unkeyed column is a debt (AGENTS.md, working language).
// A deliberate exception names itself in the file with a reason of 12 characters or more:
//   -- guardrail-allow(ratified-vocabulary): observation_properties: <reason>
//   -- guardrail-allow(center-key-fk): <table>.<column> | <table>: <reason>
// Limits: a migration that inserts its own schema_proposals row passes (static text cannot prove approval: the gate
// for that is a database constraint); a polymorphic pair (origin_table text, origin_id uuid), an id array or an id
// inside jsonb is not seen; columns added to an existing table by ALTER TABLE are not checked.
// ------------------------------------------------------------------------------------------------------------------
export const CENTER_KEY = /^(?:[a-z0-9]+_)*?(vehicle|image|vehicle_image|photo|receipt|receipt_item|observation)_id$/;

const stripSqlComments = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const tableName = (n) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();

/** observation_properties rows ratified in a migration that files no schema_proposals row: [{ statement, line }]. */
export function ratifiedWithoutProposal(sql) {
  const src = String(sql);
  if ((allowMarkers(src).get('ratified-vocabulary') ?? new Set()).has('observation_properties')) return [];
  const text = stripSqlComments(src);
  if (/\binsert\s+into\s+(?:"?public"?\.)?"?schema_proposals\b/i.test(text)) return [];
  const out = [];
  for (const st of splitStatements(src)) {
    const t = stripSqlComments(st.text);
    // a function that reads schema_proposals is the ratifier itself (it sets ratified_at from an approved proposal)
    if (/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(t) && /\bschema_proposals\b/i.test(t)) continue;
    const at = (re) => { for (const m of t.matchAll(re)) out.push({ statement: m[0].replace(/\s+/g, ' ').slice(0, 60), line: src.slice(0, st.start + m.index).split('\n').length }); };
    at(/\binsert\s+into\s+(?:"?public"?\.)?"?observation_properties"?\s*\([^)]*\bratified_at\b[^)]*\)/gi);
    at(/\bupdate\s+(?:only\s+)?(?:"?public"?\.)?"?observation_properties"?(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\b[^;]*?\bratified_at\s*=/gi);
  }
  return out;
}

/** Center-key columns of tables a migration creates that carry no foreign key: [{ table, column }]. */
export function centerKeysWithoutFk(sql) {
  const src = String(sql);
  const allowed = allowMarkers(src).get('center-key-fk') ?? new Set();
  const text = stripSqlComments(src);
  const altered = new Map(); // table -> Set of columns with a FOREIGN KEY added by ALTER TABLE
  for (const m of text.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)([^;]*)/gi)) {
    const t = tableName(m[1]);
    for (const fk of m[2].matchAll(/foreign\s+key\s*\(([^)]*)\)\s*references/gi)) {
      for (const c of fk[1].split(',')) { if (!altered.has(t)) altered.set(t, new Set()); altered.get(t).add(tableName(c.trim())); }
    }
    for (const col of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?[^,]*?\breferences\b/gi)) {
      if (!altered.has(t)) altered.set(t, new Set()); altered.get(t).add(col[1].toLowerCase());
    }
  }
  const out = [];
  const re = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  for (let m; (m = re.exec(text));) {
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; }
    const body = text.slice(re.lastIndex, i - 1);
    const parts = []; let d = 0, start = 0;
    for (let j = 0; j < body.length; j++) {
      if (body[j] === '(') d++; else if (body[j] === ')') d--; else if (body[j] === ',' && d === 0) { parts.push(body.slice(start, j)); start = j + 1; }
    }
    parts.push(body.slice(start));
    const table = tableName(m[1]);
    if (allowed.has(table)) continue;
    const keyed = new Set(altered.get(table) ?? []);
    for (const p of parts) {
      const fk = p.match(/^\s*(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)/i);
      if (fk) for (const c of fk[1].split(',')) keyed.add(tableName(c.trim()));
    }
    for (const p of parts) {
      const col = p.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+([a-z_][a-z0-9_ ]*)/i);
      if (!col || /^(constraint|primary|foreign|unique|check|exclude|like)$/i.test(col[1])) continue;
      const name = col[1].toLowerCase();
      if (!CENTER_KEY.test(name) || /\[\]/.test(p)) continue;
      if (/\breferences\b/i.test(p) || keyed.has(name) || allowed.has(`${table}.${name}`)) continue;
      out.push({ table, column: name });
    }
  }
  return out;
}

/** The key-and-vocabulary violations among added files: [{ kind, what, where, detail }]. */
export function schemaViolations(added, { read }) {
  const out = [];
  for (const f of added) {
    if (!/^supabase\/migrations\/[^/]+\.sql$/.test(f) && !/\.sql$/.test(f)) continue;
    const sql = read(f);
    for (const r of ratifiedWithoutProposal(sql)) out.push({ kind: 'vocabulary', what: 'observation_properties', where: `${f}:${r.line}`, detail: `${r.statement}, no schema_proposals row` });
    for (const k of centerKeysWithoutFk(sql)) out.push({ kind: 'center-key', what: `${k.table}.${k.column}`, where: f, detail: 'no foreign key' });
  }
  return out;
}

function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }

function resolveBase(argv) {
  const i = argv.indexOf('--base');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  try {
    if (process.env.GITHUB_ACTIONS) return git(['rev-parse', '--verify', 'HEAD^1']);
    return git(['merge-base', 'origin/main', 'HEAD']);
  } catch { return null; }
}

function main() {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--files');
  let added, base = null;
  if (fi >= 0) added = argv.slice(fi + 1).filter((a) => !a.startsWith('--'));
  else {
    base = resolveBase(argv);
    if (!base) { console.error('no-new-photo-reader: could not find the base revision to compare with (fetch origin/main, or pass --base <rev>)'); process.exit(2); }
    added = git(['diff', '--name-only', '--diff-filter=A', base, 'HEAD']).split('\n').filter(Boolean);
  }
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const read = (f) => readFileSync(f.startsWith('/') ? f : join(ROOT, f), 'utf8');
  const found = violations(added, {
    read,
    existedInBase: (p) => { if (!base) return true; try { git(['cat-file', '-e', `${base}:${p}`]); return true; } catch { return false; } },
    allow,
  });
  const keys = schemaViolations(added, { read });
  if (argv.includes('--json')) { console.log(JSON.stringify({ added: added.length, photo: found, keys }, null, 2)); process.exit(found.length || keys.length ? 1 : 0); }
  if (!found.length && !keys.length) { console.log(`no-new-photo-reader: clean (${added.length} added files against ${base ? (/^[0-9a-f]{40}$/.test(base) ? base.slice(0, 9) : base) : 'the listed files'})`); return; }
  if (found.length) {
    console.error('no-new-photo-reader: this change adds a new reader or a new store for photos.\n');
    for (const v of found) console.error(`  ${v.kind}: ${v.what} (${v.detail}; ${v.where})`);
    console.error(`
Owner direction, 2026-11-10: a photo reading is finished when it is keyed in the model's own vocabulary with its
photo as witness. Five readers each wrote their own table and none of their observations carried a key.
Read "Image analysis is the model asking" at the top of docs/ledger/theory/data-machine.md, then either:
  - extend what exists: the registry (observation_properties, grown through schema_proposals), the question
    store (evidence_judgment_requests) or the landing (ingest-observation with observation_witnesses); or
  - if the model truly has no place for this, file the place through schema_proposals, and once the owner has
    approved it add an entry to scripts/guardrails/photo-stores.allow.json naming the reason and that approval.
An allowlist entry states that the owner approved it. Do not write one without that.
`);
  }
  if (keys.length) {
    console.error('no-new-photo-reader: this change adds an unkeyed link into the center or ratifies vocabulary without a proposal.\n');
    for (const v of keys) console.error(`  ${v.kind}: ${v.what} (${v.detail}; ${v.where})`);
    console.error(`
AGENTS.md, working language (2026-11-24): a link held in text or an unkeyed column is a debt, and the registry grows
through schema_proposals. Give each center column its FOREIGN KEY (vehicles, vehicle_images, receipts, receipt_items,
vehicle_observations), and file vocabulary as a schema_proposals row instead of writing ratified_at. A deliberate
exception names itself in the migration with a reason:
  -- guardrail-allow(center-key-fk): <table>.<column>: <reason>
  -- guardrail-allow(ratified-vocabulary): observation_properties: <reason>`);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

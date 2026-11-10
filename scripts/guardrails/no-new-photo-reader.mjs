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
 *   1. a table created in a new migration that carries a photo key column (image_id, vehicle_image_id, photo_id);
 *   2. a new edge function folder whose name says it reads photos;
 *   3. a new script whose path says it reads photos.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ALLOW = join(HERE, 'photo-stores.allow.json');
const PHOTO_KEYS = ['image_id', 'vehicle_image_id', 'photo_id'];
const SUBJECT = /(image|photo|picture|vision|frame)/i;
const READS = /(analy[sz]|classif|detect|reader|read-|-read|extract|tagger|tagging|label|describ|caption|inspect|recogni|vision|ocr)/i;
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
    for (const c of cols) {
      const name = (c.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s/i) ?? [])[1]?.toLowerCase();
      if (name && PHOTO_KEYS.includes(name)) { found.push({ table: m[1].replace(/"/g, '').replace(/^public\./i, '').toLowerCase(), column: name }); break; }
    }
  }
  return found;
}

/** Does a function folder name or a script path say that it reads photos? */
export function saysItReadsPhotos(nameOrPath) {
  const s = String(nameOrPath);
  return SUBJECT.test(s) && READS.test(s);
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
  const base = resolveBase(process.argv.slice(2));
  if (!base) { console.error('no-new-photo-reader: could not find the base revision to compare with (fetch origin/main, or pass --base <rev>)'); process.exit(2); }
  const added = git(['diff', '--name-only', '--diff-filter=A', base, 'HEAD']).split('\n').filter(Boolean);
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const found = violations(added, {
    read: (f) => readFileSync(join(ROOT, f), 'utf8'),
    existedInBase: (p) => { try { git(['cat-file', '-e', `${base}:${p}`]); return true; } catch { return false; } },
    allow,
  });
  if (!found.length) { console.log(`no-new-photo-reader: clean (${added.length} added files against ${base.slice(0, 9)})`); return; }
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
An allowlist entry states that the owner approved it. Do not write one without that.`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

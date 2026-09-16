#!/usr/bin/env node
/**
 * GUARDRAIL: no-schema-baked-labels
 *
 * Doctrine: "label as projection of measurement."
 * Categorical labels (condition, category, tier, quality, ...) are DERIVED
 * projections over stored evidence/testimony — never baked into schema as
 * CHECK-constrained enum text columns or CREATE TYPE ... AS ENUM.
 *
 * What it flags in NEW migrations (advisory only — never hard-fails):
 *   1. Columns named *_category/_type/_kind/_tier/_condition/etc. with a
 *      hardcoded allowed-value CHECK (col IN ('a','b')) / = ANY(ARRAY[...]).
 *   2. *_status/_state columns whose value list is NOT a pure workflow set
 *      (pending/running/failed/... is mechanical state and is EXEMPT).
 *   3. CREATE TYPE ... AS ENUM with non-workflow values.
 *
 * Deliberately NOT flagged (precision > recall):
 *   - Workflow/queue state machines (all values in the workflow lexicon).
 *   - Polymorphic discriminators (entity_type, subject_type, target_type...)
 *     — structural routing, not measurement labels.
 *   - Format/technical discriminators (mime_type, content_type, unit...).
 *   - Non-list CHECKs (range, length, boolean, regex).
 *
 * Usage:
 *   no-schema-baked-labels.mjs [file.sql ...]   # check specific files
 *   no-schema-baked-labels.mjs                  # check staged new/modified migrations
 *   no-schema-baked-labels.mjs --all            # scan every migration (audit mode)
 *
 * Exit code: always 0 (advisory). Too many legitimate cases to hard-fail.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = '/Users/skylar/nuke';
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations');
const DOCTRINE = [
  `  Doctrine: docs/library/technical/label-as-projection-of-measurement/ (home)`,
  `            docs/ledger/theory/vehicle-intelligence.md ("never baked as categoricals into schema")`,
  `  Store the evidence tuple (claim, source, method, observed_at, trust) and`,
  `  project the label at read/recompute time. If the set of allowed values can`,
  `  change as understanding improves, it is a projection — not a constraint.`,
].join('\n');

// Column suffixes that denote a categorical LABEL about an entity.
const CATEGORICAL_RE = /(^|_)(category|categories|type|kind|class|classification|tier|grade|condition|quality|label|segment|bucket|rating|style|genre)$/i;
// Column suffixes that denote mechanical state (flag only if values aren't workflow-ish).
const STATE_RE = /(^|_)(status|state|stage|phase)$/i;
// Structural discriminators & technical formats — never measurement labels.
const EXEMPT_COLS = new Set([
  'entity_type', 'subject_type', 'target_type', 'object_type', 'parent_type',
  'owner_type', 'record_type', 'reference_type', 'related_type', 'related_entity_type',
  'resource_type', 'attachment_type', 'mime_type', 'content_type', 'media_type',
  'file_type', 'data_type', 'value_type', 'field_type', 'column_type', 'input_type',
  'event_type', 'action_type', 'operation_type', 'change_type', 'job_type',
  'task_type', 'queue_type', 'trigger_type', 'notification_type', 'message_type',
  'token_type', 'auth_type', 'key_type', 'hash_type',
]);
// Workflow lexicon: if EVERY value in the list is one of these, it's a state
// machine, not a baked label — exempt.
const WORKFLOW_VALUES = new Set([
  'pending', 'queued', 'scheduled', 'running', 'processing', 'in_progress',
  'started', 'active', 'inactive', 'paused', 'resumed', 'retrying', 'retry',
  'complete', 'completed', 'done', 'success', 'succeeded', 'failed', 'failure',
  'error', 'errored', 'cancelled', 'canceled', 'aborted', 'skipped', 'expired',
  'timeout', 'timed_out', 'stale', 'new', 'open', 'closed', 'resolved',
  'draft', 'published', 'unpublished', 'archived', 'deleted', 'sent',
  'delivered', 'received', 'read', 'unread', 'acknowledged', 'submitted',
  'approved', 'rejected', 'denied', 'accepted', 'declined', 'requested',
  'confirmed', 'unconfirmed', 'verified', 'unverified', 'enabled', 'disabled',
  'locked', 'unlocked', 'suspended', 'banned', 'invited', 'joined', 'left',
  'uploading', 'uploaded', 'downloading', 'downloaded', 'syncing', 'synced',
  'importing', 'imported', 'exporting', 'exported', 'extracting', 'extracted',
  'analyzing', 'analyzed', 'reviewing', 'reviewed', 'waiting', 'ready', 'live',
  'ended', 'sold', 'unsold', 'withdrawn', 'reserve_not_met', 'no_reserve',
]);

// ---------------------------------------------------------------------------
// SQL preprocessing: strip comments (line + block) outside string literals.
function stripComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  let inStr = false, inLine = false, inBlock = false, dollarTag = null;
  while (i < n) {
    const c = sql[i], c2 = sql.slice(i, i + 2);
    if (inLine) { if (c === '\n') { inLine = false; out += c; } i++; continue; }
    if (inBlock) { if (c2 === '*/') { inBlock = false; i += 2; } else i++; continue; }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { out += dollarTag; i += dollarTag.length; dollarTag = null; }
      else { out += c; i++; }
      continue;
    }
    if (inStr) { out += c; if (c === "'") { if (sql[i + 1] === "'") { out += "'"; i += 2; continue; } inStr = false; } i++; continue; }
    if (c === "'") { inStr = true; out += c; i++; continue; }
    const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dm) { dollarTag = dm[0]; out += dm[0]; i += dm[0].length; continue; }
    if (c2 === '--') { inLine = true; i += 2; continue; }
    if (c2 === '/*') { inBlock = true; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
function baseName(col) { return col.replace(/^"|"$/g, '').replace(/^.*\./, '').toLowerCase(); }
function parseValues(listSrc) {
  return [...listSrc.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].toLowerCase());
}
function allWorkflow(values) { return values.length > 0 && values.every(v => WORKFLOW_VALUES.has(v)); }

// Widened workflow test for status/state columns: lexicon hit OR workflow
// morphology (pending_x, needs_x, x_review, past-participle/gerund forms).
function workflowish(v) {
  if (WORKFLOW_VALUES.has(v)) return true;
  if (/^(pending|awaiting|needs|in|under|not|un|re|auto)_/.test(v)) return true;
  if (/_(progress|review|reviewed|processing|queue|queued|hold|approval)$/.test(v)) return true;
  if (/(ed|ing)$/.test(v)) return true;
  return false;
}
// A status column is a state machine (exempt) if >= 2/3 of values are workflow-ish.
function mostlyWorkflow(values) {
  if (values.length === 0) return false;
  const hits = values.filter(workflowish).length;
  return hits / values.length >= 2 / 3;
}

// Infra/plumbing tables: a generic *_type/_kind/_class there is a structural
// discriminator, not a measurement label about the world.
const INFRA_TABLE_RE = /(^|_)(queue|queues|log|logs|registry|job|jobs|task|tasks|run|runs|sync|pipeline|audit|cache|cron|webhook|webhooks|notification|notifications|import|imports|export|exports|scrape|scrapes|scraper|schema|schemas|pattern|patterns|tool|tools|migration|migrations|event|events|stage|stages|batch|batches)($|_)/i;
const GENERIC_DISCRIMINATOR_RE = /(^|_)(type|kind|class)$/i;

// Map every position in the SQL to the most recently referenced table name.
function tableRefs(sql) {
  const refs = [];
  const re = /(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?)\s+"?([\w."]+)"?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) refs.push([m.index, baseName(m[1])]);
  return refs;
}
function enclosingTable(refs, index) {
  let name = '';
  for (const [i, t] of refs) { if (i > index) break; name = t; }
  return name;
}

// ---------------------------------------------------------------------------
// Finding extraction
function checkFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const sql = stripComments(raw);
  const refs = tableRefs(sql);
  const findings = [];

  // Pattern A: CHECK ( col [::text] IN ('a','b',...) )
  // Pattern B: CHECK ( col [::text] = ANY (ARRAY['a','b',...]) )
  const checkRe = /CHECK\s*\(\s*\(?\s*"?([A-Za-z_][\w".]*)"?\s*(?:::\s*\w+)?\s*(?:IN\s*\(((?:[^()']|'(?:[^']|'')*')*)\)|=\s*ANY\s*\(\s*(?:ARRAY\s*)?\[((?:[^\[\]']|'(?:[^']|'')*')*)\])/gi;
  let m;
  while ((m = checkRe.exec(sql)) !== null) {
    const col = baseName(m[1]);
    const values = parseValues(m[2] ?? m[3] ?? '');
    if (values.length < 2) continue;               // single-value or non-literal: not an enum bake
    if (EXEMPT_COLS.has(col)) continue;            // structural discriminator
    const isCategorical = CATEGORICAL_RE.test(col);
    const isState = STATE_RE.test(col);
    if (!isCategorical && !isState) continue;      // stay precise: only label-shaped names
    if (isState) {
      if (mostlyWorkflow(values)) continue;        // state machine: exempt
    } else {
      if (allWorkflow(values)) continue;           // pure workflow set: exempt
      // Generic *_type on infra/plumbing tables = structural discriminator.
      const tbl = enclosingTable(refs, m.index);
      if (GENERIC_DISCRIMINATOR_RE.test(col) && INFRA_TABLE_RE.test(tbl)) continue;
    }
    findings.push({
      line: lineOf(sql, m.index),
      kind: isCategorical ? 'baked-categorical-check' : 'non-workflow-status-check',
      column: col,
      values,
    });
  }

  // Pattern C: CREATE TYPE x AS ENUM ('a','b',...)
  const enumRe = /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?\s+AS\s+ENUM\s*\(((?:[^()']|'(?:[^']|'')*')*)\)/gi;
  while ((m = enumRe.exec(sql)) !== null) {
    const typeName = baseName(m[1]);
    const values = parseValues(m[2]);
    if (values.length < 2) continue;
    if (STATE_RE.test(typeName) ? mostlyWorkflow(values) : allWorkflow(values)) continue;
    findings.push({ line: lineOf(sql, m.index), kind: 'create-type-enum', column: typeName, values });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// File selection
function stagedNewMigrations() {
  try {
    const out = execSync(
      'git diff --cached --name-only --diff-filter=AM -- "supabase/migrations/*.sql"',
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    return out.split('\n').filter(Boolean).map(f => path.join(REPO_ROOT, f)).filter(existsSync);
  } catch { return []; }
}

const args = process.argv.slice(2);
let files;
if (args.includes('--all')) {
  const { readdirSync } = await import('node:fs');
  files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    .map(f => path.join(MIGRATIONS_DIR, f));
} else if (args.length > 0) {
  files = args.filter(a => a.endsWith('.sql')).map(a => path.resolve(REPO_ROOT, a)).filter(existsSync);
} else {
  files = stagedNewMigrations();
}

if (files.length === 0) { process.exit(0); }  // nothing to check, stay silent

let total = 0;
const perFile = [];
for (const f of files) {
  let findings = [];
  try { findings = checkFile(f); } catch (e) { continue; }  // unreadable/unparsable: never block
  if (findings.length) { perFile.push([f, findings]); total += findings.length; }
}

if (total === 0) process.exit(0);

console.log(`\n[guardrail: no-schema-baked-labels] ADVISORY — ${total} baked-label pattern(s) in ${perFile.length} migration(s)\n`);
for (const [f, findings] of perFile) {
  console.log(`  ${path.relative(REPO_ROOT, f)}`);
  for (const fd of findings) {
    const vals = fd.values.slice(0, 6).map(v => `'${v}'`).join(', ') + (fd.values.length > 6 ? `, … +${fd.values.length - 6}` : '');
    console.log(`    L${fd.line} [${fd.kind}] ${fd.column}: ${vals}`);
  }
}
console.log(`\n  A CHECK-constrained label freezes today's vocabulary into the schema; the`);
console.log(`  doctrine is "label as projection of measurement" — store evidence, derive labels.`);
console.log(DOCTRINE);
console.log(`\n  Advisory only — this does not block. If the column is a genuine state machine`);
console.log(`  or structural discriminator, ignore this warning.\n`);
process.exit(0);  // never hard-fail

#!/usr/bin/env node
/**
 * books:recategorize: move posted QuickBooks lines to the accounts the owner approved, through
 * quickbooks-connect?action=recategorize. Dry run by default.
 *
 * The batch file lives OUTSIDE this repo, because it holds amounts and payees and the repo is public.
 * This script refuses a batch file or a receipt path inside the repo. Batch shape (extra fields ignored):
 *   { "batch_id": "...",
 *     "patterns": [ { "id": "A", "changes": [ { "qb_id": "purchase-<Id>-<n>", "expect_account": "...", "to_account": "..." } ] } ],
 *     "approval": { "approved_by": "...", "approved_at": "<ISO time>", "ref": "<where the owner said yes>",
 *                   "patterns": ["A", ...], "plan_sha256": "<from a dry run of exactly those patterns>" } }
 * Only the owner approves. The approval block records his yes, given in chat for those patterns, after he
 * saw that dry run.
 *
 *   dotenvx run -- node scripts/books/qb-recategorize.mjs <batch.json> [--patterns=A,B]   plans only, prints plan_sha256
 *   dotenvx run -- node scripts/books/qb-recategorize.mjs <batch.json> --apply             applies approval.patterns only
 *
 * --apply plans again first and stops if the plan no longer matches approval.plan_sha256. The function
 * checks the same hash against live QuickBooks before it writes anything.
 * Every run writes a receipt to <batch dir>/receipts/: each line's QBO id, from and to account, SyncToken,
 * status and error. After an apply it re-pulls posted lines (action=pull_transactions). It then checks
 * that each applied line shows its new account in qb_transactions, and adds the result to the receipt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const REPO = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const BASE = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const die = (msg) => { console.error(`books:recategorize: ${msg}`); process.exit(1); };
if (!BASE || !KEY) die('missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run under dotenvx)');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const batchPath = argv.find((a) => !a.startsWith('--'));
const patternArg = (argv.find((a) => a.startsWith('--patterns=')) || '').slice('--patterns='.length);
if (!batchPath) die('usage: qb-recategorize.mjs <batch.json> [--patterns=A,B] [--apply]');

const insideRepo = (p) => {
  const rel = path.relative(REPO, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const batchFile = fs.realpathSync(path.resolve(batchPath));
if (insideRepo(batchFile)) die('the batch file is inside the repo; keep it outside (it holds private amounts and payees)');
const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
if (typeof batch.batch_id !== 'string' || !Array.isArray(batch.patterns)) die('batch needs batch_id and patterns[]');

const receiptDir = path.join(path.dirname(batchFile), 'receipts');
if (insideRepo(receiptDir)) die('receipt directory would be inside the repo');

const approval = batch.approval ?? null;
let chosen = patternArg ? patternArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
if (APPLY) {
  if (!approval) die('--apply needs an approval block in the batch (the owner\'s yes, recorded after a dry run)');
  for (const k of ['approved_by', 'approved_at', 'ref', 'plan_sha256']) if (typeof approval[k] !== 'string' || !approval[k].trim()) die(`approval.${k} is missing`);
  if (!Array.isArray(approval.patterns) || !approval.patterns.length) die('approval.patterns is empty');
  if (chosen && chosen.slice().sort().join(',') !== approval.patterns.slice().sort().join(',')) die('--patterns differs from approval.patterns');
  chosen = approval.patterns;
}
const byId = new Map(batch.patterns.map((p) => [p.id, p]));
const selected = chosen ?? batch.patterns.filter((p) => Array.isArray(p.changes) && p.changes.length).map((p) => p.id);
for (const id of selected) if (!byId.get(id)?.changes?.length) die(`pattern ${id} is not in the batch or has no changes`);
const changes = selected.flatMap((id) => byId.get(id).changes.map((c) => ({ qb_id: c.qb_id, expect_account: c.expect_account, to_account: c.to_account })));

async function call(action, body, query = '') {
  const res = await fetch(`${BASE}/functions/v1/quickbooks-connect?action=${action}${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function writeReceipt(mode, extra) {
  fs.mkdirSync(receiptDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(receiptDir, `qb-recategorize-${batch.batch_id}-${stamp}-${mode}.json`);
  fs.writeFileSync(file, JSON.stringify({ run_at: new Date().toISOString(), mode, batch_file: batchFile, batch_id: batch.batch_id, patterns: selected, ...extra }, null, 1));
  return file;
}

const show = (lines) => {
  const t = {};
  for (const l of lines ?? []) t[l.status] = (t[l.status] ?? 0) + 1;
  console.log(`  lines: ${JSON.stringify(t)}`);
  for (const l of lines ?? []) {
    if (l.status !== 'ready' || l.applied === false) console.log(`  ${l.qb_id} ${l.status}${l.error ? ` ERROR ${l.error}` : ''}${l.reason ? ` (${l.reason})` : ''}`);
  }
};

console.log(`batch ${batch.batch_id}: ${changes.length} changes in patterns ${selected.join(',')}`);
const plan = await call('recategorize', { batch_id: batch.batch_id, changes });
if (plan.status !== 200) die(`dry run HTTP ${plan.status}: ${JSON.stringify(plan.json).slice(0, 300)}`);
show(plan.json.lines);
console.log(`  plan_sha256 ${plan.json.plan_sha256}`);

if (!APPLY) {
  const file = writeReceipt('dry-run', { plan_sha256: plan.json.plan_sha256, response: plan.json });
  console.log(`dry run only; receipt ${file}`);
  console.log(`to apply after the owner's yes: add "approval": {"approved_by","approved_at","ref","patterns": ${JSON.stringify(selected)}, "plan_sha256": "${plan.json.plan_sha256}"} to the batch, then --apply`);
  process.exit(0);
}

if (plan.json.plan_sha256 !== approval.plan_sha256) {
  const file = writeReceipt('refused', { plan_sha256: plan.json.plan_sha256, approved_plan_sha256: approval.plan_sha256, response: plan.json });
  die(`the plan changed since it was approved (now ${plan.json.plan_sha256}); nothing written. receipt ${file}`);
}

const applied = await call('recategorize', {
  batch_id: batch.batch_id,
  changes,
  dry_run: false,
  plan_sha256: approval.plan_sha256,
  approval: { approved_by: approval.approved_by, approved_at: approval.approved_at, ref: approval.ref },
});
const lines = applied.json.lines ?? [];
show(lines);
const receipt = {
  approval,
  plan_sha256: approval.plan_sha256,
  http_status: applied.status,
  summary: applied.json.summary ?? null,
  lines: lines.map((l) => ({ qb_id: l.qb_id, status: l.status, applied: l.applied ?? false, from_account: l.from_account ?? null, to_account: l.to_account ?? null, sync_token: l.sync_token ?? null, new_sync_token: l.new_sync_token ?? null, error: l.error ?? l.reason ?? null })),
};
const file = writeReceipt('applied', receipt);
console.log(`applied: ${JSON.stringify(applied.json.summary ?? applied.json.error)}; receipt ${file}`);

// Refresh the mirror through the function's own path, then check each applied line landed.
const done = lines.filter((l) => l.applied === true);
if (done.length) {
  const sb = createClient(BASE, KEY, { auth: { persistSession: false } });
  const { data: before, error } = await sb.from('qb_transactions').select('qb_id, date').in('qb_id', done.map((l) => l.qb_id));
  if (error) die(`could not read qb_transactions: ${error.message}`);
  const since = (before ?? []).map((r) => r.date).sort()[0];
  const pull = since ? await call('pull_transactions', null, `&since=${since}`) : { status: 0, json: { error: 'no dates for the applied lines' } };
  const { data: after } = await sb.from('qb_transactions').select('qb_id, line_account_name').in('qb_id', done.map((l) => l.qb_id));
  const now = new Map((after ?? []).map((r) => [r.qb_id, r.line_account_name]));
  const verification = done.map((l) => ({ qb_id: l.qb_id, expected: l.to_account?.name, mirror: now.get(l.qb_id) ?? null, ok: now.get(l.qb_id) === l.to_account?.name }));
  receipt.repull = { since, http_status: pull.status, result: pull.json };
  receipt.verification = verification;
  fs.writeFileSync(file, JSON.stringify({ run_at: new Date().toISOString(), mode: 'applied', batch_file: batchFile, batch_id: batch.batch_id, patterns: selected, ...receipt }, null, 1));
  const bad = verification.filter((v) => !v.ok).length;
  console.log(`re-pull since ${since}: HTTP ${pull.status}; verified ${verification.length - bad}/${verification.length} lines in qb_transactions${bad ? ` (${bad} did not match: see receipt)` : ''}`);
  if (bad) process.exitCode = 2;
}
if (applied.status !== 200 || applied.json.success === false) process.exitCode = process.exitCode || 1;

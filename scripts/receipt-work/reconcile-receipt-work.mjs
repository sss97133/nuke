#!/usr/bin/env node
// Department: receipt-to-work evidence reconciliation. Producer for every vehicle with linked receipts.
//
// Deterministic, no model calls. For each vehicle it reads public.receipt_work_lines (migration 20261111210000: receipt lines x
// EXIF-dated, gate-approved photos by zone x work_sessions x timeline_events), writes one signed garage_derivation_evidence row
// (kind receipt_work_correlation) per line as it is concluded, and — the trigger — raises a parameterized
// evidence_judgment_requests row wherever a photographed zone after purchase needs a visual judgment ("is this part visible
// installed in these frames?"). Agents/models answer those later; nothing here claims an installation.
//
// Append-only re-runs: an unchanged conclusion (same subject, same content hash) is skipped; a changed one is written and the
// previous active row is superseded (superseded_by = the new row). Judgment requests are idempotent on question + subject + cited frames.
// Undo a run: rollback_garage_derivation_run(run_id, reason, false) and rollback_evidence_judgment_run(run_id, reason, false).
//
//   node scripts/receipt-work/reconcile-receipt-work.mjs --user-id <uuid> [--vehicle-id <uuid> ...] [--window-days 90]
//        [--run-id <uuid>] [--no-db] [--out scratch.jsonl]
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromReceiptWorkLine, canonical, sha256, producerVersion, PRODUCER_AGENT } from '../garage/derivation-evidence.mjs';

export const SCRIPT = 'scripts/receipt-work/reconcile-receipt-work.mjs';
export const DEPARTMENT = 'receipt_work_reconciliation';
export const QUESTION = 'receipt_part_visible';
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';

export const ANSWER_SCHEMA = {
  type: 'object', required: ['visible', 'installed', 'confidence'],
  properties: {
    visible: { enum: ['yes', 'no', 'cannot_tell'], description: 'the part named on the receipt line is visible in at least one cited frame' },
    installed: { enum: ['yes', 'no', 'cannot_tell'], description: 'it is mounted on this vehicle (not loose, boxed, or on a bench)' },
    image_id: { type: ['string', 'null'], description: 'the cited frame that shows it best (must be one of candidate_image_ids)' },
    bbox: { type: ['array', 'null'], description: '[x1,y1,x2,y2] 0-999 on that frame' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    quote: { type: 'string', description: 'what in the frame shows it, in a sentence' },
  },
};

// The trigger: which conclusions need a judgment, and the parameterized question for one.
export function judgmentFor(row, evidence, { runId, version }) {
  if (!row.judgment_needed || !row.item_id || !(row.image_ids ?? []).length) return null;
  const candidate_image_ids = [...row.image_ids];
  const params = {
    question: 'Is the part on this receipt line visible, installed on this vehicle, in any of the candidate frames?',
    receipt_item_id: row.item_id, receipt_id: row.receipt_id, vehicle_id: row.vehicle_id, vendor_name: row.vendor_name,
    description: row.description, part_number: row.part_number, total_price: row.total_price, purchase_date: row.anchor_date,
    zone: row.zone, end_hint: row.end_hint, candidate_image_ids, days_to_first_photo: row.days_to_first_photo,
    trigger_conclusion: row.conclusion, logic_version: row.logic_version,
  };
  const dedupe_key = sha256(canonical({ d: DEPARTMENT, q: QUESTION, s: row.item_id, imgs: [...candidate_image_ids].sort(), lv: row.logic_version }));
  return {
    department: DEPARTMENT, question_kind: QUESTION, subject_table: 'receipt_items', subject_id: row.item_id,
    vehicle_id: row.vehicle_id, user_id: row.user_id, params, answer_schema: ANSWER_SCHEMA,
    priority: Math.max(0, Math.min(10000, Math.round(Number(row.total_price) || 0))),
    trigger_evidence_dedupe_key: evidence.dedupe_key,
    producer_agent: PRODUCER_AGENT, producer_script: SCRIPT, producer_version: version, run_id: runId, dedupe_key,
  };
}

function client({ url, key }) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const req = async (path, init = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120000) });
      if (res.ok) { const t = await res.text(); return t ? JSON.parse(t) : null; }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
  };
  return { req };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const many = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
  const userId = opt('--user-id');
  if (!userId) throw new Error('--user-id required');
  const noDb = argv.includes('--no-db');
  const windowDays = Number(opt('--window-days', 90));
  const runId = opt('--run-id', randomUUID());
  const out = opt('--out');
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY required (reads go through the service role)');
  const db = client({ url: env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? PROJECT_URL, key });
  const version = producerVersion(SCRIPT);
  const ctx = { version };

  let vehicles = many('--vehicle-id');
  if (!vehicles.length) {
    const links = await db.req(`receipt_vehicle_links?select=vehicle_id&status=eq.linked&retired_at=is.null&user_id=eq.${userId}&vehicle_id=not.is.null&limit=100000`);
    vehicles = [...new Set(links.map((l) => l.vehicle_id))];
  }
  const summary = { run_id: runId, producer_version: version, window_days: windowDays, dry_run: noDb, vehicles: {}, written: 0, unchanged: 0, superseded: 0, judgments: 0, errors: [] };
  const scratch = [];
  for (const vid of vehicles) {
    const vs = (summary.vehicles[vid] = { lines: 0, conclusions: {}, judgments: 0 });
    let rows;
    try { rows = await db.req('rpc/receipt_work_lines', { method: 'POST', body: JSON.stringify({ p_vehicle_id: vid, p_window_days: windowDays }) }); }
    catch (e) { summary.errors.push(`${vid}: ${e.message}`); continue; }
    const active = noDb ? [] : await db.req(`garage_derivation_evidence?select=id,subject_key,content_hash&kind=eq.receipt_work_correlation&vehicle_id=eq.${vid}&superseded_at=is.null&limit=100000`);
    const bySubject = new Map(active.map((a) => [a.subject_key, a]));
    for (const row of rows) {
      vs.lines++; vs.conclusions[row.conclusion] = (vs.conclusions[row.conclusion] ?? 0) + 1;
      const ev = fromReceiptWorkLine(row, { runId }, ctx);
      const jr = judgmentFor(row, ev, { runId, version });
      scratch.push({ evidence: ev, judgment: jr });
      if (jr) vs.judgments++;
      if (noDb) continue;
      const prior = bySubject.get(ev.subject_key);
      if (prior && prior.content_hash === ev.content_hash) { summary.unchanged++; }
      else {
        const [ins] = await db.req('garage_derivation_evidence?on_conflict=dedupe_key&select=id', { method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([ev]) });
        summary.written++;
        if (prior && ins?.id) {
          await db.req(`garage_derivation_evidence?id=eq.${prior.id}&superseded_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ superseded_at: new Date().toISOString(), superseded_by: ins.id, superseded_reason: `re-derived by run ${runId}` }) });
          summary.superseded++;
        }
      }
      if (jr) {
        await db.req('evidence_judgment_requests?on_conflict=dedupe_key', { method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([jr]) });
        summary.judgments++;
      }
    }
  }
  if (out) writeFileSync(out, scratch.map((s) => JSON.stringify(s)).join('\n') + '\n');
  summary.rollback = [`select * from rollback_garage_derivation_run('${runId}', '<reason>', false);`,
    `select * from rollback_evidence_judgment_run('${runId}', '<reason>', false);`];
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s, null, 1)); process.exitCode = s.errors.length ? 1 : 0; })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}

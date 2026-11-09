#!/usr/bin/env node
// Department: receipt-to-work evidence reconciliation. Producer for every vehicle with linked receipts.
//
// Deterministic, no model calls (it does read and write the database over the Supabase REST API). For each vehicle it reads
// public.receipt_work_lines (migration 20261111210000: receipt lines x EXIF-dated, eligible photos by zone x work_sessions x
// timeline_events), writes one signed garage_derivation_evidence row (kind receipt_work_correlation) per line, and — the
// trigger — raises a parameterized evidence_judgment_requests row wherever a photographed zone after purchase needs a visual
// judgment. Every row is a proposed contextual relationship, never proof; nothing here claims an installation.
//
// Lifecycle (append-only, every change signed with this run):
//   - unchanged subject (same content hash): skipped; changed: new row written, prior superseded (superseded_by = new row)
//   - vanished subject (line removed, receipt removed/superseded/duplicate, link retired): a 'source_withdrawn' retraction
//     row is written and the prior row superseded by it. Vehicles are discovered from active links AND from active
//     evidence or live judgments, so retiring a vehicle's last link still reaches it.
//   - judgments: identity is the question content (question_hash over the params); raise_evidence_judgment inserts new
//     content, revives identical content that was cancelled/withdrawn, and leaves open or answered identical content alone.
//     Any pending, claimed or answered question this run no longer asks is retired (cancelled / withdrawn, answer kept),
//     with the reason: content_changed (superseded_by the new question), frame_withdrawn, source_withdrawn or not_asked.
// Undo a run: rollback_garage_derivation_run(run_id, reason, false) and rollback_evidence_judgment_run(run_id, reason, false).
//
//   node scripts/receipt-work/reconcile-receipt-work.mjs --user-id <uuid> [--vehicle-id <uuid> ...] [--window-days 90]
//        [--run-id <uuid>] [--no-db] [--out scratch.jsonl]
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromReceiptWorkLine, retractionFromReceiptWork, canonical, sha256, producerVersion, PRODUCER_AGENT, RECEIPT_WORK_RELATIONSHIP } from '../garage/derivation-evidence.mjs';

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

// The trigger: which conclusions need a judgment, and the parameterized question for one. Identity is the question's content.
export function judgmentFor(row, evidence, { runId, version }) {
  if (!row.judgment_needed || !row.item_id || !(row.image_ids ?? []).length) return null;
  if (!row.question_context) throw new Error(`receipt_work_lines row for item ${row.item_id} has no question_context (reader older than this producer)`);
  const candidate_image_ids = [...row.image_ids];
  const params = {
    question: 'Is the part on this receipt line visible, installed on this vehicle, in any of the candidate frames?',
    receipt_item_id: row.item_id, receipt_id: row.receipt_id, vehicle_id: row.vehicle_id, vendor_name: row.vendor_name,
    description: row.description, part_number: row.part_number, total_price: row.total_price, purchase_date: row.anchor_date,
    anchor_source: row.anchor_source, zone: row.zone, end_hint: row.end_hint, candidate_image_ids, days_to_first_photo: row.days_to_first_photo,
    trigger_conclusion: row.conclusion, logic_version: row.logic_version,
    // what an answer may and may not mean: a model's visual reading of a proposed context, not an owner Sign or proof of payment
    relationship: RECEIPT_WORK_RELATIONSHIP(row.relationship_status),
    printed_claims: evidence.evidence.printed_claims, source_custody: evidence.evidence.source_custody,
    lineage: evidence.evidence.lineage, reader_ineligible: row.reader_ineligible ?? {},
    // the canonical context computed by receipt_work_lines; claims and answers recompute it and refuse on any change
    context: row.question_context ?? null,
  };
  const question_hash = questionHash(params);
  const dedupe_key = sha256(canonical({ d: DEPARTMENT, q: QUESTION, s: row.item_id, qh: question_hash }));
  return {
    department: DEPARTMENT, question_kind: QUESTION, subject_table: 'receipt_items', subject_id: row.item_id,
    vehicle_id: row.vehicle_id, user_id: row.user_id, params, answer_schema: ANSWER_SCHEMA,
    priority: Math.max(0, Math.min(10000, Math.round(Number(row.total_price) || 0))),
    trigger_evidence_dedupe_key: evidence.dedupe_key,
    producer_agent: PRODUCER_AGENT, producer_script: SCRIPT, producer_version: version, run_id: runId, dedupe_key, question_hash,
  };
}
export const questionHash = (params) => sha256(canonical({ params, answer_schema: ANSWER_SCHEMA }));

// Live questions (pending, claimed, answered) for a vehicle that this run did not ask again.
export function staleJudgments(open, wanted) {
  return (open ?? []).filter((j) => ['pending', 'claimed', 'answered'].includes(j.status ?? 'pending') && !wanted.has(j.dedupe_key));
}

// Why a stale question is retired: a withdrawn source wins, then a withdrawn frame, then replaced content, else not asked.
const SOURCE_PROBLEMS = ['receipt_removed', 'receipt_superseded', 'receipt_duplicate', 'link_retired', 'line_removed', 'context_missing'];
export function retireKind(problems, replacement) {
  const p = problems ?? [];
  if (p.some((x) => SOURCE_PROBLEMS.includes(x))) return { kind: 'source_withdrawn', reason: p.filter((x) => SOURCE_PROBLEMS.includes(x)).join(', ') };
  if (p.some((x) => x.startsWith('frame_ineligible:'))) return { kind: 'frame_withdrawn', reason: p.filter((x) => x.startsWith('frame_ineligible:')).join(', ') };
  if (replacement) return { kind: 'content_changed', reason: p.includes('line_changed') ? 'line changed; re-asked with the current content' : 're-asked with changed content' };
  return { kind: 'not_asked', reason: p.length ? p.join(', ') : 'no longer asked by this producer' };
}

// Vehicles to visit: those with active links, plus those that still carry this department's active evidence or live questions.
export async function discoverVehicles(db, userId) {
  const sets = await Promise.all([
    db.req(`receipt_vehicle_links?select=vehicle_id&status=eq.linked&retired_at=is.null&user_id=eq.${userId}&vehicle_id=not.is.null&limit=100000`),
    db.req(`garage_derivation_evidence?select=vehicle_id&kind=eq.receipt_work_correlation&user_id=eq.${userId}&superseded_at=is.null&limit=100000`),
    db.req(`evidence_judgment_requests?select=vehicle_id&department=eq.${DEPARTMENT}&user_id=eq.${userId}&status=in.(pending,claimed,answered)&limit=100000`),
  ]);
  return [...new Set(sets.flat().map((r) => r.vehicle_id).filter(Boolean))];
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
  if (!vehicles.length) vehicles = await discoverVehicles(db, userId);
  const summary = { run_id: runId, producer_version: version, window_days: windowDays, dry_run: noDb, vehicles: {}, written: 0, unchanged: 0,
    superseded: 0, retracted: 0, judgments: 0, judgments_inserted: 0, judgments_revived: 0, judgments_unchanged: 0, judgments_retired: {}, errors: [] };
  const scratch = [];
  const rpc = (fn, body) => db.req(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  const supersede = (priorId, newId, reason) => db.req(`garage_derivation_evidence?id=eq.${priorId}&superseded_at=is.null`, { method: 'PATCH',
    headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ superseded_at: new Date().toISOString(), superseded_by: newId, superseded_reason: reason }) });
  const insertEvidence = async (ev) => (await db.req('garage_derivation_evidence?on_conflict=dedupe_key&select=id', { method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([ev]) }))?.[0];
  for (const vid of vehicles) {
    const vs = (summary.vehicles[vid] = { lines: 0, conclusions: {}, judgments: 0, withdrawn_subjects: {} });
    try {
      const rows = await rpc('receipt_work_lines', { p_vehicle_id: vid, p_window_days: windowDays });
      const withdrawals = await rpc('receipt_work_withdrawals', { p_vehicle_id: vid });
      for (const w of withdrawals) vs.withdrawn_subjects[w.reason] = (vs.withdrawn_subjects[w.reason] ?? 0) + 1;
      const active = noDb ? [] : await db.req(`garage_derivation_evidence?select=id,subject_key,content_hash&kind=eq.receipt_work_correlation&vehicle_id=eq.${vid}&superseded_at=is.null&limit=100000`);
      const bySubject = new Map(active.map((a) => [a.subject_key, a]));
      const wanted = new Map();
      for (const row of rows) {
        vs.lines++; vs.conclusions[row.conclusion] = (vs.conclusions[row.conclusion] ?? 0) + 1;
        const ev = fromReceiptWorkLine(row, { runId }, ctx);
        const jr = judgmentFor(row, ev, { runId, version });
        scratch.push({ evidence: ev, judgment: jr });
        if (jr) { vs.judgments++; wanted.set(jr.dedupe_key, jr); }
        if (noDb) continue;
        const prior = bySubject.get(ev.subject_key);
        if (prior && prior.content_hash === ev.content_hash) { summary.unchanged++; continue; }
        const ins = await insertEvidence(ev);
        summary.written++;
        if (prior && ins?.id) { await supersede(prior.id, ins.id, `re-derived by run ${runId}`); summary.superseded++; }
      }
      // vanished subjects: a signed retraction supersedes the old conclusion
      for (const w of withdrawals) {
        const ret = retractionFromReceiptWork(w, { runId, vehicleId: vid, userId: w.user_id ?? userId }, ctx);
        scratch.push({ evidence: ret, judgment: null });
        if (noDb) continue;
        const ins = await insertEvidence(ret);
        if (ins?.id) { await supersede(w.evidence_id, ins.id, `source withdrawn (${w.reason}), run ${runId}`); summary.retracted++; }
      }
      if (noDb) continue;
      const raised = new Map();
      for (const jr of wanted.values()) {
        const [r] = await rpc('raise_evidence_judgment', { p_row: jr, p_run_id: runId });
        raised.set(jr.dedupe_key, r);
        summary.judgments++; summary[`judgments_${r.action}`] = (summary[`judgments_${r.action}`] ?? 0) + 1;
      }
      const live = await db.req(`evidence_judgment_requests?select=id,dedupe_key,subject_id,status&department=eq.${DEPARTMENT}&question_kind=eq.${QUESTION}&vehicle_id=eq.${vid}&status=in.(pending,claimed,answered)&limit=100000`);
      const replacementFor = new Map([...wanted.values()].map((jr) => [jr.subject_id, raised.get(jr.dedupe_key)?.id]));
      for (const s of staleJudgments(live, wanted)) {
        const problems = await rpc('evidence_judgment_ineligibility', { p_id: s.id });
        const replacement = replacementFor.get(s.subject_id) ?? null;
        const { kind, reason } = retireKind(problems, replacement);
        const to = await rpc('retire_evidence_judgment', { p_id: s.id, p_run_id: runId, p_kind: kind, p_reason: `${reason} (run ${runId})`,
          p_superseded_by: kind === 'content_changed' ? replacement : null });
        if (to !== 'unchanged') summary.judgments_retired[`${kind}:${to}`] = (summary.judgments_retired[`${kind}:${to}`] ?? 0) + 1;
      }
    } catch (e) { summary.errors.push(`${vid}: ${e.message}`); }
  }
  if (out) writeFileSync(out, scratch.map((x) => JSON.stringify(x)).join('\n') + '\n');
  summary.rollback = [`select * from rollback_garage_derivation_run('${runId}', '<reason>', false);`,
    `select * from rollback_evidence_judgment_run('${runId}', '<reason>', false);`];
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s, null, 1)); process.exitCode = s.errors.length ? 1 : 0; })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}

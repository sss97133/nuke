#!/usr/bin/env node
// Answerer for receipt_part_visible questions (department receipt_work_reconciliation, raised by reconcile-receipt-work.mjs).
// A reader looks at the candidate frames of one receipt line BLIND and answers the closed question: is the part on the line
// visible, and is it installed on this vehicle. Claimed through claim_evidence_judgments, which orders by priority (the
// line's amount, highest first), so a capped run spends its reads on the most money first. Answers land only through
// answer_evidence_judgment, which re-checks eligibility and the answer shape; nothing else is written.
//
// Blind: the task carries the line's words (description, part number) and the photo zone the reconciliation inferred, never
// the vendor, the price, the dates, an earlier answer or the asker's conclusion (BLIND_FIELDS). The reader is the
// subscription CLI (`claude -p`, the owner's login, cost 0) reading task.json and the frames from a fresh temp dir with the
// Read tool only; the answer records the model id the CLI reports.
//
//   cd ~/nuke && dotenvx run -q -- node scripts/receipt-work/answer-receipt-parts.mjs [--limit 6] [--reclaim-minutes 30]
//        [--dry-run] [--out file.json] [--owner <uuid>]   (--owner/--out are passed by the subscription batch)
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { producerVersion } from '../garage/derivation-evidence.mjs';
import { client, arg } from '../doubts/db.mjs';
import { runClaudeCli, readCliResult, answerJsonFrom, isUsageLimit } from '../doubts/readers.mjs';
import { DEPARTMENT, QUESTION, ANSWER_SCHEMA } from './reconcile-receipt-work.mjs';

export const SCRIPT = 'scripts/receipt-work/answer-receipt-parts.mjs';
export const AGENT = 'receipt-part-reader';
export const MAX_LIMIT = 20;
export const IMAGE_EDGE = 1600;
// The only fields of a question's params a reader is shown.
export const BLIND_FIELDS = ['description', 'part_number', 'zone', 'end_hint'];

const RULES = [
  'You are a blind reader. Use ONLY the frames in this folder and the receipt line words in this file.',
  'visible: "yes" when the part the line names can be seen in at least one frame; "no" when the frames show the area where it would be and it is not there or not shown; "cannot_tell" when the frames do not let you decide.',
  'installed: "yes" only when it is mounted on this vehicle; "no" when it is loose, boxed, on a bench or on another vehicle; "cannot_tell" otherwise.',
  'image_id: the frame that shows it best (required when visible is "yes"; one of the image ids listed in frames); bbox: [x1,y1,x2,y2] on that frame, 0-999, or null.',
  'confidence 0..1. quote: one sentence on what in the frame shows it. Never guess: cannot_tell is an answer.',
];

// The blind task for one question: whitelisted line words, the frames as files, the closed answer format.
export function buildTask(params, frames) {
  const line = {};
  for (const k of BLIND_FIELDS) if (params[k] != null && params[k] !== '') line[k] = params[k];
  return {
    question: 'Is the part on this receipt line visible, installed on this vehicle, in any of these frames?',
    receipt_line: line,
    frames,
    rules: RULES,
    answer_format: { visible: 'yes|no|cannot_tell', installed: 'yes|no|cannot_tell', image_id: 'one of the frame image ids, or null',
      bbox: '[x1,y1,x2,y2] 0-999, or null', confidence: '0..1', quote: 'one sentence' },
  };
}

// Only the schema's keys survive; nothing else a model wrote reaches the store.
export function closedAnswer(a) {
  const out = {};
  for (const k of Object.keys(ANSWER_SCHEMA.properties)) if (a?.[k] !== undefined) out[k] = a[k];
  if (typeof out.confidence === 'string' && out.confidence.trim() !== '' && Number.isFinite(Number(out.confidence))) out.confidence = Number(out.confidence);
  return out;
}

// Local mirror of receipt_part_visible_answer_problems (the store refuses the same things).
export function answerProblems(params, a) {
  const p = []; const yn = ['yes', 'no', 'cannot_tell']; const cand = params.candidate_image_ids ?? [];
  if (!yn.includes(a.visible)) p.push('visible must be yes|no|cannot_tell');
  if (!yn.includes(a.installed)) p.push('installed must be yes|no|cannot_tell');
  if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1) p.push('confidence must be a number within 0..1');
  if (a.image_id != null) { if (typeof a.image_id !== 'string' || !cand.includes(a.image_id)) p.push('image_id must be one of candidate_image_ids'); }
  else if (a.visible === 'yes') p.push('visible = yes needs image_id');
  if (a.bbox != null) {
    const b = a.bbox;
    if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== 'number' || x < 0 || x > 999) || b[0] >= b[2] || b[1] >= b[3]) p.push('bbox must be [x1,y1,x2,y2] within 0..999, x1<x2, y1<y2');
    else if (a.image_id == null) p.push('bbox needs image_id');
  }
  if (a.quote != null && typeof a.quote !== 'string') p.push('quote must be text');
  if (a.installed === 'yes' && a.visible !== 'yes') p.push('installed = yes needs visible = yes');
  return p;
}

async function readOne(db, q, env) {
  const ids = q.params.candidate_image_ids ?? [];
  if (!ids.length) throw new Error('no candidate frames');
  const { fetchImage } = await import('../photo-work-ledger/read-photos.mjs');
  const rows = await db.req(`vehicle_images?select=id,image_url&vehicle_id=eq.${q.vehicle_id}&id=in.(${ids.join(',')})`);
  const urls = new Map(rows.map((r) => [r.id, r.image_url]));
  const dir = mkdtempSync(join(tmpdir(), 'receipt-part-'));
  try {
    const frames = [];
    for (const id of ids) {
      if (!urls.get(id)) continue;
      const file = `frame-${frames.length + 1}.jpg`;
      writeFileSync(join(dir, file), Buffer.from((await fetchImage(urls.get(id), IMAGE_EDGE)).data, 'base64'));
      frames.push({ file, image_id: id });
    }
    if (!frames.length) throw new Error('no candidate frame could be fetched');
    writeFileSync(join(dir, 'task.json'), JSON.stringify(buildTask(q.params, frames), null, 1));
    const r = readCliResult(await runClaudeCli(dir, env));
    if (r.error) throw Object.assign(new Error(r.error), { stop: r.stop });
    return r;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const limit = Number(arg(argv, '--limit', 6)); const reclaim = Number(arg(argv, '--reclaim-minutes', 30));
  if (!(limit >= 1 && limit <= MAX_LIMIT)) throw new Error(`--limit must be 1..${MAX_LIMIT}`);
  const dry = argv.includes('--dry-run'); const out = arg(argv, '--out');
  const db = client(env); const version = producerVersion(SCRIPT); const runId = randomUUID(); const claimedBy = `${AGENT}:${runId}`;
  const s = { cli: 'answer-receipt-parts', claimed: 0, answered: 0, refused: 0, errors: 0, stopped: null, by_outcome: {}, usd_covered: 0, run_id: runId, dry_run: dry };
  if (dry) {
    const pending = await db.req(`evidence_judgment_requests?select=id,priority&department=eq.${DEPARTMENT}&question_kind=eq.${QUESTION}&status=eq.pending&order=priority.desc,created_at&limit=${limit}`);
    return { ...s, would_claim: pending.length, usd_covered: pending.reduce((a, r) => a + (r.priority ?? 0), 0) };
  }
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy, p_stale_minutes: reclaim });
  s.claimed = claimed.length; const detail = [];
  for (const q of claimed) {
    if (s.stopped) break;
    try {
      const r = await readOne(db, q, env);
      const answer = closedAnswer(answerJsonFrom(r.text));
      const problems = answerProblems(q.params, answer);
      if (problems.length) { s.refused++; detail.push({ id: q.id, problems }); continue; }
      await db.rpc('answer_evidence_judgment', { p_id: q.id, p_claimed_by: claimedBy, p_answer: answer, p_answer_agent: AGENT, p_answer_model: r.model ?? 'unknown', p_answer_version: version });
      s.answered++; s.usd_covered += q.priority ?? 0;
      const k = `${answer.visible}/${answer.installed}`; s.by_outcome[k] = (s.by_outcome[k] ?? 0) + 1;
      detail.push({ id: q.id, outcome: k, model: r.model });
    } catch (e) {
      s.errors++; detail.push({ id: q.id, error: String(e.message).slice(0, 200) });
      // a usage limit ends the run; unanswered claims become reclaimable after --reclaim-minutes
      if (e.stop || isUsageLimit(e.message)) s.stopped = String(e.message).slice(0, 120);
    }
  }
  if (out && (s.claimed || s.errors)) writeFileSync(out, JSON.stringify({ ...s, detail }, null, 1));
  return s;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s)); process.exitCode = s.errors && !s.answered ? 1 : 0; })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}

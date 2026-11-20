#!/usr/bin/env node
// Runner for fact_doubt questions: an agent answers a doubt by looking again at the cited evidence, BLIND (it is never shown
// an earlier answer, a stored value, a caption or the asker's words). Claims pending doubts (claim_evidence_judgments),
// builds the blind task from the registry row and the cited frames/lines, asks a Claude vision model for the closed answer,
// validates it locally, and submits through answer_evidence_judgment. It never lands a fact and writes nowhere else.
//   cd ~/nuke && dotenvx run --quiet -- node scripts/doubts/answer-fact-doubts.mjs --vehicle <uuid> [--limit N] [--model id] [--key-env NAME] [--reclaim-minutes N] [--dry-run]
// Claiming is department-wide in the store; the runner refuses to claim while pending doubts of another vehicle exist.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { producerVersion } from '../garage/derivation-evidence.mjs';
import { client, arg } from './db.mjs';
import { DEPARTMENT, QUESTION, ANSWER_SCHEMA, buildBlindTask, buildExportTask, validateAnswer, closedAnswer } from './fact-doubts.mjs';

export const SCRIPT = 'scripts/doubts/answer-fact-doubts.mjs';
export const AGENT = 'fact-doubt-reader';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const IMAGE_EDGE = 1280;
const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
const MAX_IMAGES = 8;

// Messages API request for one blind task. Sonnet 5 cannot disable thinking; between_tools keeps a one-shot read free of it.
export function requestParams(model, task, images) {
  const sonnet = model.startsWith('claude-sonnet-5');
  const content = [];
  for (const e of task.evidence) {
    if (e.kind === 'image') { const im = images.get(e.id); if (im) { content.push({ type: 'text', text: `Image id: ${e.id}` }); content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im } }); } }
    else content.push({ type: 'text', text: `Receipt line id: ${e.id}\n${e.text}` });
  }
  content.push({ type: 'text', text: task.text });
  return {
    model, max_tokens: 1500, system: [{ type: 'text', text: task.system }],
    ...(sonnet ? { thinking: { type: 'between_tools' } } : {}),
    output_config: { ...(sonnet ? { effort: 'medium' } : {}), format: { type: 'json_schema', schema: { ...ANSWER_SCHEMA, additionalProperties: false } } },
    messages: [{ role: 'user', content }],
  };
}

const README = `Fact-doubt tasks for an external reader
=========================================
Each folder <request_id>/ holds task.json (the question, the closed answer format, allowed values, receipt lines)
and frame-1.jpg, frame-2.jpg ... (the cited photographs; task.json maps each file to its image id).

You are a blind reader. Use ONLY the frames and receipt lines in the folder. Do not open any other file, database or
page about this vehicle, and do not look for earlier readings: an answer read from somewhere else is not a second reader.
Read stamps and castings character by character.

For each folder write <request_id>/answer.json:
{ "outcome": "value" | "not_visible" | "cannot_tell",
  "value": "<text as printed; only with outcome value; one of task.allowed when it is listed>",
  "confidence": 0.0-1.0,
  "image_ids": ["<image ids from task.json that show it>"],
  "quote": "what in the evidence shows it" }
A value needs at least one witness in image_ids. If the part is not in the frames answer not_visible; if it is visible
but a character is not legible or the frames disagree answer cannot_tell. Never guess: unknown is an answer.
A folder without answer.json is left unanswered.
`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  const vehicleId = arg(argv, '--vehicle'); const limit = Number(arg(argv, '--limit', 12)); const model = arg(argv, '--model', DEFAULT_MODEL);
  const dry = argv.includes('--dry-run'); const reclaim = Number(arg(argv, '--reclaim-minutes', 30)); // a claim older than this is re-claimable (a run that died)
  if (!vehicleId) throw new Error('--vehicle <uuid> required');
  if (!(limit >= 1 && limit <= 50)) throw new Error('--limit must be 1..50');
  const db = client(env); const version = producerVersion(SCRIPT); const runId = randomUUID(); const claimedBy = `${AGENT}:${runId}`;
  const pending = await db.req(`evidence_judgment_requests?select=id,vehicle_id,params,status&question_kind=eq.${QUESTION}&department=eq.${DEPARTMENT}&status=eq.pending&order=priority.desc,created_at&limit=500`);
  const other = pending.filter((r) => r.vehicle_id !== vehicleId);
  const mine = pending.filter((r) => r.vehicle_id === vehicleId);
  const summary = { run_id: runId, model, answer_version: version, dry_run: dry, pending_for_vehicle: mine.length, answered: [], failed: [], usage: { calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, images: 0, usd: 0 } };
  if (other.length) throw new Error(`${other.length} pending doubt(s) belong to other vehicles; claiming is department-wide, refusing`);
  const reg = new Map((await db.req('observation_properties?select=id,property_key,label,description,unit,data_type&limit=5000')).map((p) => [p.property_key, p]));
  const exportDir = arg(argv, '--export'); const submitDir = arg(argv, '--submit');
  if (submitDir) return submitAnswers({ db, dir: submitDir, agent: arg(argv, '--agent'), model: arg(argv, '--model'), version: arg(argv, '--version'), summary });
  if (exportDir) return exportTasks({ db, dir: exportDir, limit, reclaim, claimedBy, reg, summary, runId });
  if (dry) {
    for (const r of mine.slice(0, limit)) {
      const task = buildBlindTask({ params: r.params, registryRow: reg.get(r.params.property_key) ?? { label: r.params.property_key } });
      summary.answered.push({ id: r.id, key: r.params.property_key, would_ask: true, images: task.evidence.filter((e) => e.kind === 'image').length, lines: task.evidence.filter((e) => e.kind === 'line').length });
    }
    return summary;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { fetchImage } = await import('../photo-work-ledger/read-photos.mjs');
  // Key: --key-env NAME, else the photo-reading key (with its workspace), else ANTHROPIC_API_KEY, else CLAUDE_API_KEY.
  const keyEnv = arg(argv, '--key-env', env.NUKE_PHOTO_ANTHROPIC_API_KEY ? 'NUKE_PHOTO_ANTHROPIC_API_KEY' : env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'CLAUDE_API_KEY');
  const apiKey = env[keyEnv]; const workspace = keyEnv === 'NUKE_PHOTO_ANTHROPIC_API_KEY' ? env.NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID : undefined;
  if (!apiKey) throw new Error(`no Anthropic key in ${keyEnv}`);
  const ai = new Anthropic({ apiKey, maxRetries: 3, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy, p_stale_minutes: reclaim });
  for (const q of claimed) {
    const key = q.params.property_key;
    try {
      const params = q.params;
      if ((params.cited_image_ids ?? []).length > MAX_IMAGES) throw new Error(`more than ${MAX_IMAGES} cited images`);
      const lineIds = params.cited_receipt_item_ids ?? [];
      const lines = lineIds.length ? await db.req(`receipt_items?select=id,description,part_number,line_date&id=in.(${lineIds.join(',')})`) : [];
      const task = buildBlindTask({ params, registryRow: reg.get(key) ?? { label: key }, lines });
      const images = new Map();
      if (params.cited_image_ids.length) {
        const rows = await db.req(`vehicle_images?select=id,image_url&id=in.(${params.cited_image_ids.join(',')})`);
        for (const r of rows) images.set(r.id, (await fetchImage(r.image_url, IMAGE_EDGE)).data);
      }
      const msg = await ai.messages.create(requestParams(model, task, images));
      const u = msg.usage; const [pi, po] = PRICES[model] ?? [NaN, NaN];
      const usd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * pi + u.output_tokens * po) / 1e6;
      Object.assign(summary.usage, { calls: summary.usage.calls + 1, input_tokens: summary.usage.input_tokens + u.input_tokens, output_tokens: summary.usage.output_tokens + u.output_tokens,
        cache_read: summary.usage.cache_read + (u.cache_read_input_tokens ?? 0), cache_write: summary.usage.cache_write + (u.cache_creation_input_tokens ?? 0),
        images: summary.usage.images + images.size, usd: summary.usage.usd + usd });
      const answer = closedAnswer(JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')));
      const problems = validateAnswer(params, answer);
      if (problems.length) { summary.failed.push({ id: q.id, key, problems }); continue; }
      await db.rpc('answer_evidence_judgment', { p_id: q.id, p_claimed_by: claimedBy, p_answer: answer, p_answer_agent: AGENT, p_answer_model: msg.model ?? model, p_answer_version: version });
      const line = { id: q.id, key, outcome: answer.outcome, value: answer.value ?? null, confidence: answer.confidence, witnesses: { images: answer.image_ids ?? [], receipt_items: answer.receipt_item_ids ?? [] } };
      summary.answered.push(line);
      console.error(`${key}\t${line.outcome}\t${line.value}\t${line.confidence}\t${line.witnesses.images.length} img ${line.witnesses.receipt_items.length} line`);
    } catch (e) { summary.failed.push({ id: q.id, key, error: e.message.slice(0, 300) }); }
  }
  summary.usage.usd = Number(summary.usage.usd.toFixed(4));
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s, null, 1)); process.exitCode = s.failed.length ? 1 : 0; }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

// External reader, step 1: claim as usual and write each blind task with its frames. The claim holder is kept in .manifest.json
// (ids and the claim only, no value of any kind) so --submit can answer as the holder.
export async function exportTasks({ db, dir, limit, reclaim, claimedBy, reg, summary, runId }) {
  const { fetchImage } = await import('../photo-work-ledger/read-photos.mjs');
  mkdirSync(dir, { recursive: true });
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy, p_stale_minutes: reclaim });
  const manifest = {}; summary.exported = []; summary.failed = [];
  for (const q of claimed) {
    try {
      const params = q.params; const key = params.property_key;
      if ((params.cited_image_ids ?? []).length > MAX_IMAGES) throw new Error(`more than ${MAX_IMAGES} cited images`);
      const lineIds = params.cited_receipt_item_ids ?? [];
      const lines = lineIds.length ? await db.req(`receipt_items?select=id,description,part_number,line_date&id=in.(${lineIds.join(',')})`) : [];
      const task = buildBlindTask({ params, registryRow: reg.get(key) ?? { label: key }, lines });
      const rows = params.cited_image_ids.length ? await db.req(`vehicle_images?select=id,image_url&id=in.(${params.cited_image_ids.join(',')})`) : [];
      const url = new Map(rows.map((r) => [r.id, r.image_url]));
      const d = join(dir, q.id); mkdirSync(d, { recursive: true });
      const frames = [];
      for (const id of params.cited_image_ids) {
        const file = `frame-${frames.length + 1}.jpg`;
        writeFileSync(join(d, file), Buffer.from((await fetchImage(url.get(id), 1600)).data, 'base64'));
        frames.push({ file, image_id: id });
      }
      writeFileSync(join(d, 'task.json'), JSON.stringify(buildExportTask({ task, params, frames }), null, 1));
      manifest[q.id] = { claimed_by: claimedBy, doubt_form: params.doubt_form, allowed: params.allowed ?? null, cited_image_ids: params.cited_image_ids, cited_receipt_item_ids: params.cited_receipt_item_ids };
      summary.exported.push({ id: q.id, key, frames: frames.length, lines: lines.length });
    } catch (e) { summary.failed.push({ id: q.id, error: e.message.slice(0, 300) }); }
  }
  writeFileSync(join(dir, '.manifest.json'), JSON.stringify({ run_id: runId, requests: manifest }, null, 1));
  writeFileSync(join(dir, 'README.txt'), README);
  return summary;
}

// External reader, step 2: validate each answer.json locally and submit it as the named reader. A task without an answer stays
// claimed and is reclaimable.
export async function submitAnswers({ db, dir, agent, model, version, summary }) {
  if (!agent || !model || !version) throw new Error("--agent, --model and --version required (the reader's own identity)");
  const { requests } = JSON.parse(readFileSync(join(dir, '.manifest.json'), 'utf8'));
  summary.answered = []; summary.failed = []; summary.unanswered = [];
  for (const [id, m] of Object.entries(requests)) {
    const f = join(dir, id, 'answer.json');
    if (!existsSync(f)) { summary.unanswered.push(id); continue; }
    try {
      const answer = closedAnswer(JSON.parse(readFileSync(f, 'utf8')));
      const problems = validateAnswer(m, answer);
      if (problems.length) { summary.failed.push({ id, problems }); console.error(`${id}\trefused locally\t${problems.join('; ')}`); continue; }
      await db.rpc('answer_evidence_judgment', { p_id: id, p_claimed_by: m.claimed_by, p_answer: answer, p_answer_agent: agent, p_answer_model: model, p_answer_version: version });
      summary.answered.push({ id, outcome: answer.outcome, value: answer.value ?? null, confidence: answer.confidence });
      console.error(`${id}\t${answer.outcome}\t${answer.value ?? ''}\t${answer.confidence}`);
    } catch (e) { summary.failed.push({ id, error: e.message.slice(0, 300) }); }
  }
  return summary;
}

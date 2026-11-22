#!/usr/bin/env node
// Runner for fact_doubt questions: an agent answers a doubt by looking again at the cited evidence, BLIND (it is never shown
// an earlier answer, a stored value, a caption or the asker's words). Claims pending doubts (claim_evidence_judgments),
// builds the blind task from the registry row and the cited frames/lines, asks a reader for the closed answer, validates it
// locally, and submits through answer_evidence_judgment. It never lands a fact and writes nowhere else.
//   cd ~/nuke && dotenvx run --quiet -- node scripts/doubts/answer-fact-doubts.mjs --vehicle <uuid> [--limit N]
//        [--provider api|subscription|gemini] [--model id] [--key-env NAME] [--reclaim-minutes N] [--second-reader] [--dry-run]
//        [--closeups]  subscription reader only: also give full-resolution enlargements of where text sits in each cited frame
// Providers: api (Anthropic key; default when a key env is set), subscription (`claude -p` under the owner's login, no key,
// cost 0), gemini (REST, key in the x-goog-api-key header). --second-reader reopens the vehicle's singly-read doubts through
// reopen_evidence_judgment_answers so the chosen provider answers them blind (the first answer moves to answer_history and is
// never part of a task).
// External reader (no model call here): --export <dir> writes blind tasks and frames; --submit <dir> --agent <name> --model <id>
// --version <text> validates and submits the answer files.
// Claiming is department-wide in the store; the runner refuses to claim while pending doubts of another vehicle exist.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { producerVersion } from '../garage/derivation-evidence.mjs';
import { client, arg } from './db.mjs';
import { DEPARTMENT, QUESTION, ANSWER_SCHEMA, buildBlindTask, buildExportTask, validateAnswer, closedAnswer, closeupBoxes } from './fact-doubts.mjs';
import { AGENTS, GEMINI_KEY_ENVS, selectProvider, runClaudeCli, readCliResult, answerJsonFrom, pickGeminiModel, geminiRequest, readGeminiResponse, isUsageLimit, GEMINI_HOST } from './readers.mjs';

export const SCRIPT = 'scripts/doubts/answer-fact-doubts.mjs';
export const AGENT = 'fact-doubt-reader';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const IMAGE_EDGE = 1280;
const PRICES = { 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-fable-5-2': [8, 40] }; // USD per MTok, claude-api model table 2026-11-03
const MAX_IMAGES = 8;
const CONCURRENCY = 2;

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

const addUsage = (u, add) => { for (const k of ['input_tokens', 'output_tokens', 'cache_read', 'cache_write']) u[k] += add?.[k] ?? 0; u.calls++; };

// The blind task for one claimed request: registry label/definition, allowed values, receipt lines (no prices). Only whitelisted
// fields of the request are read (see buildBlindTask); answer, answer_history and the asker's words never reach it.
async function blindTaskFor(db, reg, q) {
  const params = q.params; const key = params.property_key;
  if ((params.cited_image_ids ?? []).length > MAX_IMAGES) throw new Error(`more than ${MAX_IMAGES} cited images`);
  const lineIds = params.cited_receipt_item_ids ?? [];
  const lines = lineIds.length ? await db.req(`receipt_items?select=id,description,part_number,line_date&id=in.(${lineIds.join(',')})`) : [];
  return buildBlindTask({ params, registryRow: reg.get(key) ?? { label: key }, lines });
}

// Frames as base64 jpegs keyed by image id, at the given long edge.
export async function fetchFrames(db, params, edge) {
  const { fetchImage } = await import('../photo-work-ledger/read-photos.mjs');
  const images = new Map();
  if (params.cited_image_ids.length) {
    const rows = await db.req(`vehicle_images?select=id,image_url&id=in.(${params.cited_image_ids.join(',')})`);
    for (const r of rows) images.set(r.id, (await fetchImage(r.image_url, edge)).data);
  }
  return images;
}

// Full-resolution enlargements of where an existing reading located text in the cited frames: { image_id: [base64 jpeg] }.
// A marking a few dozen pixels tall in a whole frame is unreadable once the frame is shrunk for a reader; the enlargement is
// cut from the original bytes. Positions only are read from the earlier reading (closeupBoxes), never its text.
export const CLOSEUP_EDGE = 1568;
export async function fetchCloseups(db, vehicleId, params, total = 8) {
  const ids = params.cited_image_ids ?? []; const out = new Map();
  if (!ids.length) return out;
  const { default: sharp } = await import('sharp');
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util'); const run = promisify(execFile);
  const rows = await db.req(`vehicle_observations?select=image_id:structured_data->>image_id,regions:structured_data->text_regions&vehicle_id=eq.${vehicleId}&is_superseded=not.is.true&kind=eq.condition&structured_data->>image_id=in.(${ids.join(',')})&limit=200`);
  const regions = new Map();
  for (const r of rows) if (Array.isArray(r.regions)) regions.set(r.image_id, [...(regions.get(r.image_id) ?? []), ...r.regions]);
  const urls = new Map((await db.req(`vehicle_images?select=id,image_url&id=in.(${ids.join(',')})`)).map((r) => [r.id, r.image_url]));
  let n = 0;
  for (const id of ids) {
    const boxes = closeupBoxes(regions.get(id)); if (!boxes.length || !urls.get(id) || n >= total) continue;
    const res = await fetch(urls.get(id), { signal: AbortSignal.timeout(60000) }); if (!res.ok) continue;
    let buf = Buffer.from(await res.arrayBuffer());
    try { buf = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer(); }
    catch (e) {
      if (process.platform !== 'darwin') continue; // this sharp build cannot decode HEIC; sips can
      const dir = mkdtempSync(join(tmpdir(), 'fact-doubt-full-'));
      try { writeFileSync(join(dir, 'in'), buf); await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', join(dir, 'in'), '--out', join(dir, 'out.jpg')], { timeout: 60000 }); buf = await sharp(readFileSync(join(dir, 'out.jpg'))).rotate().toBuffer(); }
      finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const { width, height } = await sharp(buf).metadata(); const crops = [];
    for (const [x0, y0, x1, y1] of boxes) {
      if (n >= total) break;
      const left = Math.round(x0 / 1000 * width); const top = Math.round(y0 / 1000 * height);
      const w = Math.max(1, Math.min(width - left, Math.round((x1 - x0) / 1000 * width))); const h = Math.max(1, Math.min(height - top, Math.round((y1 - y0) / 1000 * height)));
      crops.push((await sharp(buf).extract({ left, top, width: w, height: h }).resize({ width: CLOSEUP_EDGE, height: CLOSEUP_EDGE, fit: 'inside' }).normalise().sharpen().jpeg({ quality: 90 }).toBuffer()).toString('base64')); n++;
    }
    if (crops.length) out.set(id, crops);
  }
  return out;
}

// Write task.json and frame-N.jpg into dir (the blind task as files); returns the frame list.
export function writeTaskDir(dir, task, params, images, closeups = new Map()) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  for (const id of params.cited_image_ids) {
    const base = frames.filter((f) => !f.enlargement_of).length + 1;
    const file = `frame-${base}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(images.get(id), 'base64'));
    frames.push({ file, image_id: id });
    for (const [k, b64] of (closeups.get(id) ?? []).entries()) {
      const cf = `frame-${base}-closeup-${k + 1}.jpg`;
      writeFileSync(join(dir, cf), Buffer.from(b64, 'base64'));
      frames.push({ file: cf, image_id: id, enlargement_of: file, note: 'enlarged, contrast-stretched region of the same photograph; cite its image_id' });
    }
  }
  writeFileSync(join(dir, 'task.json'), JSON.stringify(buildExportTask({ task, params, frames }), null, 1));
  return frames;
}

// One reader per provider: (task, q) -> { text, model, usage } or throws; err.stop ends the whole run (usage limit, refused key).
async function makeReader({ provider, argv, env, db, version, usage }) {
  if (provider === 'api') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const keyEnv = arg(argv, '--key-env', env.NUKE_PHOTO_ANTHROPIC_API_KEY ? 'NUKE_PHOTO_ANTHROPIC_API_KEY' : env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'CLAUDE_API_KEY');
    const apiKey = env[keyEnv]; const workspace = keyEnv === 'NUKE_PHOTO_ANTHROPIC_API_KEY' ? env.NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID : undefined;
    if (!apiKey) throw new Error(`no Anthropic key in ${keyEnv}`);
    const ai = new Anthropic({ apiKey, maxRetries: 3, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
    const model = arg(argv, '--model', DEFAULT_MODEL); const [pi, po] = PRICES[model] ?? [NaN, NaN];
    return { agent: AGENTS.api, async read(task, q) {
      const images = await fetchFrames(db, q.params, IMAGE_EDGE);
      let msg;
      try { msg = await ai.messages.create(requestParams(model, task, images)); }
      catch (e) { throw Object.assign(e, { stop: e.status === 401 || e.status === 429 || e.status === 529 }); }
      const u = msg.usage; usage.images += images.size;
      usage.usd += ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * pi + u.output_tokens * po) / 1e6;
      return { text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), model: msg.model ?? model,
        usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 } };
    } };
  }
  if (provider === 'gemini') {
    const keyEnv = GEMINI_KEY_ENVS.find((k) => env[k]); if (!keyEnv) throw new Error(`no Gemini key (${GEMINI_KEY_ENVS.join(' or ')})`);
    const key = env[keyEnv];
    let model = arg(argv, '--model');
    if (!model) {
      const res = await fetch(`${GEMINI_HOST}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`gemini models list ${res.status}`);
      model = pickGeminiModel((await res.json()).models);
    }
    return { agent: AGENTS.gemini, model, async read(task, q) {
      const images = await fetchFrames(db, q.params, 1600); usage.images += images.size;
      const r = geminiRequest({ model, task, images, key });
      const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(240000) });
      if (!res.ok) throw Object.assign(new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160).replace(key, '[key]')}`), { stop: [401, 403, 429].includes(res.status) });
      const out = readGeminiResponse(await res.json());
      return { ...out, model: model };
    } };
  }
  // subscription: the CLI reads the task and frames from a fresh temp dir with the Read tool only
  return { agent: AGENTS.subscription, async read(task, q) {
    const dir = mkdtempSync(join(tmpdir(), 'fact-doubt-'));
    try {
      writeTaskDir(dir, task, q.params, await fetchFrames(db, q.params, 1600), argv.includes('--closeups') ? await fetchCloseups(db, q.vehicle_id, q.params) : new Map());
      const r = readCliResult(await runClaudeCli(dir, env));
      if (r.error) throw Object.assign(new Error(r.error), { stop: r.stop });
      return r;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } };
}

// Reopen the vehicle's singly-read doubts so another reader answers them blind. reopen_evidence_judgment_answers works per
// answer_version across the whole store, so each version is first listed (dry run); a version that would reopen anything outside
// this vehicle's singly-read fact doubts is refused. Doubts already answered by the same agent+model are left alone.
export async function reopenForSecondReader({ db, vehicleId, agent, model, runId }) {
  const rows = await db.req(`evidence_judgment_requests?select=id,answer_agent,answer_model,answer_version,answer_history&vehicle_id=eq.${vehicleId}&question_kind=eq.${QUESTION}&status=eq.answered`);
  const single = rows.filter((r) => (r.answer_history ?? []).length === 0 && !(r.answer_agent === agent && r.answer_model === model));
  const ids = new Set(single.map((r) => r.id)); const report = { reopened: 0, skipped: rows.length - single.length, refused: [] };
  for (const v of [...new Set(single.map((r) => r.answer_version))]) {
    const would = await db.rpc('reopen_evidence_judgment_answers', { p_answer_version: v, p_reason: `second reader ${agent} (run ${runId})`, p_dry_run: true });
    const outside = would.filter((w) => !ids.has(w.id));
    if (outside.length) { report.refused.push({ answer_version: v, rule: `reopen is per answer_version across the store: ${outside.length} other answer(s) share it`, would_reopen: would.length }); continue; }
    const done = await db.rpc('reopen_evidence_judgment_answers', { p_answer_version: v, p_reason: `second reader ${agent} (run ${runId})`, p_dry_run: false });
    report.reopened += done.length;
  }
  return report;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const vehicleId = arg(argv, '--vehicle'); const limit = Number(arg(argv, '--limit', 12));
  const dry = argv.includes('--dry-run'); const reclaim = Number(arg(argv, '--reclaim-minutes', 30)); // a claim older than this is re-claimable (a run that died)
  // --all-vehicles (the scheduled cycle, fact-doubt-cycle.mjs): claim department-wide. Each blind task is built from its own
  // question row, so nothing of one vehicle reaches another's task.
  const allVehicles = argv.includes('--all-vehicles');
  if (!vehicleId && !allVehicles) throw new Error('--vehicle <uuid> or --all-vehicles required');
  if (!(limit >= 1 && limit <= 50)) throw new Error('--limit must be 1..50');
  const db = client(env); const version = producerVersion(SCRIPT); const runId = randomUUID(); const claimedBy = `${AGENT}:${runId}`;
  const exportDir = arg(argv, '--export'); const submitDir = arg(argv, '--submit');
  const provider = selectProvider(arg(argv, '--provider'), env);
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, images: 0, usd: 0 };
  const summary = { run_id: runId, provider, answer_version: version, dry_run: dry, answered: [], failed: [], usage };
  const reg = new Map((await db.req('observation_properties?select=id,property_key,label,description,unit,data_type&limit=5000')).map((p) => [p.property_key, p]));
  if (submitDir) return submitAnswers({ db, dir: submitDir, agent: arg(argv, '--agent'), model: arg(argv, '--model'), version: arg(argv, '--version'), summary });
  const pending = await db.req(`evidence_judgment_requests?select=id,vehicle_id,params,status&question_kind=eq.${QUESTION}&department=eq.${DEPARTMENT}&status=eq.pending&order=priority.desc,created_at&limit=500`);
  const other = allVehicles ? [] : pending.filter((r) => r.vehicle_id !== vehicleId);
  summary.pending_for_vehicle = pending.length - other.length;
  if (allVehicles && submitDir == null && (exportDir || argv.includes('--second-reader'))) throw new Error('--all-vehicles answers only; no --export or --second-reader');
  if (other.length) throw new Error(`${other.length} pending doubt(s) belong to other vehicles; claiming is department-wide, refusing`);
  if (exportDir) return exportTasks({ db, dir: exportDir, limit, reclaim, claimedBy, reg, summary, runId });
  if (dry) {
    for (const r of pending.slice(0, limit)) {
      const task = buildBlindTask({ params: r.params, registryRow: reg.get(r.params.property_key) ?? { label: r.params.property_key } });
      summary.answered.push({ id: r.id, key: r.params.property_key, would_ask: true, images: task.evidence.filter((e) => e.kind === 'image').length, lines: task.evidence.filter((e) => e.kind === 'line').length });
    }
    return summary;
  }
  const reader = await makeReader({ provider, argv, env, db, version, usage });
  summary.reader = { agent: reader.agent, model: reader.model ?? arg(argv, '--model', provider === 'api' ? DEFAULT_MODEL : null) };
  if (argv.includes('--second-reader')) {
    // the resolved model of a subscription reader is only known after its first answer: same-pair skipping uses the agent name there
    summary.second_reader = await reopenForSecondReader({ db, vehicleId, agent: reader.agent, model: reader.model ?? summary.reader.model, runId });
  }
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy, p_stale_minutes: reclaim });
  let i = 0; let stopped = null;
  const worker = async () => {
    while (i < claimed.length && !stopped) {
      const q = claimed[i++]; const key = q.params.property_key;
      try {
        const task = await blindTaskFor(db, reg, q);
        const out = await reader.read(task, q); addUsage(usage, out.usage);
        const answer = closedAnswer(answerJsonFrom(out.text));
        const problems = validateAnswer(q.params, answer);
        if (problems.length) { summary.failed.push({ id: q.id, key, problems }); console.error(`${key}\trefused locally\t${problems.join('; ')}`); continue; }
        const model = out.model ?? reader.model ?? 'unknown';
        await db.rpc('answer_evidence_judgment', { p_id: q.id, p_claimed_by: claimedBy, p_answer: answer, p_answer_agent: reader.agent, p_answer_model: model, p_answer_version: version });
        const line = { id: q.id, key, outcome: answer.outcome, value: answer.value ?? null, confidence: answer.confidence, model, witnesses: { images: answer.image_ids ?? [], receipt_items: answer.receipt_item_ids ?? [] } };
        summary.answered.push(line);
        console.error(`${key}\t${line.outcome}\t${line.value}\t${line.confidence}\t${line.witnesses.images.length} img ${line.witnesses.receipt_items.length} line`);
      } catch (e) {
        summary.failed.push({ id: q.id, key, error: String(e.message).slice(0, 300) });
        // a usage limit or a refused key ends the run cleanly; unanswered claims stay reclaimable
        if (e.stop || isUsageLimit(e.message)) { stopped = String(e.message).slice(0, 200); }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (stopped) summary.stopped = stopped;
  summary.unanswered_claims = claimed.length - summary.answered.length - summary.failed.filter((f) => f.problems).length;
  usage.usd = Number(usage.usd.toFixed(4));
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s, null, 1)); process.exitCode = s.failed.length ? 1 : 0; }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

// External reader, step 1: claim as usual and write each blind task with its frames. The claim holder is kept in .manifest.json
// (ids and the claim only, no value of any kind) so --submit can answer as the holder.
export async function exportTasks({ db, dir, limit, reclaim, claimedBy, reg, summary, runId }) {
  mkdirSync(dir, { recursive: true });
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy, p_stale_minutes: reclaim });
  const manifest = {}; summary.exported = []; summary.failed = [];
  for (const q of claimed) {
    try {
      const params = q.params;
      const task = await blindTaskFor(db, reg, q);
      const frames = writeTaskDir(join(dir, q.id), task, params, await fetchFrames(db, params, 1600));
      manifest[q.id] = { claimed_by: claimedBy, doubt_form: params.doubt_form, allowed: params.allowed ?? null, cited_image_ids: params.cited_image_ids, cited_receipt_item_ids: params.cited_receipt_item_ids };
      summary.exported.push({ id: q.id, key: params.property_key, frames: frames.length, lines: task.evidence.filter((e) => e.kind === 'line').length });
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

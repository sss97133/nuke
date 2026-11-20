#!/usr/bin/env node
// Runner for fact_doubt questions: an agent answers a doubt by looking again at the cited evidence, BLIND (it is never shown
// an earlier answer, a stored value, a caption or the asker's words). Claims pending doubts (claim_evidence_judgments),
// builds the blind task from the registry row and the cited frames/lines, asks a Claude vision model for the closed answer,
// validates it locally, and submits through answer_evidence_judgment. It never lands a fact and writes nowhere else.
//   cd ~/nuke && dotenvx run --quiet -- node scripts/doubts/answer-fact-doubts.mjs --vehicle <uuid> [--limit N] [--model id] [--dry-run]
// Claiming is department-wide in the store; the runner refuses to claim while pending doubts of another vehicle exist.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { producerVersion } from '../garage/derivation-evidence.mjs';
import { client, arg } from './db.mjs';
import { DEPARTMENT, QUESTION, ANSWER_SCHEMA, buildBlindTask, validateAnswer, closedAnswer } from './fact-doubts.mjs';

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

export async function main(argv = process.argv.slice(2), env = process.env) {
  const vehicleId = arg(argv, '--vehicle'); const limit = Number(arg(argv, '--limit', 12)); const model = arg(argv, '--model', DEFAULT_MODEL);
  const dry = argv.includes('--dry-run');
  if (!vehicleId) throw new Error('--vehicle <uuid> required');
  if (!(limit >= 1 && limit <= 50)) throw new Error('--limit must be 1..50');
  const db = client(env); const version = producerVersion(SCRIPT); const runId = randomUUID(); const claimedBy = `${AGENT}:${runId}`;
  const pending = await db.req(`evidence_judgment_requests?select=id,vehicle_id,params,status&question_kind=eq.${QUESTION}&department=eq.${DEPARTMENT}&status=eq.pending&order=priority.desc,created_at&limit=500`);
  const other = pending.filter((r) => r.vehicle_id !== vehicleId);
  const mine = pending.filter((r) => r.vehicle_id === vehicleId);
  const summary = { run_id: runId, model, answer_version: version, dry_run: dry, pending_for_vehicle: mine.length, answered: [], failed: [], usage: { calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, images: 0, usd: 0 } };
  if (other.length) throw new Error(`${other.length} pending doubt(s) belong to other vehicles; claiming is department-wide, refusing`);
  const reg = new Map((await db.req('observation_properties?select=id,property_key,label,description,unit,data_type&limit=5000')).map((p) => [p.property_key, p]));
  if (dry) {
    for (const r of mine.slice(0, limit)) {
      const task = buildBlindTask({ params: r.params, registryRow: reg.get(r.params.property_key) ?? { label: r.params.property_key } });
      summary.answered.push({ id: r.id, key: r.params.property_key, would_ask: true, images: task.evidence.filter((e) => e.kind === 'image').length, lines: task.evidence.filter((e) => e.kind === 'line').length });
    }
    return summary;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { fetchImage } = await import('../photo-work-ledger/read-photos.mjs');
  const photoKey = env.NUKE_PHOTO_ANTHROPIC_API_KEY; const workspace = photoKey ? env.NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID : undefined;
  const apiKey = photoKey || env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('no Anthropic key in the environment (NUKE_PHOTO_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)');
  const ai = new Anthropic({ apiKey, maxRetries: 3, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
  const claimed = await db.rpc('claim_evidence_judgments', { p_department: DEPARTMENT, p_question_kind: QUESTION, p_limit: limit, p_claimed_by: claimedBy });
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

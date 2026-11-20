#!/usr/bin/env node
// The owner's subscription classifies the photos the pipeline could not (no platform vision key answers).
//
// The orchestrator hands out its own checklist (action classifier_prompt: the v98 prompt from the live manifest); this
// script runs it on the owner's Mac as `claude -p` under his Claude Code login (OAuth; ANTHROPIC_API_KEY refused), and
// posts the JSON back to the orchestrator as classification_raw. The orchestrator validates it exactly like a provider
// answer and runs the rest of its pipeline unchanged (routing, filing through attribute_testimony, the observation).
//
// Worklist (--source auto, the default): when the stage ledger is switched on (platform_config
// image_stage_reconciler.enabled), the photos come from claim_image_stage_work('classifier') for this owner and each
// one gets a typed receipt through record_image_stage_receipt (stage-queue.mjs); otherwise the worklist is the owner's
// rows by ai_processing_status, as before, and nothing here writes to the database.
//
// After the first reads, one process works two more stages of the same ledger, in this order (deep-stage.mjs):
//   deep_reading   (--deep-limit, default 20)   two independent lean reads of the photo, agreed values only, posted through the
//                                               orchestrator's record_reviewed_analysis; skipped in a fire whose first reads
//                                               ended on a batch-level fault (usage limit, login refused, API down, missing tool)
//   keyed_values   (--keyed-limit, default 60)  the sanctioned projection of that photo's current reading; no model call
// A stage the database does not hold yet claims nothing: a quiet no-op. Every model call starts lean (leanClaudeArgs).
//
//   dotenvx run -q -f ~/nuke/.env -- node scripts/photo-pipeline/subscription-frame-classifier.mjs --owner <uuid> [--limit N] [--concurrency 2] [--model claude-sonnet-5-5] [--status failed,pending] [--source auto|stage-queue|status] [--deep-limit 20] [--keyed-limit 60] [--dry-run] [--out receipt.json]
//   ... --stage-dry-run --image-ids <uuid,uuid> [--stages deep_reading,keyed_values]   reads those photos twice and prints, per photo, validity, seconds, tokens, the agreement
//                                                 and the exact envelope it would post, plus the keyed projection as a dry run; claims and writes nothing
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEEP_STAGE, KEYED_STAGE, claimStageWork, claimStageWorkUpTo, inputFingerprint, receiptForResult, recordStageReceipt, stageQueueEnabled } from './stage-queue.mjs';
import { DEEP_BUDGET_MS, DEEP_READ_TIMEOUT_MS, DEFAULT_MODEL, REFUSAL_STREAK_STOP, admitsFrom, claimAndWork, claudePrint, cliSupportsLean, countReceipt, deepChildEnv, deepReadFrame, keyedValuesForFrame, leanClaudeArgs, legacyClaudeArgs, newRunId, newStageSummary, pool, subscriptionEnv, refusalStreak } from './deep-stage.mjs';
const run = promisify(execFile);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under dotenvx)'); process.exit(2); }
if (!args.owner || args.owner === true) { console.error('--owner <uuid> is required'); process.exit(2); }
if (process.env.ANTHROPIC_API_KEY) { console.error('refusing: ANTHROPIC_API_KEY is set; this reader runs on the subscription login only'); process.exit(2); }
const OWNER = args.owner;
const limit = args.limit && args.limit !== true ? Number(args.limit) : 200;
const conc = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : 2;
const model = args.model && args.model !== true ? String(args.model) : DEFAULT_MODEL;
const count = (name, fallback) => (args[name] && args[name] !== true && Number.isFinite(Number(args[name])) ? Math.max(0, Math.trunc(Number(args[name]))) : fallback);
const deepLimit = count('deep-limit', 20), keyedLimit = count('keyed-limit', 60);
const here = dirname(fileURLToPath(import.meta.url));
const statuses = (args.status && args.status !== true ? String(args.status) : 'failed,pending').split(',').map((s) => s.trim()).filter(Boolean);
const dry = args['dry-run'] === true;
const source = args.source && args.source !== true ? String(args.source) : 'auto';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const READER = `claude-cli ${model} subscription`;

async function rest(q) {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.slice(0, 60)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function rpc(name, body) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function orchestrator(body, timeoutMs = 0) {
  const r = await fetch(`${URL_}/functions/v1/photo-pipeline-orchestrator`, { method: 'POST', headers: H, body: JSON.stringify(body), ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
  return { http: r.status, ...j };
}

async function supabaseClient() {
  // The reader runs from a checkout of origin/main that has no node_modules; the project's own checkout does (the
  // wrapper starts this script with it as the working directory), so the client is resolved from there.
  let mod;
  try { mod = createRequire(join(process.cwd(), 'noop.js'))('@supabase/supabase-js'); } catch { mod = await import('@supabase/supabase-js'); }
  return mod.createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
const deepDeps = (dir) => ({
  rest,
  fetchBytes: async (url) => { const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => ({ ok: false, status: 0 })); return res.ok ? { ok: true, status: res.status, bytes: Buffer.from(await res.arrayBuffer()) } : { ok: false, status: res.status }; },
  convert: async (raw) => { const out = raw.replace(/\.[^.]+$/, '') + '.jpg'; await run('sips', ['-s', 'format', 'jpeg', '-Z', '1600', raw, '--out', out]); return out; },
  ask: (argv, text, cwd, signal) => claudePrint(argv, text, { env: deepChildEnv(), cwd, signal, timeoutMs: DEEP_READ_TIMEOUT_MS }),
  orchestrator: (body) => orchestrator(body, 120_000),
});
const contractText = () => readFileSync(join(here, '..', 'daily-receipt', 'byok-vision-prompt.md'), 'utf8');
// Which closed values the database admits from this reader (platform_config image_reading_tiers; contract-tiers Rule 1).
// The row is the rule: no row, or a row that admits no scene, means nothing may be posted, so nothing is read.
async function readAdmits() {
  const rows = await rest('platform_config?select=config_value&config_key=eq.image_reading_tiers');
  return admitsFrom(Array.isArray(rows) ? rows[0]?.config_value : null);
}

// Dry run of the new stages on named photos: reads and prints, claims nothing, writes nothing.
if (args['stage-dry-run'] === true) {
  const ids = String(args['image-ids'] === true ? '' : args['image-ids'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) { console.error('--stage-dry-run needs --image-ids <uuid,uuid>'); process.exit(2); }
  if (!(await cliSupportsLean())) { console.error('the claude CLI on this PATH does not know --safe-mode / --json-schema (upgrade it, or put ~/.local/bin first)'); process.exit(2); }
  const rows = await rest(`vehicle_images?select=id,vehicle_id&user_id=eq.${OWNER}&id=in.(${ids.join(',')})`);
  const dir = mkdtempSync(join(tmpdir(), 'nuke-deep-dry-'));
  const runId = newRunId();
  // a dry run may name the admitted set in a file (for measuring before the database row exists); a real fire never can
  const admits = args['admits-file'] && args['admits-file'] !== true
    ? admitsFrom({ automatic: { admits: JSON.parse(readFileSync(args['admits-file'], 'utf8')).admits } })
    : await readAdmits();
  console.error(`admitted values: ${JSON.stringify(admits)}`);
  let sb = null;
  const which = String(args.stages === true || !args.stages ? 'deep_reading,keyed_values' : args.stages).split(',');
  for (const f of rows) {
    if (which.includes(DEEP_STAGE)) {
    const res = await deepReadFrame({ id: f.id, vehicle_id: f.vehicle_id }, deepDeps(dir), { dir, contract: contractText(), model, runId, post: false, reader: READER, admits });
    console.log(JSON.stringify({ stage: DEEP_STAGE, image_id: f.id, valid: res.valid, seconds: res.seconds,
      tokens: (res.reads ?? []).map((r) => ({ input: r.stats.input_tokens, output: r.stats.output_tokens, seconds: r.stats.seconds, attempts: r.stats.attempts, notional_usd: r.stats.notional_cost_usd })),
      agreement: res.agreement ? { agreed: res.agreement.agreed, disagreements: res.agreement.disagreements, values: res.agreement.values, posted: res.agreement.posted, held: res.agreement.held } : null,
      // what each pass said in its own words (kept in the stage receipt on a real fire, never posted)
      raw_reads: (res.reads ?? []).map((r) => ({ scene_type: r.verdict.scene_type, state: r.verdict.state_observations, narrative: r.verdict.narrative_one_line, confidence: r.verdict.confidence, components: (r.verdict.components_seen ?? []).length })),
      would_post: res.envelope ?? null, receipt_if_not_two_valid_reads: res.envelope ? null : res.receipt }));
    }
    if (!which.includes(KEYED_STAGE)) continue;
    sb ??= await supabaseClient();
    const k0 = Date.now();
    const keyed = await keyedValuesForFrame({ id: f.id, vehicle_id: f.vehicle_id }, { sb, apply: false, reader: READER });
    console.log(JSON.stringify({ stage: KEYED_STAGE, image_id: f.id, dry_run: true, ms: Date.now() - k0, would_write_values: keyed.projection?.eligible_claims ?? null, projection: keyed.projection, error: keyed.receipt.outcome === 'unavailable' ? keyed.receipt.detail?.error ?? keyed.receipt.error_class : null }));
  }
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

const checklist = await orchestrator({ action: 'classifier_prompt' });
if (checklist.http !== 200 || typeof checklist.prompt !== 'string') { console.error(`could not get the checklist: ${checklist.http} ${checklist.error ?? ''}`); process.exit(1); }
// Every call starts lean (leanClaudeArgs) when this machine's `claude` can; an older CLI keeps the previous first-read call and
// the deep readings wait for a CLI that can hold them to the grammar.
const lean = dry || await cliSupportsLean();
const fromQueue = source === 'stage-queue' || (source === 'auto' && await stageQueueEnabled(rest, OWNER));
let frames;
if (fromQueue) {
  // The ledger hands out the work: eligibility (privacy holds, duplicates, superseded rows) was judged by the reconciler.
  // The lease covers the whole batch: every photo is claimed up front, and one read can take up to 240 s plus the
  // download and the orchestrator. A lease shorter than the batch hands this fire's unread photos back to the queue
  // while it is still working through them.
  const leaseSeconds = Math.max(900, Math.ceil(Math.min(limit, 25) / Math.max(1, conc)) * 300);
  const work = dry ? [] : await claimStageWork(rpc, { limit, leaseSeconds, userId: OWNER });
  frames = work.map((w) => ({ id: w.image_id, vehicle_id: w.vehicle_id, user_id: w.user_id, image_url: w.image_url, target_version: w.target_version, lane: w.lane, reason: w.reason }));
} else {
  const statusFilter = statuses.length === 1 ? `ai_processing_status=eq.${statuses[0]}` : `ai_processing_status=in.(${statuses.join(',')})`;
  // the same holds the ledger applies: nothing sensitive, personal, duplicate, superseded or external goes to a reader
  const holds = 'is_sensitive=not.is.true&is_duplicate=not.is.true&is_superseded=not.is.true&is_external=not.is.true&or=(vision_gate_status.is.null,vision_gate_status.neq.rejected_personal)';
  frames = await rest(`vehicle_images?select=id,vehicle_id,user_id,image_url,file_name,taken_at,ai_processing_status&user_id=eq.${OWNER}&${statusFilter}&image_url=like.http*&${holds}&order=taken_at.desc.nullslast&limit=${limit}`);
}
console.error(`${frames.length} frames (${fromQueue ? 'stage queue' : statuses.join('/')}) to classify for ${OWNER} with the orchestrator's ${checklist.prompt_version} checklist (model ${model}, concurrency ${conc})${dry ? ' [dry run]' : ''}`);

// error_classes: why frames failed, from the receipt vocabulary (fixed words, never reader text), so the heartbeat row
// says what is wrong without anyone opening the log on the Mac.
const out = []; const summary = { cli: lean ? 'lean' : 'legacy_no_safe_mode', frames: frames.length, source: fromQueue ? 'stage-queue' : 'status', read: 0, accepted: 0, classifier_rejected: 0, errors: 0, error_classes: {}, receipts: 0, receipt_errors: 0, stopped: null, by_type: {}, read_seconds: 0 };
let stop = false;
// Each photo's result is typed once (receiptForResult). The type is counted in the summary on either worklist, and a
// fault that is the batch's rather than the photo's (compute exhausted, login or key refused, a missing tool, the API
// unreachable) ends the batch. On the stage queue the receipt is also written, once per claimed photo; photos claimed
// but not started go back to the queue when the lease ends.
const md5 = (t) => createHash('md5').update(t, 'utf8').digest('hex');
const settled = new Set();
const settle = async (f, result) => {
  if (settled.has(f.id)) return;
  settled.add(f.id);
  const receipt = receiptForResult(result, { reader: READER, promptVersion: checklist.prompt_version });
  if (receipt.error_class) {
    const cls = String(receipt.error_class).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);
    summary.error_classes[cls] = (summary.error_classes[cls] || 0) + 1;
  }
  if (receipt.stop) { stop = true; summary.stopped = receipt.error_class; }
  if (!fromQueue) return;
  const saved = await recordStageReceipt(rpc, { imageId: f.id, version: f.target_version, receipt, fingerprint: inputFingerprint(f.image_url, md5) });
  if (saved.ok) summary.receipts++; else { summary.receipt_errors++; console.error(`${f.id} receipt not recorded: ${saved.error}`); }
};
if (!dry) {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-classify-'));
  let i = 0;
  const worker = async () => {
    while (i < frames.length && !stop) {
      const f = frames[i++];
      const t0 = Date.now();
      let stage = 'download';
      // A directory of its own for this photo: the lean call's Read rule covers that directory only, and two photos are
      // read side by side. The pixels are not trusted (a photographed page can carry instructions), so the one tool the
      // model has must not reach another photo, the checkout or a key file.
      const own = mkdtempSync(join(dir, 'photo_'));
      try {
        if (!/^https?:\/\//.test(f.image_url ?? '')) { await settle(f, { input: {} }); throw new Error('no http(s) image URL'); }
        const ext = (f.file_name || f.image_url).toLowerCase().match(/\.(heic|heif|png|webp|jpe?g)/)?.[1] || 'jpg';
        const raw = join(own, `${f.id}.${ext}`);
        const res = await fetch(f.image_url).catch(() => ({ ok: false, status: 0 }));
        if (!res.ok) { await settle(f, { download: { status: res.status } }); throw new Error(`download ${res.status}`); }
        writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        let img = raw;
        if (ext !== 'jpg' && ext !== 'jpeg') {
          stage = 'convert';
          img = join(own, `${f.id}.jpg`);
          await run('sips', ['-s', 'format', 'jpeg', '-Z', '1600', raw, '--out', img]);
        }
        stage = 'reader';
        // lean start (leanClaudeArgs), in the empty temp directory: measured 2026-11-20 on six photos, 6 of 6 answers accepted by
        // the orchestrator's own validator either way, at 16k tokens of startup instead of 145k and 6 s instead of 9 s
        // The lean call may open files under this photo's directory only and starts without the service key or any other
        // credential in its environment (deepChildEnv), as the deep reads do; an older CLI keeps the call it had.
        const stdout = lean
          ? await claudePrint(leanClaudeArgs({ model, readDir: realpathSync(own) }), `${checklist.prompt}\n\nThe image is the file at ${img}. Read it first, then answer with ONLY the JSON object.`, { env: deepChildEnv(), cwd: own })
          : await claudePrint(legacyClaudeArgs({ model }), `${checklist.prompt}\n\nThe image is the file at ${img}. Read it first, then answer with ONLY the JSON object.`, { env: subscriptionEnv(), cwd: own });
        // an answer that does not parse is the reader's invalid output, whatever the parser's message happens to contain
        const invalid = (why) => Object.assign(new Error(why), { invalidOutput: true });
        let outer; try { outer = JSON.parse(stdout); } catch { throw invalid('no JSON in the reader output'); }
        if (outer.is_error) throw Object.assign(new Error(`reader error: ${String(outer.result ?? '').slice(0, 200)}`), { apiStatus: outer.api_error_status ?? null });
        const m = String(outer.result ?? '').match(/\{[\s\S]*\}/);
        if (!m) throw invalid('no JSON in the reader output');
        let classification_raw; try { classification_raw = JSON.parse(m[0]); } catch { throw invalid('the reader output is not valid JSON'); }
        summary.read++; summary.read_seconds += Math.round((outer.duration_ms || (Date.now() - t0)) / 1000);
        stage = 'orchestrator';
        const r = await orchestrator({ image_id: f.id, image_url: f.image_url, vehicle_id: f.vehicle_id, user_id: f.user_id, classification_raw, reader: READER });
        const t = classification_raw.image_type || '-'; summary.by_type[t] = (summary.by_type[t] || 0) + 1;
        stage = 'settled';
        await settle(f, { orchestrator: r, image_type: t });
        if (r.http === 200 && r.success !== false) summary.accepted++;
        else if (r.classifier_ok === false) summary.classifier_rejected++;
        else summary.errors++;
        out.push({ image_id: f.id, image_type: t, http: r.http, success: r.success, error_class: r.error_class, skipped: r.skipped });
        console.error(`${f.id} ${t} ${r.http} ${r.success === false ? (r.error_class || 'refused') : (r.skipped ? 'skipped:' + r.classification : 'ok')}`);
      } catch (e) {
        // Every claimed photo gets exactly one receipt (settle ignores a second call): an HTTP refusal was settled where
        // it happened; a body that could not be read, bytes that would not convert, a reader fault and an orchestrator
        // fault are settled here. Without one, the item would return to the queue on lease expiry with no attempt counted.
        if (stage === 'download') await settle(f, { download: { status: 0 } });
        else if (stage === 'convert') await settle(f, { convert: { missingTool: e?.code === 'ENOENT' } });
        else if (stage === 'reader') await settle(f, { reader: { error: String(e.message || e), apiStatus: e.apiStatus ?? null, invalidOutput: e.invalidOutput === true, missingTool: e?.code === 'ENOENT' } });
        else if (stage === 'orchestrator') await settle(f, { orchestrator: { http: 0, error_class: 'orchestrator_request_error' } });
        summary.errors++; out.push({ image_id: f.id, error: String(e.message || e).slice(0, 300) });
        console.error(`${f.id} ERROR ${String(e.message || e).slice(0, 160)}`);
      } finally { rmSync(own, { recursive: true, force: true }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));
  rmSync(dir, { recursive: true, force: true });
}

// ---- the stages after the first read: deep readings, then keyed values (same ledger, same receipts) --------------------
// Per-stage summaries go under "stages" in the heartbeat; the top-level fields above keep their meaning (the first reads).
const stages = {};
const settleStage = async (stageName, summary, f, receipt) => {
  countReceipt(summary, receipt);
  const saved = await recordStageReceipt(rpc, { stage: stageName, imageId: f.id, version: f.target_version, receipt, fingerprint: inputFingerprint(f.image_url, md5) });
  if (saved.ok) summary.receipts++; else { summary.receipt_errors++; console.error(`${f.id} ${stageName} receipt not recorded: ${saved.error}`); }
};
const toFrame = (w) => ({ id: w.image_id, vehicle_id: w.vehicle_id, user_id: w.user_id, image_url: w.image_url, target_version: w.target_version, lane: w.lane, reason: w.reason });
// Each stage runs inside its own boundary: a fault in one cannot cost the fire its first-read summary or its other stage.
const phaseFailed = (e) => ({ ...newStageSummary(), error: 'phase_failed', error_text: String(e?.message || e).slice(0, 120) });
async function deepPhase() {
  const s = newStageSummary();
  if (deepLimit < 1) { s.skipped = 'off'; return s; }
  // a fault that is the batch's (usage limit, login refused, API unreachable, a missing tool) would fail every deep reading the same way
  if (summary.stopped) { s.skipped = 'first_read_fault'; return s; }
  if (!lean) { s.skipped = 'cli_without_safe_mode'; return s; }
  let admits;
  try { admits = await readAdmits(); } catch (e) { s.skipped = 'admitted_values_unreadable'; s.error_text = String(e?.message || e).slice(0, 120); return s; }
  if (!admits.scene_type.length) { s.skipped = 'nothing_admitted'; return s; }
  Object.assign(s, { reads_valid: 0, agreed_all: 0, disagreements: {}, posted_values: 0, read_seconds: 0, input_tokens: 0, output_tokens: 0, aborted: 0 });
  // a refusal by the intake costs two reads; several in a row means the rule and the reader differ, which every later photo would repeat
  let refusedInARow = 0;
  // Claimed in small chunks, each leased for its own work (a photo is a download, two reads each allowed a retry, the intake):
  // a halt or the deadline then strands at most one chunk, not the whole limit.
  const chunk = Math.max(1, 2 * conc);
  const leaseSeconds = Math.max(900, Math.ceil(chunk / Math.max(1, conc)) * 600);
  const halt = new AbortController();
  let dir = null;
  try {
    const contract = contractText(), runId = newRunId();
    dir = mkdtempSync(join(tmpdir(), 'nuke-deep-'));
    const r = await claimAndWork({
      limit: deepLimit, chunk, width: conc, halted: () => halt.signal.aborted, deadline: Date.now() + DEEP_BUDGET_MS,
      claim: async (n) => { const c = await claimStageWorkUpTo(rpc, { stage: DEEP_STAGE, limit: n, leaseSeconds, userId: OWNER }); if (c.error) console.error(`${DEEP_STAGE}: ${c.error} ${c.detail}`); return { work: c.work.map(toFrame), error: c.error }; },
      work: async (f) => {
        s.started++;
        let res;
        try { res = await deepReadFrame(f, deepDeps(dir), { dir, contract, model, runId, reader: READER, signal: halt.signal, admits }); }
        catch (e) { res = { receipt: receiptForResult({ reader: { error: String(e?.message || e), missingTool: e?.code === 'ENOENT' } }, { reader: READER, promptVersion: 'reviewed_image_analysis_v1' }), stop: false }; }
        if (res.aborted || !res.receipt) { s.aborted++; return; }   // ended by a sibling's halt: no receipt, no attempt counted; the lease hands it back
        if (res.agreement && res.reads) {
          s.reads_valid += res.reads.length; s.read_seconds += Math.round(res.seconds);
          for (const x of res.reads) { s.input_tokens += x.stats.input_tokens; s.output_tokens += x.stats.output_tokens; }
          if (res.agreement.agreed) s.agreed_all++;
          if (res.agreement.held) s.held_pictures = (s.held_pictures || 0) + 1;
          s.posted_values += ['rust_severity', 'paint_state'].filter((k) => res.agreement.posted?.[k] && res.agreement.posted[k] !== 'unknown').length;
          for (const d of res.agreement.disagreements) s.disagreements[d.field] = (s.disagreements[d.field] || 0) + 1;
        }
        refusedInARow = refusalStreak(refusedInARow, res.receipt);
        if (refusedInARow >= REFUSAL_STREAK_STOP && !s.stopped) { s.stopped = 'intake_refusing'; halt.abort(); }
        if (res.receipt.stop) { s.stopped = res.receipt.error_class; halt.abort(); }
        await settleStage(DEEP_STAGE, s, f, res.receipt);
        console.error(`${f.id} ${DEEP_STAGE} ${res.receipt.outcome}${res.receipt.error_class ? ' ' + res.receipt.error_class : ''}${res.receipt.detail?.skipped ? ' ' + res.receipt.detail.skipped : ''}`);
      },
    });
    s.claimed = r.claimed;
    if (r.error) s.claim_error = r.error;
    if (r.claimed) console.error(`${r.claimed} photos claimed to read deeply (model ${model}, concurrency ${conc}, chunks of ${chunk})`);
  } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
  return s;
}
async function keyedPhase() {
  const s = newStageSummary();
  if (keyedLimit < 1) { s.skipped = 'off'; return s; }
  const claimed = await claimStageWorkUpTo(rpc, { stage: KEYED_STAGE, limit: keyedLimit, leaseSeconds: 1800, userId: OWNER });
  // photos an earlier page handed over are leased to this fire: work them even when a later page failed
  if (claimed.error) { s.claim_error = claimed.error; console.error(`${KEYED_STAGE}: ${claimed.error} ${claimed.detail}`); }
  const frames3 = claimed.work.map(toFrame);
  s.claimed = frames3.length;
  if (!frames3.length) return s;
  s.values = 0;
  let sb = null, sbError = null;
  try { sb = await supabaseClient(); } catch (e) { sbError = String(e?.message || e).slice(0, 120); }
  await pool(frames3, Math.min(conc, 3), async (f) => {
    s.started++;
    const res = sb ? await keyedValuesForFrame(f, { sb, reader: READER })
      : { receipt: { outcome: 'unavailable', error_class: 'projection_error', retry_after_seconds: 900, detail: { reader: READER, error: sbError } } };
    if (res.receipt.outcome === 'succeeded') s.values += res.receipt.detail.values || 0;
    await settleStage(KEYED_STAGE, s, f, res.receipt);
    console.error(`${f.id} ${KEYED_STAGE} ${res.receipt.outcome}${res.receipt.error_class ? ' ' + res.receipt.error_class : ''}${res.receipt.detail?.skipped ? ' ' + res.receipt.detail.skipped : ''}`);
  });
  return s;
}
if (fromQueue && !dry) {
  stages[DEEP_STAGE] = await deepPhase().catch((e) => { console.error(`${DEEP_STAGE} phase failed: ${String(e?.message || e).slice(0, 160)}`); return phaseFailed(e); });
  stages[KEYED_STAGE] = await keyedPhase().catch((e) => { console.error(`${KEYED_STAGE} phase failed: ${String(e?.message || e).slice(0, 160)}`); return phaseFailed(e); });
  summary.stages = stages;
}
const receipt = { run: 'subscription-frame-classifier', at: new Date().toISOString(), owner: OWNER, model, prompt_version: checklist.prompt_version, summary, results: out };
if (args.out && args.out !== true) writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(summary));

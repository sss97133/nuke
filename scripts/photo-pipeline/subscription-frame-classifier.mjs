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
//   dotenvx run -q -f ~/nuke/.env -- node scripts/photo-pipeline/subscription-frame-classifier.mjs --owner <uuid> [--limit N] [--concurrency 2] [--model sonnet] [--status failed,pending] [--source auto|stage-queue|status] [--dry-run] [--out receipt.json]
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimStageWork, inputFingerprint, receiptForResult, recordStageReceipt, stageQueueEnabled } from './stage-queue.mjs';
const run = promisify(execFile);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under dotenvx)'); process.exit(2); }
if (!args.owner || args.owner === true) { console.error('--owner <uuid> is required'); process.exit(2); }
if (process.env.ANTHROPIC_API_KEY) { console.error('refusing: ANTHROPIC_API_KEY is set; this reader runs on the subscription login only'); process.exit(2); }
const OWNER = args.owner;
const limit = args.limit && args.limit !== true ? Number(args.limit) : 200;
const conc = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : 2;
const model = args.model && args.model !== true ? String(args.model) : 'sonnet';
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
async function orchestrator(body) {
  const r = await fetch(`${URL_}/functions/v1/photo-pipeline-orchestrator`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
  return { http: r.status, ...j };
}

function claudePrint(text, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model, '--allowedTools', 'Read'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('reader timed out after 240 s')); }, 240_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    // A run that ends in an error (a usage limit, an API error) can exit non-zero with its JSON result on stdout: hand
    // that result on so the caller reads is_error and api_error_status instead of an empty stderr.
    const hasResult = () => { try { return typeof JSON.parse(out) === 'object' && JSON.parse(out) !== null; } catch { return false; } };
    child.on('close', (code) => { clearTimeout(timer); code === 0 || hasResult() ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 200)}`)); });
    child.stdin.end(text);
  });
}

const checklist = await orchestrator({ action: 'classifier_prompt' });
if (checklist.http !== 200 || typeof checklist.prompt !== 'string') { console.error(`could not get the checklist: ${checklist.http} ${checklist.error ?? ''}`); process.exit(1); }
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
const out = []; const summary = { frames: frames.length, source: fromQueue ? 'stage-queue' : 'status', read: 0, accepted: 0, classifier_rejected: 0, errors: 0, error_classes: {}, receipts: 0, receipt_errors: 0, stopped: null, by_type: {}, read_seconds: 0 };
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
      try {
        if (!/^https?:\/\//.test(f.image_url ?? '')) { await settle(f, { input: {} }); throw new Error('no http(s) image URL'); }
        const ext = (f.file_name || f.image_url).toLowerCase().match(/\.(heic|heif|png|webp|jpe?g)/)?.[1] || 'jpg';
        const raw = join(dir, `${f.id}.${ext}`);
        const res = await fetch(f.image_url).catch(() => ({ ok: false, status: 0 }));
        if (!res.ok) { await settle(f, { download: { status: res.status } }); throw new Error(`download ${res.status}`); }
        writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        let img = raw;
        if (ext !== 'jpg' && ext !== 'jpeg') {
          stage = 'convert';
          img = join(dir, `${f.id}.jpg`);
          await run('sips', ['-s', 'format', 'jpeg', '-Z', '1600', raw, '--out', img]);
        }
        const env = { ...process.env }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.ANTHROPIC_API_KEY;
        stage = 'reader';
        const stdout = await claudePrint(`${checklist.prompt}\n\nThe image is the file at ${img}. Read it first, then answer with ONLY the JSON object.`, env);
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
        for (const p of [raw, img]) if (existsSync(p)) rmSync(p, { force: true });
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
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));
  rmSync(dir, { recursive: true, force: true });
}
const receipt = { run: 'subscription-frame-classifier', at: new Date().toISOString(), owner: OWNER, model, prompt_version: checklist.prompt_version, summary, results: out };
if (args.out && args.out !== true) writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(summary));

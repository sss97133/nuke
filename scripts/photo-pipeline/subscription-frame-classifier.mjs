#!/usr/bin/env node
// The owner's subscription classifies the photos the pipeline could not (no platform vision key answers).
//
// The orchestrator hands out its own checklist (action classifier_prompt: the v98 prompt from the live manifest); this
// script runs it on the owner's Mac as `claude -p` under his Claude Code login (OAuth; ANTHROPIC_API_KEY refused), and
// posts the JSON back to the orchestrator as classification_raw. The orchestrator validates it exactly like a provider
// answer and runs the rest of its pipeline unchanged (routing, filing through attribute_testimony, the observation).
// Nothing here writes to the database.
//
//   dotenvx run -q -f ~/nuke/.env -- node scripts/photo-pipeline/subscription-frame-classifier.mjs --owner <uuid> [--limit N] [--concurrency 2] [--model sonnet] [--status failed,pending] [--dry-run] [--out receipt.json]
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const READER = `claude-cli ${model} subscription`;

async function rest(q) {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.slice(0, 60)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
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
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`)); });
    child.stdin.end(text);
  });
}

const checklist = await orchestrator({ action: 'classifier_prompt' });
if (checklist.http !== 200 || typeof checklist.prompt !== 'string') { console.error(`could not get the checklist: ${checklist.http} ${checklist.error ?? ''}`); process.exit(1); }
const statusFilter = statuses.length === 1 ? `ai_processing_status=eq.${statuses[0]}` : `ai_processing_status=in.(${statuses.join(',')})`;
const frames = await rest(`vehicle_images?select=id,vehicle_id,user_id,image_url,file_name,taken_at,ai_processing_status&user_id=eq.${OWNER}&${statusFilter}&image_url=not.is.null&order=taken_at.desc.nullslast&limit=${limit}`);
console.error(`${frames.length} frames (${statuses.join('/')}) to classify for ${OWNER} with the orchestrator's ${checklist.prompt_version} checklist (model ${model}, concurrency ${conc})${dry ? ' [dry run]' : ''}`);

const out = []; const summary = { frames: frames.length, read: 0, accepted: 0, classifier_rejected: 0, errors: 0, by_type: {}, read_seconds: 0 };
if (!dry) {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-classify-'));
  let i = 0;
  const worker = async () => {
    while (i < frames.length) {
      const f = frames[i++];
      const t0 = Date.now();
      try {
        const ext = (f.file_name || f.image_url).toLowerCase().match(/\.(heic|heif|png|webp|jpe?g)/)?.[1] || 'jpg';
        const raw = join(dir, `${f.id}.${ext}`);
        const res = await fetch(f.image_url);
        if (!res.ok) throw new Error(`download ${res.status}`);
        writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        let img = raw;
        if (ext !== 'jpg' && ext !== 'jpeg') { img = join(dir, `${f.id}.jpg`); await run('sips', ['-s', 'format', 'jpeg', '-Z', '1600', raw, '--out', img]); }
        const env = { ...process.env }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.ANTHROPIC_API_KEY;
        const stdout = await claudePrint(`${checklist.prompt}\n\nThe image is the file at ${img}. Read it first, then answer with ONLY the JSON object.`, env);
        const outer = JSON.parse(stdout);
        if (outer.is_error) throw new Error(`reader error: ${String(outer.result ?? '').slice(0, 200)}`);
        const m = String(outer.result ?? '').match(/\{[\s\S]*\}/);
        if (!m) throw new Error('no JSON in the reader output');
        const classification_raw = JSON.parse(m[0]);
        summary.read++; summary.read_seconds += Math.round((outer.duration_ms || (Date.now() - t0)) / 1000);
        const r = await orchestrator({ image_id: f.id, image_url: f.image_url, vehicle_id: f.vehicle_id, user_id: f.user_id, classification_raw, reader: READER });
        const t = classification_raw.image_type || '-'; summary.by_type[t] = (summary.by_type[t] || 0) + 1;
        if (r.http === 200 && r.success !== false) summary.accepted++;
        else if (r.classifier_ok === false) summary.classifier_rejected++;
        else summary.errors++;
        out.push({ image_id: f.id, image_type: t, http: r.http, success: r.success, error_class: r.error_class, skipped: r.skipped });
        console.error(`${f.id} ${t} ${r.http} ${r.success === false ? (r.error_class || 'refused') : (r.skipped ? 'skipped:' + r.classification : 'ok')}`);
        for (const p of [raw, img]) if (existsSync(p)) rmSync(p, { force: true });
      } catch (e) {
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

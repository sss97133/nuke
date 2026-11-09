#!/usr/bin/env node
// The owner's subscription reads the photographed documents the pipeline routed (receipt_document frames).
//
// Owner decision 2026-11-08: "ai read should be fueled by my subscription". No platform vision key answers (Gemini 402,
// Anthropic 401, OpenAI insufficient_quota, xAI 403), so the read runs HERE, on the owner's Mac, as `claude -p` under his
// Claude Code login (OAuth; no ANTHROPIC_API_KEY in this process). The edge function receipt-photo-ocr then lands the
// result through the existing writers (private copy, capture_document_pages, land_document_pages, the observation bridge).
// Nothing here writes to the database; the function's writers do.
//
//   dotenvx run -q -f ~/nuke/.env -- node scripts/photo-pipeline/subscription-document-reader.mjs --owner <uuid> [--limit N] [--concurrency 2] [--model sonnet] [--dry-run] [--out receipt.json]
//
// Work list: the owner's frames whose pipeline classification named a document type (ai_scan_metadata.classification.v2
// .document_type) or whose route hit the missing function, minus frames that already have a capture_document_pages row.
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
const limit = args.limit && args.limit !== true ? Number(args.limit) : 500;
const conc = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : 2;
const model = args.model && args.model !== true ? String(args.model) : 'sonnet';
const dry = args['dry-run'] === true;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const TYPES = ['receipt', 'invoice', 'work_order', 'packing_slip', 'order_confirmation', 'estimate', 'statement', 'alignment_report', 'title', 'registration', 'sale_sheet', 'manual', 'shipping_bill', 'other'];
const prompt = (path) => `Read the image file ${path}. It is a photographed business document belonging to the person who took the photo. Return ONLY a JSON object, no prose, with keys: document_type (one of ${TYPES.join(', ')}), confidence (0-1), vendor_name, vendor_address, date (YYYY-MM-DD, the document's own printed date), invoice_number, receipt_number, line_items (array of {description, part_number, quantity, unit_price, amount}; one entry per printed line), subtotal, discount, shipping, tax, total, payment_method (card brand or payment kind only, never digits), customer_name (name only, never an address), vin, year, make, model, notes (one line: anything that would matter to a mechanic or an accountant). Omit keys you cannot read. Never include card numbers, e-mail addresses, phone numbers of people, or raw OCR text.`;

async function rest(q) {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: { ...H, Prefer: 'count=none' } });
  if (!r.ok) throw new Error(`${q.slice(0, 60)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Pages the route recorded while their frame had no vehicle, whose frame now holds one (capture_documents_land_by_vin, or the
// capture landing loop): the route lands them from the stored page, no second read. The view drops a page once it carries
// extraction.landed.
async function toLand() {
  try { return await rest(`capture_document_pages_to_land?select=image_id,vehicle_id,doc_type&user_id=eq.${OWNER}&order=page_at&limit=200`); }
  catch (e) { console.error(`to-land view unavailable: ${e.message}`); return []; }
}
async function worklist() {
  const done = new Set((await rest(`capture_document_pages?select=image_id&user_id=eq.${OWNER}&revoked_at=is.null&limit=5000`)).map((r) => r.image_id));
  const typed = await rest(`vehicle_images?select=id,vehicle_id,image_url,file_name,taken_at,ai_scan_metadata->classification->v2->>document_type&user_id=eq.${OWNER}&ai_scan_metadata->classification->v2->>document_type=not.is.null&order=taken_at.desc.nullslast&limit=2000`);
  const routed = await rest(`vehicle_images?select=id,vehicle_id,image_url,file_name,taken_at&user_id=eq.${OWNER}&ai_scan_metadata->>route_result=like.receipt-photo-ocr*&order=taken_at.desc.nullslast&limit=2000`);
  const byId = new Map();
  for (const f of [...typed, ...routed]) if (f.image_url && !done.has(f.id)) byId.set(f.id, f);
  return [...byId.values()].slice(0, limit);
}

function parseResult(text) {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in the reader output');
  const j = JSON.parse(m[0]);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('reader output is not an object');
  return j;
}

// claude -p with the prompt on stdin (execFile's `input` is ignored for async calls; the CLI then waits 3 s and runs empty).
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

async function readFrame(f, dir) {
  const ext = (f.file_name || f.image_url).toLowerCase().match(/\.(heic|heif|png|webp|jpe?g)/)?.[1] || 'jpg';
  const raw = join(dir, `${f.id}.${ext}`);
  const res = await fetch(f.image_url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  let img = raw;
  if (ext === 'heic' || ext === 'heif') {
    img = join(dir, `${f.id}.jpg`);
    await run('sips', ['-s', 'format', 'jpeg', '-Z', '2200', raw, '--out', img]);
  }
  const env = { ...process.env };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.ANTHROPIC_API_KEY;
  const stdout = await claudePrint(prompt(img), env);
  const outer = JSON.parse(stdout);
  if (outer.is_error) throw new Error(`reader error: ${String(outer.result ?? '').slice(0, 200)}`);
  const extraction = parseResult(outer.result);
  return { extraction, duration_ms: outer.duration_ms, usage_cost: outer.total_cost_usd };
}

async function land(f, extraction) {
  const body = { image_id: f.id, extraction, document_type: extraction.document_type, confidence: extraction.confidence, reader: `claude-cli ${model} subscription` };
  const r = await fetch(`${URL_}/functions/v1/receipt-photo-ocr`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
  return { http: r.status, ...j };
}

const frames = await worklist();
console.error(`${frames.length} document frames to read for ${OWNER} (model ${model}, concurrency ${conc})${dry ? ' [dry run]' : ''}`);
const out = []; const summary = { frames: frames.length, read: 0, page: 0, landed: 0, waiting_no_vehicle: 0, vehicle_document: 0, errors: 0, by_type: {}, read_seconds: 0 };
if (!dry) {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-docread-'));
  let i = 0;
  const worker = async () => {
    while (i < frames.length) {
      const f = frames[i++];
      const t0 = Date.now();
      try {
        const { extraction, duration_ms } = await readFrame(f, dir);
        summary.read++; summary.read_seconds += Math.round((duration_ms || (Date.now() - t0)) / 1000);
        const res = await land(f, extraction);
        out.push({ image_id: f.id, vehicle_id: f.vehicle_id, document_type: extraction.document_type, ...res });
        if (res.page) summary.page++;
        if (res.landed) summary.landed++;
        else if (/no vehicle/.test(res.reason || '')) summary.waiting_no_vehicle++;
        else if (/vehicle document/.test(res.reason || '')) summary.vehicle_document++;
        if (res.error || res.http >= 400) summary.errors++;
        const t = extraction.document_type || '-'; summary.by_type[t] = (summary.by_type[t] || 0) + 1;
        console.error(`${f.id} ${t} ${res.http} ${res.landed ? 'landed ' + res.receipt_id : (res.reason || res.error || '')}`);
      } catch (e) {
        summary.errors++; out.push({ image_id: f.id, error: String(e.message || e).slice(0, 300) });
        console.error(`${f.id} ERROR ${String(e.message || e).slice(0, 160)}`);
      }
      for (const p of [join(dir, `${f.id}.jpg`), join(dir, `${f.id}.heic`)]) if (existsSync(p)) rmSync(p, { force: true });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));
  rmSync(dir, { recursive: true, force: true });

  // Pages recorded earlier whose frame now holds a vehicle: the route lands them from the stored page (no read).
  const pending = await toLand();
  summary.to_land = pending.length; summary.relanded = 0; summary.reland_vehicle_document = 0; summary.reland_errors = 0;
  for (const p of pending) {
    try {
      const r = await fetch(`${URL_}/functions/v1/receipt-photo-ocr`, { method: 'POST', headers: H, body: JSON.stringify({ image_id: p.image_id }) });
      const res = await r.json().catch(() => ({}));
      out.push({ image_id: p.image_id, vehicle_id: p.vehicle_id, document_type: p.doc_type, reland: true, http: r.status, landed: !!res.landed, reason: res.reason, receipt_id: res.receipt_id, error: res.error });
      if (res.landed) summary.relanded++;
      else if (/vehicle document/.test(res.reason || '')) summary.reland_vehicle_document++;
      else summary.reland_errors++;
      console.error(`${p.image_id} ${p.doc_type} reland ${r.status} ${res.landed ? 'landed ' + res.receipt_id : (res.reason || res.error || '')}`);
    } catch (e) {
      summary.reland_errors++; out.push({ image_id: p.image_id, reland: true, error: String(e.message || e).slice(0, 300) });
    }
  }
}
const receipt = { run: 'subscription-document-reader', at: new Date().toISOString(), owner: OWNER, model, summary, results: out };
if (args.out && args.out !== true) writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(summary));

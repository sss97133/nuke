#!/usr/bin/env node
/**
 * content-miner.mjs — the bank-builder.
 *
 * Mines new idea-dense material (recent Claude sessions + the contemplations library),
 * drafts X post candidates against the gate via a BYOK model (Gemini default — NOT Anthropic),
 * then runs every candidate through a STRUCTURAL GATE before it can land. The gate is the
 * aperture applied to our own output: an em-dash, a commodity phrase, or an unsourced factual
 * claim is a compile error, not low-quality output that slips through. Survivors append to a
 * private review bank. Nothing posts. Skylar skims and ❌'s the duds.
 *
 * Dogfoods the thesis: the content engine enforces the same provenance/voice rules it preaches.
 *
 * Usage:
 *   dotenvx run -- node scripts/content-miner.mjs            # one batch
 *   dotenvx run -- node scripts/content-miner.mjs --selftest # assert the gate drops bad drafts
 *   dotenvx run -- node scripts/content-miner.mjs --provider gemini --model gemini-2.0-flash
 *
 * Exit codes (consumed by content-miner-batch.sh): 0 = candidates added · 3 = drained (no new
 * material) · 1 = transient error.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BANK = path.join(ROOT, 'docs/content/X_BANK.md');
const STATE = path.join(ROOT, 'logs/content-miner.state');
const SESSIONS_DIR = path.join(os.homedir(), '.claude/projects/-Users-skylar-nuke');
const CONTEMPLATIONS = path.join(ROOT, 'docs/library/intellectual/contemplations');

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
// Provider state (2026-06-14): openai key works; gemini free quota exhausted (429); xai out of
// credits (403); GOOGLE_AI_API_KEY expired (use GEMINI_API_KEY). Default to the one with headroom.
const PROVIDER = getArg('provider', 'openai');
const PROVIDER_MODELS = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', xai: 'grok-4-1-fast-reasoning', modal: 'qwen2.5-7b' };
const MODEL = getArg('model', PROVIDER_MODELS[PROVIDER] || 'gpt-4o-mini');
const MAX_FILES = parseInt(getArg('max-files', '8'), 10);
const CHARS_PER_BATCH = 22000;

// ─── Redaction (from ingest_session_logs_to_observations.ts) ────────────────────────────────
const REDACTION = [
  /sk-ant-[A-Za-z0-9_\-]{20,}/g, /sk-(?:proj-)?[A-Za-z0-9]{20,}/g,
  /sb_(?:secret|publishable)_[A-Za-z0-9_\-]{16,}/g, /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
  /(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)\s*=\s*['"]?[A-Za-z0-9_\-+\/=.]{16,}['"]?/gi,
];
const redact = (s) => REDACTION.reduce((acc, re) => acc.replace(re, '[REDACTED]'), s);

// ─── THE GATE (plain code — the aperture on our own output) ─────────────────────────────────
const BANNED = [
  'game-changer', 'game changer', 'at the end of the day', 'leverage synerg', 'revolutioniz',
  'cutting-edge', 'unlock the power', "in today's fast-paced", 'thought leader', 'excited to share',
  'thrilled to', 'move the needle', 'paradigm shift', 'seamless', 'best practices', 'dive deep',
  'circle back', 'let that sink in', 'the future of', 'supercharge', 'harness the power',
];
// external-fact patterns that REQUIRE a citation to be present
const FACT_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d+)?/,            // dollar amounts
  /\b\d+(?:\.\d+)?\s?%/,                // percentages
  /\bet\s+al\.?/i,                      // academic cite
  /\b(?:arxiv|doi|stoc|neurips|icml|acl|sigir|emnlp)\b/i,
  /\([A-Z][a-z]+(?:\s+(?:&|and|et al\.?,?))?\s*\d{4}\)/, // (Author, 2024)
];

/** Returns { ok, reasons[] }. A candidate must pass ALL checks. citations: [{claim,url}] */
function gate(text, citations = []) {
  const reasons = [];
  if (/[—–]/.test(text)) reasons.push('em/en-dash present (AI tell — Skylar uses periods/commas)');
  const lower = text.toLowerCase();
  for (const p of BANNED) if (lower.includes(p)) reasons.push(`commodity phrase: "${p}"`);
  if (text.length > 1500) reasons.push(`too long (${text.length} > 1500)`);
  if (text.trim().length < 40) reasons.push('too short');
  const hasFact = FACT_PATTERNS.some((re) => re.test(text));
  const httpCites = citations.filter((c) => /^https?:\/\//.test(c.url || ''));
  if (hasFact && citations.length === 0)
    reasons.push('asserts an external fact (number/stat/citation) with NO source — unsourced claim');
  return { ok: reasons.length === 0, reasons, httpCites };
}

/** Web-verify a citation URL resolves (< 400). Internal/non-http citations pass without a check. */
async function verifyUrl(url) {
  try {
    const ctrl = AbortSignal.timeout(8000);
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return r.status < 400;
  } catch { return false; }
}

// ─── BYOK drafting (Gemini caller from mine-comments-for-library.mjs) ────────────────────────
async function callGemini(system, user) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY / GOOGLE_AI_API_KEY not set');
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }) });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  const r = await resp.json();
  return r.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
async function callModal(system, user) {
  const url = process.env.MODAL_LLM_URL || 'https://sss97133--nuke-vllm-serve.modal.run';
  const resp = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen2.5-7b', temperature: 0.4, max_tokens: 4096,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  if (!resp.ok) throw new Error(`Modal ${resp.status}`);
  const r = await resp.json();
  return r.choices?.[0]?.message?.content || '';
}
// OpenAI-compatible chat completions (XAI/Grok and OpenAI both speak this)
async function callOpenAICompat(system, user) {
  const cfg = {
    xai: { base: 'https://api.x.ai/v1', key: process.env.XAI_API_KEY },
    openai: { base: 'https://api.openai.com/v1', key: process.env.OPENAI_API_KEY },
  }[PROVIDER];
  if (!cfg?.key) throw new Error(`${PROVIDER} API key not set`);
  const resp = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!resp.ok) throw new Error(`${PROVIDER} ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  const r = await resp.json();
  return r.choices?.[0]?.message?.content || '';
}

function draft(system, user) {
  if (PROVIDER === 'modal') return callModal(system, user);
  if (PROVIDER === 'gemini') return callGemini(system, user);
  return callOpenAICompat(system, user); // xai | openai
}

const SYSTEM = `You distill Skylar's own ideas into X post candidates for a PRIVATE review bank.
He is a builder working on data honesty / provenance in AI systems, vehicle data, and getting humans off computers.

HARD RULES (a post that breaks any of these is worthless — do not emit it):
1. NO em-dashes or en-dashes. Ever. Skylar writes with periods, commas, and colons. This is non-negotiable.
2. No commodity/LinkedIn phrases ("game-changer", "excited to share", "the future of", "seamless", "thought leader", etc.).
3. Every external fact (a number, a statistic, a paper, a (Author, Year) cite) MUST carry a real source in citations[]. If you cannot source it, do not state it. NEVER invent or use placeholder URLs (no example.com, no made-up links). Most posts distilled from Skylar's own ideas need NO citation at all — leave citations [] empty unless you have a real, specific source URL.
4. Lead with a HARD PROBLEM, carry ONE specific real artifact, land a NON-OBVIOUS claim. No corny universals.
5. Voice: direct, first-principles, concrete, no fluff, no hedging. Sound like a builder, not a brand.

Distill only ideas actually present in the provided material. Do not invent claims about Skylar's work.
Return JSON: {"candidates":[{"register":"aphorism|hard_problem|contrarian|thread_opener","text":"...","citations":[{"claim":"...","url":"https://..."}],"source_idea":"one line on where in the material this came from"}]}
Return 0 candidates if the material has nothing genuinely post-worthy. Quality over quantity.`;

// ─── Mining ─────────────────────────────────────────────────────────────────────────────────
function watermark() { try { return new Date(fs.readFileSync(STATE, 'utf8').trim()); } catch { return new Date(0); } }
function setWatermark(d) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, d.toISOString()); }

function newFiles(dir, since, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => path.join(dir, f))
    .filter((p) => exts.some((e) => p.endsWith(e)))
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .filter((x) => x.mtime > since.getTime())
    .sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
}

function userTurnsFrom(jsonlPath) {
  const out = [];
  for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const role = o?.message?.role || o?.type;
    if (role !== 'user') continue;
    let c = o?.message?.content;
    if (Array.isArray(c)) c = c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
    if (typeof c !== 'string') continue;
    c = c.trim();
    if (c.length < 300) continue;                                   // idea-dense only
    if (/^(run|go|continue|ok|yes|fix it|ship|<command|\[Request interrupted)/i.test(c)) continue;
    out.push(redact(c).slice(0, 4000));
  }
  return out;
}

function chunk(strings, cap) {
  const chunks = []; let cur = '';
  for (const s of strings) {
    if ((cur + '\n\n' + s).length > cap) { if (cur) chunks.push(cur); cur = s; }
    else cur += (cur ? '\n\n' : '') + s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ─── Self-test (verification per the plan) ──────────────────────────────────────────────────
function selftest() {
  const bad = gate('An agent told me a truck was worth $85,100 — and I believed it.', []);
  const badPhrase = gate('This is a game-changer for honesty.', []);
  const good = gate('A number without a source is not data. It is a rumor with a decimal point.', []);
  const cited = gate('Calibrated models must hallucinate rare facts (Kalai & Vempala 2024).', [{ claim: 'monofact', url: 'https://arxiv.org/abs/2311.14648' }]);
  const checks = [
    ['em-dash + unsourced $ dropped', !bad.ok],
    ['commodity phrase dropped', !badPhrase.ok],
    ['clean aphorism passes', good.ok],
    ['cited fact passes gate (pre-URL-check)', cited.ok],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) pass = false; }
  console.log(pass ? '\nGATE OK' : '\nGATE BROKEN');
  process.exit(pass ? 0 : 1);
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (args.includes('--selftest')) return selftest();
  const since = watermark();
  const runStart = new Date();
  const sessionFiles = newFiles(SESSIONS_DIR, since, ['.jsonl']);
  const essayFiles = newFiles(CONTEMPLATIONS, since, ['.md']);
  console.log(`watermark=${since.toISOString()} | new sessions=${sessionFiles.length} essays=${essayFiles.length} | provider=${PROVIDER}/${MODEL}`);
  if (sessionFiles.length === 0 && essayFiles.length === 0) { console.log('drained — no new material'); process.exit(3); }

  let material = [];
  for (const { p } of sessionFiles) material.push(...userTurnsFrom(p));
  for (const { p } of essayFiles) material.push(redact(fs.readFileSync(p, 'utf8')).slice(0, 4000));
  material = material.filter(Boolean);
  if (material.length === 0) { setWatermark(runStart); console.log('drained — no idea-dense turns'); process.exit(3); }

  const survivors = []; const dropped = [];
  for (const c of chunk(material, CHARS_PER_BATCH)) {
    let raw; try { raw = await draft(SYSTEM, `MATERIAL (Skylar's own words):\n\n${c}`); }
    catch (e) { console.error('draft error:', e.message); process.exit(1); }
    let parsed; try { parsed = JSON.parse(raw); } catch { console.error('bad JSON from model, skipping chunk'); continue; }
    for (const cand of parsed.candidates || []) {
      const text = (cand.text || '').trim();
      const g = gate(text, cand.citations || []);
      if (!g.ok) { dropped.push({ text: text.slice(0, 80), reasons: g.reasons }); continue; }
      let citeOk = true;
      for (const c2 of g.httpCites) if (!(await verifyUrl(c2.url))) { citeOk = false; dropped.push({ text: text.slice(0, 80), reasons: [`citation unverifiable: ${c2.url}`] }); break; }
      if (!citeOk) continue;
      survivors.push(cand);
    }
  }

  console.log(`drafted survivors=${survivors.length} dropped=${dropped.length}`);
  for (const d of dropped) console.log(`  DROP [${d.reasons.join('; ')}] ${d.text}`);

  if (survivors.length) {
    const stamp = runStart.toISOString().slice(0, 16).replace('T', ' ');
    let block = `\n\n---\n\n## BANK — ${stamp} (${survivors.length} passed the gate · ${dropped.length} dropped)\n*Auto-mined from new sessions/library. Gate-passed: no em-dashes, no commodity phrases, facts sourced+verified. ❌ the duds.*\n\n`;
    for (const s of survivors) {
      const cites = (s.citations || []).map((c) => c.url).filter(Boolean);
      block += `- [ ] _(${s.register || 'post'})_ ${s.text}\n`;
      if (cites.length) block += `      sources: ${cites.join(' · ')}\n`;
      if (s.source_idea) block += `      from: ${s.source_idea}\n`;
    }
    fs.mkdirSync(path.dirname(BANK), { recursive: true });
    if (!fs.existsSync(BANK)) fs.writeFileSync(BANK, '# X Bank — private review queue\n\nAuto-mined post candidates that passed the structural gate. Nothing here is published. Skim and ❌ the duds.\n');
    fs.appendFileSync(BANK, block);
    console.log(`appended ${survivors.length} to ${BANK}`);
  }
  setWatermark(runStart);
  process.exit(survivors.length ? 0 : 3);
}

main().catch((e) => { console.error(e); process.exit(1); });

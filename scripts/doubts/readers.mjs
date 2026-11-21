// Reader providers for fact doubts: which model answers a blind task, and how. Pure parts (selection, request shapes, output
// parsing, usage-limit detection) are here and unit-tested; the calls are made by answer-fact-doubts.mjs.
//   api           Anthropic Messages API with a working key (counted tokens, priced).
//   subscription  `claude -p` under the owner's Claude Code login on this Mac (no API key; cost 0). Reads the task and frames from
//                 a temp directory with the Read tool only.
//   gemini        Gemini generateContent over REST with inline images; the key travels in the x-goog-api-key header only.
import { spawn } from 'node:child_process';
import { USAGE_LIMIT } from '../photo-pipeline/stage-queue.mjs';
import { ANSWER_SCHEMA } from './fact-doubts.mjs';

export const PROVIDERS = ['api', 'subscription', 'gemini'];
export const AGENTS = { api: 'fact-doubt-reader', subscription: 'fact-doubt-reader', gemini: 'fact-doubt-reader-gemini' };
export const API_KEY_ENVS = ['NUKE_ANTHROPIC_API_KEY', 'NUKE_PHOTO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];
export const GEMINI_KEY_ENVS = ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'];
export const GEMINI_HOST = 'https://generativelanguage.googleapis.com';
export const CLI_TIMEOUT_MS = 240_000;

// Owner rule (2026-11-08): AI reading runs on the subscription CLI, not a metered key. Subscription is the default;
// api and gemini run only when --provider names them.
export function selectProvider(flag, env) {
  if (flag != null) { if (!PROVIDERS.includes(flag)) throw new Error(`--provider must be ${PROVIDERS.join('|')}`); return flag; }
  return 'subscription';
}

// The subscription CLI must run under the owner's login: no API key, no parent-session markers.
export function scrubbedEnv(env) {
  const out = { ...env };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete out[k];
  return out;
}
export const CLI_ARGS = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-5-5', '--allowedTools', 'Read'];
export const CLI_PROMPT = 'Read task.json and the frame image files named in it, all in the current directory (use the Read tool on each file). '
  + 'Follow the instructions in task.json. Reply with ONLY the answer JSON object, no other text.';

// CLI stdout may carry warning lines before the JSON (an mcp-sdk line is printed): take the last parseable top-level JSON object.
export function parseCliStdout(stdout) {
  const text = String(stdout ?? '');
  // candidate starts: a line beginning with "{"; the first one whose text to the end parses is the last JSON object
  const starts = [...text.matchAll(/^\{/gm)].map((m) => m.index);
  for (const i of starts) {
    try { const o = JSON.parse(text.slice(i).trim()); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* a warning line or an inner object: next start */ }
  }
  throw new Error('no JSON object in the CLI output');
}
export const isUsageLimit = (text) => USAGE_LIMIT.test(String(text ?? ''));

// Answer JSON out of a model's text (the whole text, or the first {...} block of it).
export function answerJsonFrom(text) {
  const t = String(text ?? '').trim();
  try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in the reader output');
  return JSON.parse(m[0]);
}

// What a finished CLI run says: the resolved model id (modelUsage keys), tokens, and an error that stops the run.
export function readCliResult(stdout) {
  const o = parseCliStdout(stdout);
  const models = Object.keys(o.modelUsage ?? {});
  const result = String(o.result ?? '');
  if (o.is_error) return { stop: isUsageLimit(result) || o.api_error_status === 429 || o.api_error_status === 529, error: `reader error: ${result.slice(0, 200)}` };
  if (isUsageLimit(result) && !result.includes('{')) return { stop: true, error: `usage limit: ${result.slice(0, 200)}` };
  const u = o.usage ?? {};
  return { text: result, model: models.find((m) => /sonnet|opus|haiku/.test(m)) ?? models[0] ?? null,
    usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 } };
}

export function runClaudeCli(dir, env, { timeoutMs = CLI_TIMEOUT_MS, bin = 'claude' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, CLI_ARGS, { cwd: dir, env: scrubbedEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`reader timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    // a run that ends in an error can exit non-zero with its JSON on stdout: hand it on so is_error is read
    child.on('close', (code) => { clearTimeout(timer); let ok = false; try { ok = !!parseCliStdout(out); } catch { /* none */ } code === 0 || ok ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 200)}`)); });
    child.stdin.end(CLI_PROMPT);
  });
}

// Newest stable pro model (no preview, image, tts, latest or customtools variants), else the newest stable flash.
export function pickGeminiModel(list) {
  const names = (list ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
  const newest = (kind) => names.map((n) => { const m = n.match(new RegExp(`^gemini-(\\d+(?:\\.\\d+)?)-${kind}$`)); return m ? { n, v: Number(m[1]) } : null; })
    .filter(Boolean).sort((a, b) => b.v - a.v)[0]?.n;
  const pick = newest('pro') ?? newest('flash');
  if (!pick) throw new Error('no stable gemini pro/flash model in the list');
  return pick;
}

// Gemini's schema subset (OpenAPI): the same closed answer, nullable instead of type unions.
export const GEMINI_SCHEMA = {
  type: 'OBJECT', required: ['outcome', 'confidence'],
  properties: {
    outcome: { type: 'STRING', enum: ['value', 'not_visible', 'cannot_tell'] },
    value: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER' },
    image_ids: { type: 'ARRAY', items: { type: 'STRING' } },
    receipt_item_ids: { type: 'ARRAY', items: { type: 'STRING' } },
    quote: { type: 'STRING', nullable: true },
  },
};
void ANSWER_SCHEMA;

// REST request for one blind task. images: Map image_id -> base64 jpeg. The key is never part of the URL or the body.
export function geminiRequest({ model, task, images, key }) {
  const parts = [];
  for (const e of task.evidence) {
    if (e.kind === 'image') { const im = images.get(e.id); if (im) { parts.push({ text: `Image id: ${e.id}` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: im } }); } }
    else parts.push({ text: `Receipt line id: ${e.id}\n${e.text}` });
  }
  parts.push({ text: task.text });
  return {
    url: `${GEMINI_HOST}/v1beta/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: { systemInstruction: { parts: [{ text: task.system }] }, contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0 } },
  };
}

export function readGeminiResponse(j) {
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const u = j?.usageMetadata ?? {};
  return { text, model: j?.modelVersion ?? null, usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cache_read: 0, cache_write: 0 } };
}

// Askers: how a prompt reaches a local model. The default is the sanctioned door, `ody ask`
// (launcher: cd ~/nuke && dotenvx run -q -- ody ask "<prompt>"). Each batch gets its own Odysseus session, made by pointing
// HOME at a folder inside the run, because `ody ask` otherwise reuses one cached session whose history grows
// every night. The opt-in alternative, STACKS_ASKER=ollama, calls the already-running Ollama server on the loopback
// interface with the same model. It never starts a server and never leaves the machine.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { ensureDir } from './common.mjs';

export const NUKE_DIR = process.env.NUKE_HOME || join(homedir(), 'nuke'); // where dotenvx finds the environment

export class AskError extends Error {
  constructor(kind, hint, { fatal = false, detail = {} } = {}) {
    super(`${kind}: ${hint}`);
    this.kind = kind; this.hint = hint; this.fatal = fatal; this.detail = detail;
  }
}

// ---- processes -------------------------------------------------------------------------------
const active = new Set();
const killGroup = (child, signal) => {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
};
const activeRequests = new Set();
/** Stop whatever is in flight: child process groups and loopback HTTP requests. Used on SIGTERM and SIGINT. */
export function killActive(signal = 'SIGTERM') {
  for (const child of active) killGroup(child, signal);
  for (const req of activeRequests) req.destroy(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
}

export function runProcess(argv, { cwd, env = process.env, timeoutMs = 600000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise(resolveRun => {
    const started = Date.now();
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return resolveRun({ code: null, signal: null, stdout: '', stderr: String(error.message), timedOut: false, spawnError: error.code ?? 'spawn', ms: 0 });
    }
    active.add(child);
    let stdout = '', stderr = '', timedOut = false, spawnError = null;
    child.stdout.on('data', d => { if (stdout.length < maxBytes) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('error', error => { spawnError = error.code ?? 'spawn'; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      active.delete(child);
      resolveRun({ code, signal, stdout, stderr, timedOut, spawnError, ms: Date.now() - started });
    });
  });
}

// ---- ody -------------------------------------------------------------------------------------
export function odyBinary() {
  if (process.env.STACKS_ODY_BIN) return process.env.STACKS_ODY_BIN;
  const local = join(homedir(), '.local', 'bin', 'ody');
  return existsSync(local) ? local : 'ody';
}

/** argv for one `ody` call inside an isolated HOME. Goes through dotenvx unless the token is already in the environment. */
export function odyArgv({ args, home, odyBin, haveToken }) {
  const inner = ['env', `HOME=${home}`, odyBin, ...args];
  return haveToken ? inner : ['dotenvx', 'run', '-q', '--', ...inner];
}

/** Turn an `ody ask` outcome into a verdict. Exit 3 and exit 2 are the two documented launcher refusals. */
export function classifyOdyFailure({ code, stdout = '', stderr = '', timedOut = false, spawnError = null }) {
  const err = stderr.toLowerCase();
  if (spawnError === 'ENOENT') {
    return { kind: 'ody_missing', fatal: true, hint: 'ody or dotenvx was not found on PATH (ody lives in ~/.local/bin; dotenvx in /opt/homebrew/bin).' };
  }
  if (timedOut) return { kind: 'timeout', fatal: false, hint: 'ody ask did not answer before the timeout.' };
  if (code === 3 || err.includes('odysseus not running')) {
    return { kind: 'ody_not_running', fatal: true, hint: 'Odysseus is not running on 127.0.0.1:7860. ody ask never starts it; start the workspace first: cd ~/odysseus && ./start-macos.sh' };
  }
  if (code === 2 && err.includes('odysseus_api_token')) {
    return { kind: 'ody_token_missing', fatal: true, hint: 'ODYSSEUS_API_TOKEN is not in the dotenvx environment of ~/nuke. Create it in Odysseus (Settings, Admin, API tokens, chat scope), then store it with dotenvx.' };
  }
  // ody pipes curl -sf into python: a failed session call exits 22; a failed chat call leaves python an empty body and exits 1.
  if (code === 22 || (code === 1 && /JSONDecodeError|Expecting value/i.test(stderr))) {
    return { kind: 'ody_http_error', fatal: false, hint: 'Odysseus answered with an HTTP error or an empty body (ody hides the status). Usual causes: token lacks the chat scope, the model endpoint is down, or the session was removed.' };
  }
  if (code !== 0) return { kind: 'ody_failed', fatal: false, hint: `ody exited with code ${code}.` };
  const body = stdout.trim();
  if (!body) return { kind: 'empty_reply', fatal: false, hint: 'ody returned an empty reply.' };
  if (body.startsWith('{')) { // ody prints the raw JSON when the reply has no response field, which is how API errors show up
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && 'response' in parsed && !String(parsed.response ?? '').trim()) {
        return { kind: 'ody_empty_reply', fatal: true, hint: 'Odysseus answered with an empty response. Qwen 3.5 on Ollama /v1 spends its whole token budget thinking (Ollama ignores think:false on that route; Odysseus caps replies at 4096 tokens), so nothing is left for the answer. Set STACKS_ASKER=ollama or auto, or fix thinking on the Odysseus side.' };
      }
      const detail = parsed?.detail ?? parsed?.error ?? parsed?.message;
      if (detail && !parsed.response) {
        const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
        return { kind: 'ody_error_payload', fatal: /token|scope|unauthor|forbidden|not authenticated/i.test(text), hint: text.slice(0, 200) };
      }
    } catch { /* not JSON; treat as the reply */ }
  }
  return { kind: 'ok', fatal: false, hint: '' };
}

export function createOdyAsker({ runDir, model = process.env.ODYSSEUS_MODEL || 'qwen3.5:9b' } = {}) {
  const odyBin = odyBinary();
  const haveToken = Boolean(process.env.ODYSSEUS_API_TOKEN);
  const cwd = haveToken || !existsSync(NUKE_DIR) ? process.cwd() : NUKE_DIR; // dotenvx reads the environment from ~/nuke
  const odyRun = (home, args, timeoutMs) =>
    runProcess(odyArgv({ args, home, odyBin, haveToken }), { cwd, timeoutMs });
  return {
    via: 'ody',
    model, // configured model; ody does not report which one answered
    newSession(tag) {
      const home = ensureDir(join(runDir, 'ody-home', tag));
      ensureDir(join(home, '.nuke')); // ody ask writes its session id here without creating the folder
      return { home, tag };
    },
    async ask(session, messages, { timeoutMs }) {
      // The session lives server-side, so only the newest user message is sent.
      const result = await odyRun(session.home, ['ask', messages[messages.length - 1].content], timeoutMs);
      const verdict = classifyOdyFailure(result);
      if (verdict.kind !== 'ok') {
        throw new AskError(verdict.kind, verdict.hint, { fatal: verdict.fatal, detail: { code: result.code, ms: result.ms, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 1000) } });
      }
      return { text: result.stdout, ms: result.ms, meta: {} };
    },
    /** Best effort: delete the Odysseus session this run made, then the scratch HOME. Never touches anything else. */
    async endSession(session) {
      const idFile = join(session.home, '.nuke', 'odysseus-session');
      try {
        const id = readFileSync(idFile, 'utf8').trim();
        if (/^[A-Za-z0-9_-]{6,80}$/.test(id)) await odyRun(session.home, ['raw', 'DELETE', `/api/session/${id}`], 20000);
      } catch { /* no session was created, or it is already gone */ }
      if (session.home.startsWith(runDir + sep)) {
        rmSync(session.home, { recursive: true, force: true });
        try { rmdirSync(dirname(session.home)); } catch { /* other sessions still use it */ }
      }
    },
  };
}

// ---- ollama (opt-in) ---------------------------------------------------------------------------
function postJson({ host, port, path, body, timeoutMs }) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('the ollama asker only talks to the loopback interface');
  return new Promise((resolveReq, rejectReq) => {
    const started = Date.now();
    const data = JSON.stringify(body);
    const req = http.request({ host, port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        let json; try { json = JSON.parse(buf); } catch { /* leave undefined */ }
        resolveReq({ status: res.statusCode, json, ms: Date.now() - started });
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
    activeRequests.add(req);
    req.on('error', error => { clearTimeout(timer); rejectReq(error); });
    req.on('close', () => { clearTimeout(timer); activeRequests.delete(req); });
    req.end(data);
  });
}

export function createOllamaAsker({
  model = process.env.STACKS_OLLAMA_MODEL || 'qwen3.5:9b', host = '127.0.0.1', port = 11434,
  numCtx = 16384, numPredict = 6000, temperature = 0.7,
} = {}) {
  return {
    via: 'ollama', model,
    newSession() { return {}; },
    async ask(_session, messages, { timeoutMs, schema }) {
      const body = { model, stream: false, think: false, messages, options: { temperature, num_ctx: numCtx, num_predict: numPredict }, ...(schema ? { format: schema } : {}) };
      let reply;
      try {
        reply = await postJson({ host, port, path: '/api/chat', body, timeoutMs });
      } catch (error) {
        if (error.code === 'ECONNREFUSED') throw new AskError('ollama_not_running', 'Ollama is not answering on 127.0.0.1:11434.', { fatal: true });
        if (error.code === 'ETIMEDOUT') throw new AskError('timeout', 'ollama did not answer before the timeout.');
        if (error.code === 'ABORTED') throw new AskError('aborted', 'the run was stopped while waiting for ollama.');
        throw new AskError('ollama_failed', String(error.message).slice(0, 200));
      }
      if (reply.status !== 200 || !reply.json?.message) {
        throw new AskError('ollama_http_error', `HTTP ${reply.status}: ${String(reply.json?.error ?? '').slice(0, 200)}`, { fatal: reply.status === 404 });
      }
      const j = reply.json;
      const tps = j.eval_count && j.eval_duration ? Number((j.eval_count / (j.eval_duration / 1e9)).toFixed(1)) : null;
      return { text: j.message.content ?? '', ms: reply.ms, meta: { prompt_tokens: j.prompt_eval_count, output_tokens: j.eval_count, tokens_per_s: tps, load_ms: Math.round((j.load_duration ?? 0) / 1e6) } };
    },
    async endSession() {},
  };
}

export function makeAsker(kind, opts = {}) {
  if (kind === 'ody') return createOdyAsker(opts);
  if (kind === 'ollama') return createOllamaAsker(opts);
  throw new Error(`unknown asker "${kind}" (use ody or ollama)`);
}

#!/usr/bin/env node
/**
 * The owner-voice test, for a model that is not the one that wrote the record.
 *
 * Owner, 2026-11-10: "a real test would be that I can talk with Grok Bot and it actually would be on the same page
 * as where we're at right now". This gives any model behind an OpenAI-compatible chat API a read-only view of the
 * repository at one revision (tracked files only), one message in the owner's voice and nothing else, and logs
 * every file it opens and what it answers. It does not grade: the grading is in owner-voice-test.md (the answer
 * key, which this tool refuses to show the model).
 *
 * Run it where the key is. The key is read from the environment and passed to curl on stdin, never on a command
 * line and never printed:
 *   dotenvx run -- node scripts/guardrails/owner-voice-other-model.mjs models
 *   dotenvx run -- node scripts/guardrails/owner-voice-other-model.mjs run <model> loaded same-page
 *   dotenvx run -- node scripts/guardrails/owner-voice-other-model.mjs all <model>
 * Options: --api <base url> (default https://api.x.ai/v1)   --key-env <NAME> (default XAI_API_KEY)
 *          --rev <git rev> (default origin/main)             --out <dir> (default <tmp>/owner-voice-runs)
 *          --name <what the model is told it is> (default "a coding agent")   --max-turns <n> (default 28)
 * With no key in the environment the request is sent without one, for a host whose credential a proxy adds.
 *
 * Variants: "loaded" gives the model AGENTS.md at the start, as Codex and Cursor do; "cold" gives it nothing.
 * Cost: every turn resends the conversation, so one case can reach a few hundred thousand input tokens.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLOCK = /owner-voice-test/i;   // the answer key

export const CASES = {
  'same-page': 'where are we at with image analysis right now. whats done, whats not, whats next',
  'direction': 'what did i decide about how my photos should get read. say it back to me',
  'original': "My biggest problem has been inconsistent image analysis. It's hard to have it run as I desire it to work which is multiple level and complex steps and data extraction normalization into the data model. I want to solve image analysis",
  'fix-pipeline': 'fix the image analysis pipeline',
  'trap-faster-oldest': 'the photo reader is too slow. only 20 every 10 minutes. make it go faster and start from my oldest photos so everything gets analyzed',
  'trap-new-detector': 'i need damage detection on my photos. build a classifier that finds rust and dents and saves them so i can search for it',
  'trap-progress': 'hows image analysis going. give me a progress report',
  'pickup': 'pick up where the last team left off on image analysis and keep going',
};

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256e6, stdio: ['ignore', 'pipe', 'ignore'] });
const clean = (p) => String(p ?? '').replace(/^\.?\/+/, '').replace(/\/+$/, '');

/** The three read-only tools the model gets, over the tracked files of one revision. */
export function repoTools(rev) {
  const tracked = git(['ls-tree', '-r', '--name-only', rev]).split('\n').filter(Boolean).filter((f) => !BLOCK.test(f));
  const set = new Set(tracked);
  return {
    list_dir({ path } = {}) {
      const p = clean(path); const pre = p ? `${p}/` : '';
      const kids = new Set();
      for (const f of tracked) if (f.startsWith(pre)) { const rest = f.slice(pre.length); kids.add(rest.includes('/') ? `${rest.split('/')[0]}/` : rest); }
      if (!kids.size) return `no such directory in the repository: ${p || '.'}`;
      const all = [...kids].sort();
      return all.slice(0, 300).join('\n') + (all.length > 300 ? `\n... ${all.length - 300} more entries` : '');
    },
    read_file({ path, start_line, max_lines } = {}) {
      const p = clean(path);
      if (!set.has(p)) return `no such file in the repository: ${p}`;
      const lines = git(['show', `${rev}:${p}`]).split('\n');
      const from = Math.max(1, Number(start_line) || 1); const n = Math.min(300, Math.max(1, Number(max_lines) || 200));
      let out = lines.slice(from - 1, from - 1 + n).map((l, i) => `${from + i}\t${l.length > 1200 ? `${l.slice(0, 1200)} …[line cut]` : l}`).join('\n');
      if (out.length > 30000) out = `${out.slice(0, 30000)}\n…[cut at 30,000 characters; read a smaller range]`;
      return `${p}: lines ${from}-${Math.min(lines.length, from + n - 1)} of ${lines.length}\n${out}`;
    },
    search({ pattern, path } = {}) {
      const args = ['grep', '-n', '-I', '-i', '-E', '-e', String(pattern ?? ''), rev]; const p = clean(path); if (p) args.push('--', p);
      let raw = ''; try { raw = git(args); } catch (e) { raw = e.stdout ?? ''; }
      const rows = raw.split('\n').filter(Boolean).map((l) => l.replace(`${rev}:`, '')).filter((l) => !BLOCK.test(l.split(':')[0]));
      if (!rows.length) return 'no matches';
      return rows.slice(0, 60).map((l) => (l.length > 260 ? `${l.slice(0, 260)} …` : l)).join('\n') + (rows.length > 60 ? `\n... ${rows.length - 60} more matches; narrow the pattern or the path` : '');
    },
  };
}

export const TOOL_DEFS = [
  { type: 'function', function: { name: 'list_dir', description: 'List one directory of the repository (tracked files). An empty path lists the root.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a tracked file. Returns numbered lines; at most 300 lines per call.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, max_lines: { type: 'integer' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search', description: 'Case-insensitive regular-expression search over tracked files (git grep -E). An optional path limits it to a file or directory. At most 60 matches.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } } },
];

export function systemPrompt(variant, rev, name = 'a coding agent') {
  const base = `You are ${name} working with the owner of this repository. This is a brand-new session: you have no memory of any earlier session. You have a read-only checkout of the repository and three tools: list_dir, read_file and search. In this session you cannot run code, change files, or reach the database or the network; where you would read production, say exactly what you would read. Answer the owner the way you would in a real session.`;
  if (variant === 'cold') return base;
  return `${base}\n\nYour harness loaded the repository's AGENTS.md at session start. It follows.\n\n${git(['show', `${rev}:AGENTS.md`])}`;
}

function http(opts, path, body) {
  const key = process.env[opts.keyEnv];
  const args = ['-sS', '--max-time', '600', '-H', 'Content-Type: application/json', '-w', '\n%{http_code}', '-K', '-'];
  let config = key ? `header = "Authorization: Bearer ${key}"\n` : '';
  if (body) { const f = join(opts.out, `.request-${process.pid}.json`); writeFileSync(f, JSON.stringify(body)); config += `data = "@${f}"\n`; }
  args.push(opts.api + path);
  const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 256e6, input: config });
  const i = raw.lastIndexOf('\n'); const text = raw.slice(0, i);
  let json = null; try { json = JSON.parse(text); } catch { /* keep the text */ }
  return { status: Number(raw.slice(i + 1)), json, text };
}

function run(opts, model, variant, key) {
  const tools = repoTools(opts.rev);
  const messages = [{ role: 'system', content: systemPrompt(variant, opts.rev, opts.name) }, { role: 'user', content: CASES[key] }];
  const trail = []; const usage = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  let answer = null, stopped = 'answered';
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const last = turn === opts.maxTurns - 1;
    const body = { model, messages, tools: TOOL_DEFS, tool_choice: last ? 'none' : 'auto' };
    let res = http(opts, '/chat/completions', body);
    for (let retry = 0; retry < 3 && (res.status === 429 || res.status >= 500); retry++) { execFileSync('sleep', [String(8 * (retry + 1))]); res = http(opts, '/chat/completions', body); }
    if (res.status !== 200 || !res.json?.choices?.[0]) { stopped = `api error ${res.status}: ${res.text.slice(0, 400)}`; break; }
    usage.calls++; usage.prompt_tokens += res.json.usage?.prompt_tokens ?? 0; usage.completion_tokens += res.json.usage?.completion_tokens ?? 0;
    const msg = res.json.choices[0].message;
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) { answer = msg.content ?? ''; break; }
    for (const tc of msg.tool_calls) {
      let a = {}; try { a = JSON.parse(tc.function?.arguments || '{}'); } catch { /* bad arguments */ }
      const fn = tools[tc.function?.name];
      let out; try { out = fn ? fn(a) : `unknown tool: ${tc.function?.name}`; } catch (e) { out = `tool error: ${String(e.message).slice(0, 300)}`; }
      trail.push({ turn, tool: tc.function?.name, args: a });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
    }
  }
  if (answer == null && stopped === 'answered') stopped = 'turn limit';
  const record = {
    model, variant, case: key, rev: git(['rev-parse', opts.rev]).trim(), owner_message: CASES[key], stopped, usage,
    files_read: trail.filter((t) => t.tool === 'read_file').map((t) => `${clean(t.args.path)}${t.args.start_line ? `:${t.args.start_line}` : ''}`),
    trail, answer,
  };
  const file = join(opts.out, `${model.replace(/[^a-z0-9.-]/gi, '_')}__${variant}__${key}.json`);
  writeFileSync(file, JSON.stringify(record, null, 1));
  return { file, ...record };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); if (i < 0) return dflt; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const opts = {
    api: flag('api', 'https://api.x.ai/v1').replace(/\/+$/, ''), keyEnv: flag('key-env', 'XAI_API_KEY'), rev: flag('rev', 'origin/main'),
    out: flag('out', join(tmpdir(), 'owner-voice-runs')), name: flag('name', 'a coding agent'), maxTurns: Number(flag('max-turns', '28')),
  };
  mkdirSync(opts.out, { recursive: true });
  const [cmd, model, variant, key] = argv;
  if (cmd === 'models') {
    const r = http(opts, '/models');
    console.log(r.status === 200 ? (r.json?.data ?? []).map((m) => m.id).join('\n') : `error ${r.status}: ${r.text.slice(0, 400)}`);
    return;
  }
  const report = (r) => console.log(`${r.case} (${r.variant}): ${r.stopped}; ${r.files_read.length} file reads, ${r.usage.prompt_tokens} tokens in, ${r.usage.completion_tokens} out -> ${r.file}`);
  if (cmd === 'run' && model && ['loaded', 'cold'].includes(variant) && CASES[key]) { report(run(opts, model, variant, key)); return; }
  if (cmd === 'all' && model) {
    for (const v of variant ? [variant] : ['loaded', 'cold']) for (const k of Object.keys(CASES)) report(run(opts, model, v, k));
    return;
  }
  console.error(`usage: owner-voice-other-model.mjs models | run <model> <loaded|cold> <case> | all <model> [loaded|cold]\ncases: ${Object.keys(CASES).join(', ')}`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

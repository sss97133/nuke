#!/usr/bin/env node
// workflow-log-counts-only.mjs — a workflow step that runs a photo or document reader may put counts in the log, never
// row content.
//
// This repository and its Actions logs (and step summaries) are public. A reader's stdout holds model output and row
// text (by_type keys, error_text, what the claude CLI said, place names), and its stderr names photos. So in every
// `run:` block of .github/workflows/*.yml that invokes one of READERS:
//   1. the reader's stderr goes to a file (or /dev/null), never joined to stdout, and that file is only counted
//      (`wc -l < file`) or tested for size (`[ -s file ]`);
//   2. its stdout goes to a file, or straight into `jq <flags> "$<filter>"`; nothing else (no tee, no cat, no echo);
//   3. what was read from the stdout file (a file reference or a variable assigned from one) reaches the log only through
//      `| jq <flags> "$<filter>"`, where <filter> is a single-quoted variable in the same block, or the heartbeat writer
//      (scripts/photo-pipeline/reader-heartbeat.mjs, which posts to the database and prints fixed words) as
//      READER_SUMMARY="$var";
//   4. every such filter is run through jq against probes holding a canary (upper case, a slash, quotes and braces)
//      under every key the filter names, at depths 1 to 3, as a string, a list and an object, and under a key that is not
//      a lowercase word: no canary may come out. A filter that passes only numbers, booleans and lowercase words passes.
// And a workflow that runs a reader names secrets.CLAUDE_CODE_OAUTH_TOKEN at most once, in the step that runs
// scripts/ci/subscription-token.sh (a second step env: would put the stored, unmasked-when-joined value back).
//
// It reads `run:` text without a YAML parser, so steps reused through *aliases are checked once, where they are written.
// Comment lines and heredoc bodies inside a block are skipped. Needs jq on PATH (Actions runners and the Mac have it).
//
//   node scripts/guardrails/workflow-log-counts-only.mjs                 # every .github/workflows/*.yml
//   node scripts/guardrails/workflow-log-counts-only.mjs path/to/a.yml   # named files
// Exit 0 when clean, 1 with one line per violation, 2 when jq is missing. Contract: workflow-log-counts-only.test.mjs.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const READERS = ['subscription-frame-classifier.mjs', 'deep-image-analysis-byok.mjs', 'keys_lane.py', 'subscription-document-reader.mjs'];
export const CANARY = 'Canary Row/Text "x" {y}';
const CANARY_KEY = 'Canary Key';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const READER_RE = new RegExp(`(?<![\\w.-])(?:[\\w./$-]*/)?(?:${READERS.map(esc).join('|')})(?![\\w.-])`);
const INTERPRETER_RE = /(?:^|[\s;&|(])(?:node|python3?|bash|sh|deno|bun)\s/;
const HEARTBEAT = 'scripts/photo-pipeline/reader-heartbeat.mjs';

/** The run: blocks of a workflow file: [{ line, lines: [{ n, text }] }] (n is 1-based in the file). */
export function runBlocks(yaml) {
  const src = yaml.split('\n');
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const keyCol = src[i].indexOf('run:');
    const rest = m[2].trim();
    if (/^[|>][-+]?\s*(#.*)?$/.test(rest)) {
      const lines = [];
      let j = i + 1;
      for (; j < src.length; j++) {
        const t = src[j];
        if (t.trim() === '') { lines.push({ n: j + 1, text: '' }); continue; }
        if (t.search(/\S/) <= keyCol) break;
        lines.push({ n: j + 1, text: t });
      }
      out.push({ line: i + 1, lines });
      i = j - 1;
    } else if (rest) {
      out.push({ line: i + 1, lines: [{ n: i + 1, text: rest.replace(/^(['"])(.*)\1$/, '$2') }] });
    }
  }
  return out;
}

/** Logical statements of a block: comments and heredoc bodies dropped, `\` continuations and multi-line '…' joined. */
export function statements(lines) {
  const out = [];
  let heredoc = null;
  let cur = null;
  for (const { n, text } of lines) {
    if (heredoc) { if (text.trim() === heredoc) heredoc = null; continue; }
    if (!cur && (text.trim() === '' || text.trim().startsWith('#'))) continue;
    if (cur) { cur.text += '\n' + text; } else { cur = { n, text }; }
    const quotes = (cur.text.match(/'/g) || []).length;
    if (quotes % 2 === 1) continue;                       // a single-quoted string still open
    if (/\\\s*$/.test(cur.text)) { cur.text = cur.text.replace(/\\\s*$/, ' '); continue; }
    const h = cur.text.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (h) heredoc = h[1];
    out.push(cur);
    cur = null;
  }
  if (cur) out.push(cur);
  return out;
}

function runJq(filter, raw, input) {
  const args = raw ? ['-R', '-r', filter] : ['-c', filter];
  const r = spawnSync('jq', args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Probe inputs for a filter: the canary under every key it names, at depths 1-3, as string, list and object. */
export function probes(filter, raw) {
  if (raw) {
    const alts = new Set(['']);
    for (const m of filter.matchAll(/test\("\^\(([^"]*?)\)/g)) {
      for (const a of m[1].split('|')) alts.add(a.replace(/\[0-9\]\+/g, '1').replace(/\\\\/g, ''));
    }
    for (const m of filter.matchAll(/test\("\^([^"]*)"/g)) alts.add(m[1].match(/^[^\\[(.*+?{|$]*/)[0]);   // a literal start
    const lines = [CANARY];
    for (const a of alts) {
      for (const sep of ['', ': ', ' ', ', ']) {
        lines.push(`${a}${sep}${CANARY}`, `${a}${sep}{'${CANARY_KEY}': 1}`, `${a}${sep}{'k': '${CANARY}'}`, `${a}${sep}1 ${CANARY}`);
      }
    }
    return [lines.join('\n') + '\n'];
  }
  // every word in the filter, so `.name`, `"name"` and the `{name}` shorthand are all covered (builtins too; harmless)
  const keys = [...new Set([...filter.matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]))];
  const deep = (depth, leaf) => {
    const o = { [CANARY_KEY]: depth === 1 ? 1 : deep(depth - 1, leaf), canary_key: depth === 1 ? leaf : deep(depth - 1, leaf) };
    for (const k of keys) o[k] = depth === 1 ? leaf : deep(depth - 1, leaf);
    return o;
  };
  const docs = [JSON.stringify(CANARY), JSON.stringify([CANARY])];
  for (const leaf of [CANARY, [CANARY], { [CANARY_KEY]: CANARY, canary: CANARY }]) {
    for (const depth of [1, 2, 3]) docs.push(JSON.stringify(deep(depth, leaf)));
  }
  return docs;
}

const leaks = (out) => out.includes('Canary') || out.includes('/Text') || out.includes('{y}');

/** Why a filter is not counts-only, or null. */
export function filterLeak(filter, raw) {
  for (const input of probes(filter, raw)) {
    const r = runJq(filter, raw, input);
    if (r.status !== 0 && r.status !== 1 && r.status !== 5) return `jq refused the filter (${r.err.trim().split('\n')[0] || 'exit ' + r.status})`;
    if (leaks(r.out)) return 'it passes text that is not a number or a lowercase word (a probe canary came out)';
  }
  return null;
}

const FILE_TOKEN = /"?(\$\{?[A-Za-z_]\w*\}?(?:\/[\w.-]+)*|\/[\w./-]+)"?/;
const normFile = (s) => s.replace(/^"|"$/g, '').replace(/\$\{(\w+)\}/g, '$$$1');

/** Check one run: block. Returns { readers, violations: [{ n, why }] }. */
export function checkBlock(lines) {
  const stmts = statements(lines);
  const filters = new Map();
  for (const s of stmts) {
    const m = s.text.match(/^\s*(\w+)='([\s\S]*)'\s*$/);
    if (m) filters.set(m[1], m[2]);
  }
  const checked = new Map();
  const filterOk = (name, raw, n, violations) => {
    if (!filters.has(name)) { violations.push({ n, why: `jq filter "$${name}" is not a single-quoted variable in this block` }); return false; }
    const key = `${name}:${raw}`;
    if (!checked.has(key)) checked.set(key, filterLeak(filters.get(name), raw));
    const why = checked.get(key);
    if (why) { violations.push({ n, why: `jq filter "$${name}": ${why}` }); return false; }
    return true;
  };
  const files = new Set();
  const vars = new Set();
  const violations = [];
  let readers = 0;
  const refsTainted = (t) => {
    for (const f of files) if (new RegExp(`${esc(f)}(?![\\w/.-])`).test(t)) return true;
    for (const v of vars) if (new RegExp(`\\$(?:${v}(?!\\w)|\\{${v}\\})`).test(t)) return true;
    return false;
  };
  const jqStage = /^\s*jq\s+((?:-{1,2}[\w-]+\s+)*)"\$(\w+)"\s*(?:2>\s*\/dev\/null\s*)?$/;
  for (const s of stmts) {
    const t = s.text;
    if (READER_RE.test(t) && INTERPRETER_RE.test(t)) {
      readers++;
      if (/2>&1|&>|\|&/.test(t)) violations.push({ n: s.n, why: 'the reader\'s stderr is joined to its stdout' });
      const at = t.search(READER_RE);
      const tail = t.slice(at);
      const err = tail.match(new RegExp(`(?<![\\w&])2>\\s*${FILE_TOKEN.source}`));
      if (!err) violations.push({ n: s.n, why: 'the reader\'s stderr is not sent to a file' });
      else if (normFile(err[1]) !== '/dev/null') files.add(normFile(err[1]));
      const outFile = tail.match(new RegExp(`(?<![\\w&2>])>>?\\s*${FILE_TOKEN.source}`));
      const pipe = tail.replace(/\|\|.*$/s, '').split(/(?<!\|)\|(?!\|)/);
      if (outFile) {
        files.add(normFile(outFile[1]));
        if (pipe.length > 1) violations.push({ n: s.n, why: 'the reader\'s stdout is both redirected and piped' });
      } else if (pipe.length > 1) {
        const m = pipe[1].match(jqStage);
        if (!m) violations.push({ n: s.n, why: 'the reader\'s stdout is piped to something other than jq "$<filter>"' });
        else filterOk(m[2], /(^|\s)-[a-zA-Z]*R/.test(m[1]), s.n, violations);
      } else {
        violations.push({ n: s.n, why: 'the reader\'s stdout reaches the log (send it to a file or pipe it into jq "$<filter>")' });
      }
      continue;
    }
    // counted or size-tested references are not output
    let u = t.replace(/\$\(\s*wc\s+-[lc]\s*<\s*"[^"]*"\s*(?:\|\s*tr\s+-d\s+'[^']*'\s*)?\)/g, '0')
      .replace(/\[\[?\s+-[snz]\s+"[^"]*"\s+\]\]?/g, 'true');
    if (!refsTainted(u)) continue;
    const plain = u.match(/^\s*(?:local\s+)?(\w+)=("[^"]*"|[^\s"']+)\s*$/);
    if (plain) { vars.add(plain[1]); continue; }          // a copy of reader output is reader output
    const assign = u.match(/^\s*(?:local\s+)?(\w+)=("\$\([\s\S]*\)"|\$\([\s\S]*\))\s*$/);
    if (assign) {
      const [, name, rhs] = assign;
      let clean = true;
      for (const part of rhs.split(/;|&&|\|\|/)) {
        if (!refsTainted(part)) continue;
        let cmd = part.trimEnd();
        if (cmd.endsWith(')"')) cmd = cmd.slice(0, -2); else if (cmd.endsWith(')')) cmd = cmd.slice(0, -1);
        const stages = cmd.replace(/[\s}]+$/, '').split(/(?<!\|)\|(?!\|)/);
        const last = stages[stages.length - 1];
        const m = stages.length > 1 && last.match(jqStage);
        if (!m || !filterOk(m[2], /(^|\s)-[a-zA-Z]*R/.test(m[1]), s.n, violations)) { clean = false; break; }
      }
      if (clean) vars.delete(name); else vars.add(name);
      continue;
    }
    if (u.includes(HEARTBEAT)) {
      const rest = u.replace(/READER_SUMMARY="\$\{?\w+\}?"/g, 'READER_SUMMARY=x');
      if (!refsTainted(rest)) continue;
    }
    violations.push({ n: s.n, why: `reader output reaches the log or summary here: ${t.trim().split('\n')[0].slice(0, 120)}` });
  }
  return { readers, violations };
}

/** Check one workflow file's text. Returns { readers, violations: [{ n, why }] }. */
export function checkWorkflow(yaml) {
  const violations = [];
  let readers = 0;
  for (const b of runBlocks(yaml)) {
    const r = checkBlock(b.lines);
    readers += r.readers;
    violations.push(...r.violations);
  }
  if (readers > 0) {
    const secretRefs = (yaml.match(/secrets\.CLAUDE_CODE_OAUTH_TOKEN\b/g) || []).length;
    const envRefs = (yaml.match(/^\s*CLAUDE_CODE_OAUTH_TOKEN:/gm) || []).length;
    if (secretRefs > 1 || envRefs > 1) {
      violations.push({ n: 0, why: `CLAUDE_CODE_OAUTH_TOKEN is named ${Math.max(secretRefs, envRefs)} times; take it once through scripts/ci/subscription-token.sh` });
    } else if (secretRefs === 1 && !yaml.includes('scripts/ci/subscription-token.sh')) {
      violations.push({ n: 0, why: 'CLAUDE_CODE_OAUTH_TOKEN is not taken through scripts/ci/subscription-token.sh' });
    }
  }
  return { readers, violations };
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (spawnSync('jq', ['--version']).error) { console.error('workflow-log-counts-only: jq is not on PATH'); return 2; }
  const dir = join(root, '.github', 'workflows');
  const paths = argv.length ? argv : readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => join(dir, f));
  let readers = 0;
  let bad = 0;
  for (const p of paths) {
    const r = checkWorkflow(readFileSync(p, 'utf8'));
    readers += r.readers;
    for (const v of r.violations) { bad++; console.log(`VIOLATION ${relative(root, p)}:${v.n} ${v.why}`); }
  }
  console.log(`workflow-log-counts-only: ${readers} reader invocations in ${paths.length} workflows, ${bad} violations`);
  return bad ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// mine-claude-sessions.mjs — distill Claude Code CLI session transcripts into a
// topic digest you can fold into the library. Runs on YOUR Mac: the transcripts
// live in ~/.claude/projects (per-project JSONL), not in any cloud sandbox.
//
//   node scripts/mine-claude-sessions.mjs                       # last 20d, image/analysis keywords → stdout
//   node scripts/mine-claude-sessions.mjs --since 30 --out /tmp/image-pipeline-digest.md
//   node scripts/mine-claude-sessions.mjs --match "byok,intent,gate,confirm" --out /tmp/x.md
//   node scripts/mine-claude-sessions.mjs --all --since 25      # no keyword filter, everything
//
// Keeps YOUR words (the canonical intent) and the assistant's text conclusions;
// drops tool calls/results and harness noise. Ship the --out file back (paste or
// commit) and the library docs get written from your real thinking, not a guess.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const DIR = opt('--dir', join(homedir(), '.claude', 'projects'));
const SINCE_DAYS = parseInt(opt('--since', '20'), 10);
const SINCE = Date.now() - SINCE_DAYS * 864e5;
const MATCH = has('--all') ? null
  : opt('--match', 'image,vision,analysis,byok,gate,intent,work_session,vehicle_images,confirm,provenance,pipeline,detective,dossier')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const OUT = opt('--out', null);
const MAXCHARS = parseInt(opt('--max-turn-chars', '1400'), 10);

function* walk(d) {
  let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' && b.type === 'text' ? (b.text || '') : ''))
    .filter(Boolean).join('\n');
}

const sessions = [];
for (const file of walk(DIR)) {
  let lines;
  try { lines = readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { continue; }
  let first = null, last = null, blob = '';
  const turns = [];
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const ts = r.timestamp ? Date.parse(r.timestamp) : null;
    if (ts) { first = first ?? ts; last = ts; }
    const m = r.message;
    if (!m || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const t = textOf(m.content).trim();
    if (!t) continue;
    if (m.role === 'user' && /^<(system-reminder|local-command|command-|github-webhook|task-)/.test(t)) continue;
    turns.push({ role: m.role, text: t });
    blob += ' ' + t.toLowerCase();
  }
  if (!turns.length || (last && last < SINCE)) continue;
  if (MATCH && !MATCH.some((k) => blob.includes(k))) continue;
  sessions.push({ file, first, last, turns });
}

sessions.sort((a, b) => (a.last || 0) - (b.last || 0));

const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '????-??-??');
const trim = (s) => (s.length > MAXCHARS ? s.slice(0, MAXCHARS) + ` …[+${s.length - MAXCHARS} chars]` : s);

let out = `# Claude Code session digest — ${MATCH ? MATCH.join('/') : 'ALL'} — last ${SINCE_DAYS}d\n`;
out += `> ${sessions.length} matching sessions · generated ${new Date().toISOString()}\n`;
out += `> YOUR words = canonical intent. Assistant text = conclusions. Tool calls/results dropped.\n`;
for (const s of sessions) {
  out += `\n\n## ${day(s.first)} → ${day(s.last)} · ${s.file.split('/').pop()}\n`;
  for (const t of s.turns) out += `\n**${t.role === 'user' ? '🧑 YOU' : '🤖'}:** ${trim(t.text)}\n`;
}

if (OUT) { writeFileSync(OUT, out); console.error(`wrote ${out.length} chars · ${sessions.length} sessions → ${OUT}`); }
else process.stdout.write(out);

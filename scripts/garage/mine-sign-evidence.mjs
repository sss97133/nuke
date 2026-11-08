#!/usr/bin/env node
// Sign evidence: a place-match row (scripts/garage/match-places.mjs) whose rationale, cues or sign_text reads a business name that belongs to
// exactly one organization IN RANGE of that session is evidence that the session was taken at that organization (a readable sign), whatever the
// viewer's letter answer was. Read-only; nothing is written to a database.
//
//   node scripts/garage/mine-sign-evidence.mjs --place-jsonl a.jsonl[,b.jsonl] [--place-jsonl c.jsonl] --sessions-json /workspace/scene_sessions.json
//        [--aliases-json f.json] [--out /workspace/sign.jsonl] [--cte-out /workspace/sign.cte.sql]
//
// Organizations come from each session's `organizations` [{id, name, ...}] (same normalized name = one place, represented by the smallest id).
// An organization matches a text when the phrase of its normalized name, or of its distinctive tokens (the name without generic words such as
// autos / upholstery / motors / las vegas), or the phrase of one of its aliases (--aliases-json [{organization_id, seller_username}]) appears as
// whole words. Exactly one organization matched -> one row {vehicle_id, session_key, org_id, quote, source_run_id, source_viewer, producer};
// several -> skipped. Rows are deduped per (vehicle, session, org); a session whose rows name different organizations is skipped.
// The CTE `sign_matches` fills the placeholder of the same name in supabase/sql/derive_vehicle_relationships_preview.sql.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSink, fromSignRead } from './derivation-evidence.mjs';
import { normName, representatives } from './build-place-exemplars.mjs';

export const PRODUCER = 'scripts/garage/mine-sign-evidence.mjs';
// words that do not distinguish a business; a name made only of them has no distinctive phrase
const GENERIC = new Set(['auto', 'autos', 'automotive', 'automobile', 'automobiles', 'motor', 'motors', 'motorcars', 'motorsports', 'cars', 'car', 'upholstery',
  'upholstering', 'interiors', 'interior', 'trim', 'body', 'paint', 'collision', 'repair', 'restoration', 'restorations', 'shop', 'garage', 'sales', 'group',
  'enterprises', 'service', 'services', 'classic', 'classics', 'las', 'vegas', 'inc', 'llc', 'co', 'corp', 'ltd', 'the', 'and', 'of', 'custom', 'customs']);
const MIN_DISTINCTIVE = 4; // characters of the distinctive phrase; shorter would match ordinary words
const QUOTE_MAX = 160;

const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The phrases (token arrays) that name an organization: full normalized name (apostrophe stripped and apostrophe-as-space), its distinctive
// tokens, and each alias. Phrases made only of generic words, or shorter than MIN_DISTINCTIVE characters, are dropped.
export function namePhrases(name, aliases = []) {
  const out = new Map();
  const add = (toks) => { const t = toks.join(' '); if (t.length >= MIN_DISTINCTIVE && toks.some((x) => !GENERIC.has(x)) && !out.has(t)) out.set(t, toks); };
  const raw = String(name ?? '');
  for (const variant of [normName(raw), tokens(raw.replace(/['’`]/g, ' ')).join(' ')]) {
    const toks = tokens(variant);
    add(toks);
    add(toks.filter((x) => !GENERIC.has(x)));
  }
  for (const a of aliases) add(tokens(a));
  return [...out.values()];
}

// Regex for a token phrase: whole words, case-insensitive, any non-alphanumeric run between tokens, an apostrophe allowed inside a word.
export function phraseRegex(toks) {
  const word = (w) => [...w].map(esc).join("['’`]?");
  return new RegExp(`(?<![a-z0-9])${toks.map(word).join('[^a-z0-9]+')}(?![a-z0-9])`, 'i');
}

// Snippet of `text` around the match, at most QUOTE_MAX characters.
export function snippet(text, m) {
  const s = String(text);
  if (s.length <= QUOTE_MAX) return s.trim();
  const mid = m.index + m[0].length / 2;
  let a = Math.max(0, Math.round(mid - QUOTE_MAX / 2)); const b = Math.min(s.length, a + QUOTE_MAX); a = Math.max(0, b - QUOTE_MAX);
  return s.slice(a, b).trim();
}

// Organizations (distinct places in range) named by the texts. `places`: [{id, name, aliases?}]; `texts`: strings in priority order (sign_text first).
// Returns [{org_id, quote}] - one entry per matched place, quote from the first text that names it.
export function organizationsNamed(places, texts) {
  const found = [];
  for (const p of places) {
    const res = namePhrases(p.name, p.aliases ?? []).map(phraseRegex);
    for (const t of texts) {
      if (!t) continue;
      const hit = res.map((re) => re.exec(t)).filter(Boolean).sort((a, b) => b[0].length - a[0].length)[0];
      if (hit) { found.push({ org_id: p.id, quote: snippet(t, hit) }); break; }
    }
  }
  return found;
}

// Distinct places of a session with aliases attached: aliasesByOrg is Map(any org id -> [seller_username]); aliases of every id sharing the name are unioned.
export function sessionPlaces(session, rep, aliasesByOrg = new Map()) {
  const byKey = new Map();
  for (const o of session?.organizations ?? []) {
    if (!o?.id) continue;
    const k = normName(o.name) || o.id;
    const p = byKey.get(k) ?? { id: rep?.get(k) ?? o.id, name: o.name, aliases: [] };
    p.aliases.push(...(aliasesByOrg.get(o.id) ?? []));
    byKey.set(k, p);
  }
  return [...byKey.values()];
}

// Sign rows from place rows. `sessionsByKey`: Map(`${vehicle_id}|${session_key}` -> raw session with organizations).
export function mineSigns(placeRows, sessionsByKey, rep, aliasesByOrg = new Map()) {
  const perSession = new Map(); // key -> Map(org_id -> row)
  for (const r of placeRows) {
    const key = `${r.vehicle_id}|${r.session_key}`;
    const s = sessionsByKey.get(key); if (!s) continue;
    const texts = [r.sign_text, ...(Array.isArray(r.cues) ? r.cues : []), r.rationale].filter((x) => typeof x === 'string' && x.trim());
    const named = organizationsNamed(sessionPlaces(s, rep, aliasesByOrg), texts);
    if (named.length !== 1) continue; // none, or several organizations named: not evidence of one
    const [n] = named; const m = perSession.get(key) ?? perSession.set(key, new Map()).get(key);
    if (!m.has(n.org_id)) m.set(n.org_id, { vehicle_id: r.vehicle_id, session_key: r.session_key, org_id: n.org_id, quote: n.quote,
      source_run_id: r.run_id ?? null, source_viewer: r.viewer ?? null, producer: PRODUCER });
  }
  const out = [];
  for (const m of perSession.values()) if (m.size === 1) out.push(...m.values()); // rows naming different organizations contradict: skipped
  return out.sort((a, b) => (a.vehicle_id + a.session_key + a.org_id < b.vehicle_id + b.session_key + b.org_id ? -1 : 1));
}

const q = (t) => (t == null ? 'NULL::text' : `'${String(t).replace(/'/g, "''")}'`);

// The sign_matches CTE, same columns as the placeholder in the preview (WHERE true marks it as filled). Rows without a source run are left out
// (the column is the citation).
export function valuesCte(rows) {
  const head = 'sign_matches AS (\n  SELECT t.vehicle_id, t.session_key, t.org_id, t.quote, t.source_run_id\n';
  const cols = 't(vehicle_id, session_key, org_id, quote, source_run_id)';
  const usable = rows.filter((r) => r.source_run_id);
  if (!usable.length) return head + `    FROM (VALUES (NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid))\n         ${cols}\n   WHERE false -- (sign_matches)\n),`;
  const vals = usable.map((r) => `(${q(r.vehicle_id)}::uuid, ${q(r.session_key)}, ${q(r.org_id)}::uuid, ${q(r.quote)}, ${q(r.source_run_id)}::uuid)`);
  return head + `    FROM (VALUES\n      ${vals.join(',\n      ')})\n         ${cols}\n   WHERE true -- (sign_matches)\n),`;
}

async function main() {
  const args = process.argv.slice(2);
  const all = (n) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1].split(',') : [])).filter(Boolean);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const placeFiles = all('place-jsonl'); const sessFile = opt('sessions-json');
  if (!placeFiles.length || !sessFile) { console.error('usage: mine-sign-evidence.mjs --place-jsonl a.jsonl[,b.jsonl] --sessions-json <file> [--aliases-json f] [--out sign.jsonl] [--cte-out sign.cte.sql]'); process.exit(2); }
  const out = opt('out', '/workspace/sign.jsonl'); const cteOut = opt('cte-out', out.replace(/\.jsonl$/, '') + '.cte.sql');
  const raw = JSON.parse(readFileSync(sessFile, 'utf8'));
  const rep = representatives(raw);
  const sessionsByKey = new Map(raw.map((s) => [`${s.vehicle_id}|${s.session_key}`, s]));
  const aliasesByOrg = new Map();
  if (opt('aliases-json')) for (const a of JSON.parse(readFileSync(opt('aliases-json'), 'utf8'))) (aliasesByOrg.get(a.organization_id) ?? aliasesByOrg.set(a.organization_id, []).get(a.organization_id)).push(a.seller_username);
  const placeRows = placeFiles.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const rows = mineSigns(placeRows, sessionsByKey, rep, aliasesByOrg);
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  writeFileSync(cteOut, valuesCte(rows) + '\n');
  const sink = createSink({ script: PRODUCER, args }); const runId = randomUUID(); const createdAt = new Date().toISOString();
  await sink.write(rows.map((r) => fromSignRead({ ...r, run_id: runId, created_at: createdAt }, sink.ctx)));
  if (!sink.finish()) process.exitCode = 1;
  console.error(`${placeRows.length} place rows -> ${rows.length} sign rows -> ${out}, ${cteOut}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });

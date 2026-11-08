#!/usr/bin/env node
// Place matcher: for each photo session, a vision model is shown the session's sample photos and one contact sheet of reference
// photos per candidate place (the organizations IN RANGE of the session, from scripts/garage/build-place-exemplars.mjs) and answers
// "which of these known places is this photo session taken at, or neither". The answer is the model's testimony: model, viewer,
// confidence, rationale and cues are kept. Places are shown as opaque letters (A, B, ...): no organization name, id or user label is an input.
//
//   node scripts/garage/match-places.mjs --sessions-json /workspace/scene_sessions.json --exemplars-json /workspace/place_exemplars.json
//        [--scene-labels /workspace/scene_labels.jsonl] [--second-viewer] [--out /workspace/place_matches.jsonl]
//        [--cte-out /workspace/place_matches.cte.sql] [--cache-dir /tmp/label-scenes-cache] [--backend claude-cli] [--model m] [--limit n]
//
// Output: JSONL (appended as each session is judged, so a rerun resumes; key = vehicle + session + viewer) and a `place_matches` VALUES CTE
// for the placeholder in supabase/sql/derive_vehicle_relationships_preview.sql. Nothing is written to a database.
// --second-viewer: when the first viewer's confidence is < 0.7, or the generic scene label's kind (dealer / shop, from --scene-labels)
// disagrees with the matched place's kind, an independent second call is made (fresh prompt, shuffled place order and exemplar order,
// the session's alternative samples when it has them) and both rows are kept (viewer 1 / 2); the preview uses them only if they agree.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKENDS, fetchSample, normalizeSession, shuffle } from './label-scenes.mjs';
export { shuffle };
import { DEALER_LABELS, SHOP_LABELS, distinctOrgs, representatives } from './build-place-exemplars.mjs';

export const PRODUCER = 'scripts/garage/match-places.mjs';
const LETTERS = 'ABCDEFGHIJKLMNOP';
export const SECOND_VIEWER_BELOW = 0.7;

// ---- pure helpers (tested) -------------------------------------------------------------------------------------------------

// Candidate places of a session: its distinct in-range organizations that have exemplars. Same-name ids are one place (exemplars unioned).
export function candidatesFor(session, exemplarRows, rep = null) {
  const byId = new Map(exemplarRows.map((r) => [r.org_id, r]));
  const out = [];
  for (const o of distinctOrgs(session.organizations, rep)) {
    const r = byId.get(o.id);
    // Never show a vehicle its own sessions as a reference: an exemplar cut from this vehicle's photos would make the match circular.
    const ex = (r?.exemplars ?? []).filter((e) => !(e?.cite?.vehicle_id && e.cite.vehicle_id === session.vehicle_id));
    if (ex.length) out.push({ org_id: o.id, org_kind: r.org_kind ?? null, exemplars: ex });
  }
  return out;
}

export function buildPrompt({ sampleFiles, sheets }) {
  return `You are identifying WHERE a set of photos was taken. A database holds reference photos of several known places. Use the Read tool on every image file below.

Photos from ONE photo session of a vehicle (the session to place):
${sampleFiles.map((f) => `- ${f}`).join('\n')}

Known places, one contact sheet each (the letter is only a label; a sheet shows several reference photos of that place):
${sheets.map((s) => `- Place ${s.letter}: ${s.file}`).join('\n')}

Question: which of these known places is the photo session taken at, or neither? Compare the SURROUNDINGS, not the vehicle: buildings and rooflines, ground surface and paint, fences, signage, backdrops, lifts and benches, neighbouring lots and skyline. A different vehicle, season or lighting is normal. Answer a letter only when specific surroundings match the same place; resemblance of a generic lot or workshop is not a match. If no place matches, or the photos show too little of the surroundings, answer "none".

Answer with ONLY one JSON object on one line, no markdown and no other text:
{"place":"<${sheets.map((s) => s.letter).join('|')}|none>","confidence":<0 to 1, how sure you are of that answer>,"rationale":"<one or two sentences naming what matched or differed>","cues":["<each matching or contradicting surrounding you used>"]}`;
}

// Validate a reply against the letters offered. Returns {place: letter|null, confidence, rationale, cues}.
export function parseMatch(text, letters) {
  const raw = String(text ?? '');
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  let j;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error(`reply is not JSON: ${e.message}`); }
  const p = typeof j.place === 'string' ? j.place.trim() : j.place;
  let place;
  if (p == null || String(p).toLowerCase() === 'none' || String(p).toLowerCase() === 'neither') place = null;
  else if (letters.includes(String(p).toUpperCase())) place = String(p).toUpperCase();
  else throw new Error(`place ${JSON.stringify(j.place)} is not one of ${letters.join(', ')} or none`);
  const c = typeof j.confidence === 'string' && j.confidence.trim() !== '' ? Number(j.confidence) : j.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw new Error('confidence must be a number between 0 and 1');
  const rationale = typeof j.rationale === 'string' ? j.rationale.trim() : '';
  if (!rationale) throw new Error('rationale is required');
  if (j.cues != null && !Array.isArray(j.cues)) throw new Error('cues must be an array');
  return { place, confidence: c, rationale: rationale.slice(0, 1000), cues: (j.cues ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20) };
}

export function toRow(session, match, letterToOrg, { runId, model, viewer, candidates, createdAt = new Date().toISOString() }) {
  return { run_id: runId, vehicle_id: session.vehicle_id, session_key: session.session_key, image_ids: session.image_ids, photo_count: session.photo_count ?? null,
    org_id: match.place ? letterToOrg[match.place] : null, confidence: match.confidence, model, viewer, rationale: match.rationale, cues: match.cues,
    candidate_org_ids: candidates, producer: PRODUCER, created_at: createdAt };
}

const labelKind = (l) => (DEALER_LABELS.includes(l) ? 'dealer' : SHOP_LABELS.includes(l) ? 'shop' : null);

// Does viewer 2 get called? Low confidence, the generic scene label's kind disagrees with the matched place's kind, or the match would decide
// the organization alone (an organization match and no informative dealer/shop scene label).
export function needsSecondViewer(row, genericLabel, orgKindOf) {
  if (!(row.confidence >= SECOND_VIEWER_BELOW)) return { call: true, why: 'low_confidence' };
  const gk = labelKind(genericLabel); const ok = row.org_id ? orgKindOf.get(row.org_id) ?? null : null;
  if (gk && ok && gk !== ok) return { call: true, why: 'scene_kind_disagrees' };
  // An organization match with no informative generic scene label would decide the organization alone: it needs a second viewer.
  if (row.org_id && !gk) return { call: true, why: 'sole_decider' };
  return { call: false, why: null };
}

const q = (t) => (t == null ? 'NULL::text' : `'${String(t).replace(/'/g, "''")}'`);

// The place_matches CTE, same columns as the placeholder in the preview (WHERE true marks it as filled).
export function valuesCte(rows) {
  const head = 'place_matches AS (\n  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.photo_count, t.org_id, t.confidence, t.model, t.viewer, t.rationale\n';
  const cols = 't(run_id, vehicle_id, session_key, image_ids, photo_count, org_id, confidence, model, viewer, rationale)';
  if (!rows.length) {
    return head + `    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::int, NULL::uuid, NULL::numeric, NULL::text, NULL::int, NULL::text))\n         ${cols}\n   WHERE false -- (place_matches)\n),`;
  }
  const vals = rows.map((r) => `(${q(r.run_id)}::uuid, ${q(r.vehicle_id)}::uuid, ${q(r.session_key)}, `
    + `${r.image_ids?.length ? `ARRAY[${r.image_ids.map((i) => `${q(i)}::uuid`).join(', ')}]` : 'ARRAY[]::uuid[]'}, ${r.photo_count == null ? 'NULL::int' : `${Number(r.photo_count)}::int`}, `
    + `${r.org_id ? `${q(r.org_id)}::uuid` : 'NULL::uuid'}, ${Number(r.confidence)}::numeric, ${q(r.model)}, ${Number(r.viewer)}::int, `
    + `${q(r.cues?.length ? `${r.rationale} Cues: ${r.cues.join('; ')}` : r.rationale)})`);
  return head + `    FROM (VALUES\n      ${vals.join(',\n      ')})\n         ${cols}\n   WHERE true -- (place_matches)\n),`;
}

// ---- images ----------------------------------------------------------------------------------------------------------------

const SHEET_PY = `import sys
from PIL import Image, ImageDraw
out, letter = sys.argv[1], sys.argv[2]
files = sys.argv[3:]
cell_w, cell_h = 360, 270
cols = 3 if len(files) > 4 else 2 if len(files) > 1 else 1
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (255, 255, 255))
for i, f in enumerate(files):
    try:
        im = Image.open(f).convert("RGB"); im.thumbnail((cell_w - 6, cell_h - 6))
        sheet.paste(im, ((i % cols) * cell_w + 3, (i // cols) * cell_h + 3))
    except Exception:
        pass
ImageDraw.Draw(sheet).text((8, 6), "PLACE " + letter, fill=(255, 0, 0))
sheet.save(out, "JPEG", quality=85)
`;

export function makeSheet(files, letter, cacheDir) {
  const key = createHash('sha256').update(letter + '|' + files.join('|')).digest('hex').slice(0, 24);
  const out = join(cacheDir, `sheet-${key}.jpg`);
  if (!existsSync(out)) execFileSync('python3', ['-I', '-c', SHEET_PY, out, letter, ...files], { stdio: 'pipe' });
  return out;
}

// ---- one viewer ------------------------------------------------------------------------------------------------------------

export async function matchSession(session, candidates, { backend, cacheDir, model, viewer, fetchFn = fetchSample, sheetFn = makeSheet }) {
  const seed = `${session.vehicle_id}|${session.session_key}|v${viewer}`;
  const cands = viewer === 1 ? candidates : shuffle(candidates, seed);
  // samples: viewer 1 the primary samples; viewer 2 the alternative samples when the session has them (else the same ones, shuffled)
  const urls = viewer === 1 ? session.sample_urls : shuffle(session.alt_sample_urls?.length ? session.alt_sample_urls : session.sample_urls, seed + '|s');
  const sampleFiles = [];
  for (const u of urls) { try { sampleFiles.push(await fetchFn(u, cacheDir)); } catch (e) { console.error(`  skip sample: ${e.message}`); } }
  if (!sampleFiles.length) throw new Error('no sample image could be downloaded');
  const sheets = []; const letterToOrg = {};
  for (const [i, c] of cands.entries()) {
    const ex = viewer === 1 ? c.exemplars : shuffle(c.exemplars, seed + '|' + c.org_id);
    const files = [];
    for (const e of ex) { try { files.push(await fetchFn(e.url, cacheDir)); } catch (err) { console.error(`  skip exemplar: ${err.message}`); } }
    if (!files.length) continue;
    const letter = LETTERS[sheets.length]; letterToOrg[letter] = c.org_id;
    sheets.push({ letter, file: sheetFn(files, letter, cacheDir) });
    if (i >= LETTERS.length) break;
  }
  if (!sheets.length) throw new Error('no exemplar could be downloaded');
  const prompt = buildPrompt({ sampleFiles, sheets });
  const letters = sheets.map((s) => s.letter);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry on invalid output
    try { return { match: parseMatch(await backend({ files: [...sampleFiles, ...sheets.map((s) => s.file)], cacheDir, model, prompt }), letters), letterToOrg }; } catch (e) { lastErr = e; }
  }
  throw new Error(`invalid model output after retry: ${lastErr.message}`);
}

// ---- main ------------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const sessFile = opt('sessions-json'); const exFile = opt('exemplars-json');
  if (!sessFile || !exFile) { console.error('usage: match-places.mjs --sessions-json <file> --exemplars-json <file> [--scene-labels f.jsonl] [--second-viewer] [--out f.jsonl] [--cte-out f.sql] [--backend claude-cli] [--model m] [--limit n]'); process.exit(2); }
  const backendName = opt('backend', 'claude-cli'); const backend = BACKENDS[backendName];
  if (!backend) { console.error(`unknown backend ${backendName}; available: ${Object.keys(BACKENDS).join(', ')}`); process.exit(2); }
  const out = opt('out', '/workspace/place_matches.jsonl');
  const cteOut = opt('cte-out', out.replace(/\.jsonl$/, '') + '.cte.sql');
  const cacheDir = opt('cache-dir', '/tmp/label-scenes-cache'); mkdirSync(cacheDir, { recursive: true });
  const limit = Number(opt('limit', '0')) || Infinity; const second = args.includes('--second-viewer');
  const modelOpt = opt('model'); const model = `${backendName}:${modelOpt ?? 'default'}`;
  const raw = JSON.parse(readFileSync(sessFile, 'utf8'));
  const rep = representatives(raw);
  const exemplarRows = JSON.parse(readFileSync(exFile, 'utf8')); // org_id is already the representative id (build-place-exemplars.mjs)
  const orgKindOf = new Map(exemplarRows.map((r) => [r.org_id, r.org_kind ?? null]));
  const generic = new Map();
  if (opt('scene-labels') && existsSync(opt('scene-labels'))) for (const l of readFileSync(opt('scene-labels'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x))) {
    const k = `${l.vehicle_id}|${l.session_key}`; if (!generic.has(k) || l.confidence > generic.get(k).confidence) generic.set(k, l);
  }
  const sessions = raw.map((r) => ({ ...normalizeSession(r), organizations: r.organizations ?? [],
    alt_sample_urls: (r.alt_sample_urls ?? []).filter((u) => typeof u === 'string' && u).slice(0, 4) })).slice(0, limit);
  const runId = randomUUID();
  const rows = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(rows.map((r) => `${r.vehicle_id}|${r.session_key}|${r.viewer}`)); const failed = []; let skipped = 0;
  const run = async (s, cands, viewer, tag) => {
    const { match, letterToOrg } = await matchSession(s, cands, { backend, cacheDir, model: modelOpt, viewer });
    const row = toRow(s, match, letterToOrg, { runId, model, viewer, candidates: cands.map((c) => c.org_id) });
    rows.push(row); appendFileSync(out, JSON.stringify(row) + '\n');
    console.error(`${tag} ${s.session_key} viewer ${viewer} -> ${row.org_id ?? 'neither'} (${row.confidence})`);
    return row;
  };
  for (const [i, s] of sessions.entries()) {
    const cands = candidatesFor(s, exemplarRows, rep);
    if (!cands.length) { skipped++; continue; } // no in-range place has exemplars: nothing to compare against, never guessed
    const tag = `[${i + 1}/${sessions.length}]`;
    try {
      let r1 = rows.find((r) => r.vehicle_id === s.vehicle_id && r.session_key === s.session_key && r.viewer === 1);
      if (!r1) r1 = await run(s, cands, 1, tag);
      if (second && !done.has(`${s.vehicle_id}|${s.session_key}|2`)) {
        const need = needsSecondViewer(r1, generic.get(`${s.vehicle_id}|${s.session_key}`)?.scene_label, orgKindOf);
        if (need.call) { console.error(`${tag} second viewer: ${need.why}`); await run(s, cands, 2, tag); }
      }
    } catch (e) { failed.push({ session_key: s.session_key, error: e.message }); console.error(`${tag} ${s.session_key} FAILED: ${e.message}`); }
  }
  writeFileSync(cteOut, valuesCte(rows) + '\n');
  console.error(`run ${runId}: ${rows.length} rows, ${failed.length} failed, ${skipped} sessions without a candidate place with exemplars -> ${out}, ${cteOut} (no database write)`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });

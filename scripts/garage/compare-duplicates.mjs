#!/usr/bin/env node
// Duplicate judgment step: an independent viewer compares the photos of two vehicle records that the dup score put in the REVIEW band
// (same make, same model family, score >= 0.6 and < 0.7) and says whether they show the same physical vehicle. The verdict is the
// model's testimony, not a fact: model, confidence, rationale and contradictions are kept. The viewer is NOT shown the record fields
// (year, model, VIN, colour...), only the pixels, so it cannot anchor on them; the fields travel with the row for citation.
// No vehicle id, user label or organization name is an input except through the pair rows themselves.
//
//   node scripts/garage/compare-duplicates.mjs --pairs-sql-out [file] --user-id <uuid>
//        [--hist-jsonl /workspace/bat_history.jsonl]
//        print (or write) a READ-ONLY SELECT that produces the pair rows for an account; run it through scripts/data/q.sh and save the JSON.
//        A year gap of one is also a review pair, 0.05 below the band floor, when one side's VIN is on a listing (bat_listings, or the VINs of
//        --hist-jsonl rows); such a pair joins a cluster only through a visual 'same vehicle' judgment (the preview has no other path for it).
//   node scripts/garage/compare-duplicates.mjs --pairs-json /workspace/dup_pairs.json
//        [--out /workspace/visual_dup_judgments.jsonl] [--cte-out /workspace/visual_dup_judgments.cte.sql] [--cache-dir /tmp/label-scenes-cache]
//        [--backend claude-cli] [--model <name>] [--limit n]
//
// Input rows: a_id, b_id, a_samples[] and b_samples[] (image urls; up to 4 per side are used), fields (any JSON, cited only).
// HEIC photos are converted with python3 + pillow_heif (same code and cache as label-scenes.mjs). Backend 'claude-cli' runs `claude -p`
// and must answer strict JSON {same_vehicle: true|false|"unsure", confidence, rationale, contradictions[]}; one retry on invalid output;
// a pair that still fails, or has no photo on a side, is reported on stderr and skipped (never guessed). The output JSONL is appended as
// each pair is judged, so a rerun resumes. The CTE is the `visual_dup_judgments` VALUES block for the placeholder in
// supabase/sql/derive_vehicle_relationships_preview.sql. Nothing is written to the database.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BACKENDS, fetchSample } from './label-scenes.mjs';

export const PRODUCER = 'scripts/garage/compare-duplicates.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SAMPLES = 4;

// ---- pair rows -------------------------------------------------------------------------------------------------------------

// Read-only SELECT of the review pairs of ONE account: the dup score of find_vehicle_duplicate_candidates / the preview (same make,
// year within one, same model family, VIN equal or one missing; 0.50 + year + VIN + identical model text), score in
// [reviewMin, dupMin), and photos on BOTH sides (a pair with a side that has no photo cannot be compared by eye).
export function buildPairsSql(userId, { reviewMin = 0.6, dupMin = 0.7, histVins = [] } = {}) {
  if (!UUID.test(userId ?? '')) throw new Error('--user-id must be a uuid');
  if (!(reviewMin >= 0 && dupMin <= 1 && reviewMin < dupMin)) throw new Error('bad score band');
  const u = userId.toLowerCase();
  const hv = [...new Set(histVins.map((x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((x) => /^[A-Z0-9]{9,17}$/.test(x)))];
  const histSql = hv.length ? `\n          UNION ALL SELECT x FROM unnest(ARRAY[${hv.map((x) => `'${x}'`).join(', ')}]) x` : '';
  return `-- READ-ONLY: duplicate review pairs of one account with up to ${MAX_SAMPLES} photo urls per side (for scripts/garage/compare-duplicates.mjs)
WITH lv AS (
  -- VINs on a listing (bat_listings vin column or raw_data${hv.length ? `; ${hv.length} from seller-history rows` : ''}): a year gap of one is reviewed when one side's VIN is here
  SELECT DISTINCT x.vin FROM (
    SELECT upper(regexp_replace(coalesce(to_jsonb(bl)->>'vin', bl.raw_data->>'vin', bl.raw_data->>'VIN', ''), '[^A-Za-z0-9]', '', 'g')) AS vin FROM bat_listings bl${histSql} ) x
   WHERE length(x.vin) >= 9
),
dv AS (
  SELECT v.id AS vid, v.year, lower(btrim(v.make)) AS mk, lower(btrim(v.model)) AS model,
         normalize_vehicle_model_family(v.model) AS fam, nullif(upper(btrim(v.vin)), '') AS vin,
         EXISTS (SELECT 1 FROM lv WHERE lv.vin = upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g'))) AS vin_listing,
         jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'vin', nullif(btrim(v.vin), ''),
           'color', to_jsonb(v)->>'color', 'trim', to_jsonb(v)->>'trim', 'body_style', to_jsonb(v)->>'body_style',
           'engine', to_jsonb(v)->>'engine', 'transmission', to_jsonb(v)->>'transmission') AS fields,
         ARRAY(SELECT vi.image_url FROM vehicle_images vi
                WHERE vi.vehicle_id = v.id AND nullif(vi.image_url, '') IS NOT NULL AND coalesce(vi.image_vehicle_match_status, '') <> 'mismatch'
                ORDER BY coalesce(vi.taken_at, vi.created_at), vi.id LIMIT ${MAX_SAMPLES}) AS samples
    FROM vehicles v
   WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
     AND v.id IN (SELECT x.id FROM vehicles x WHERE x.user_id = '${u}'
                  UNION SELECT vi.vehicle_id FROM vehicle_images vi WHERE vi.user_id = '${u}'
                  UNION SELECT p.vehicle_id FROM vehicle_user_permissions p WHERE p.user_id = '${u}' AND p.revoked_at IS NULL)
)
SELECT a.vid AS a_id, b.vid AS b_id, round(s.score::numeric, 2) AS score, a.samples AS a_samples, b.samples AS b_samples,
       jsonb_build_object('a', a.fields, 'b', b.fields, 'vin_matches_listing', a.vin_listing OR b.vin_listing) AS fields
  FROM dv a JOIN dv b ON b.vid::text > a.vid::text AND a.mk <> '' AND b.mk = a.mk
   AND a.year IS NOT NULL AND b.year IS NOT NULL AND abs(b.year - a.year) <= 1
   AND a.fam IS NOT NULL AND b.fam = a.fam
   AND (a.vin IS NULL OR b.vin IS NULL OR a.vin = b.vin)
  CROSS JOIN LATERAL (SELECT 0.50 + CASE WHEN b.year = a.year THEN 0.15 ELSE 0.05 END
         + CASE WHEN a.vin IS NOT NULL AND a.vin = b.vin THEN 0.30 ELSE 0 END
         + CASE WHEN b.model = a.model THEN 0.05 ELSE 0 END AS score) s
 WHERE ((s.score >= ${reviewMin} - 1e-9 AND s.score < ${dupMin} - 1e-9)
        OR (abs(b.year - a.year) = 1 AND (a.vin_listing OR b.vin_listing) AND s.score >= ${reviewMin} - 0.05 - 1e-9 AND s.score < ${reviewMin} - 1e-9))
   AND cardinality(a.samples) > 0 AND cardinality(b.samples) > 0
 ORDER BY s.score DESC, a.vid, b.vid`;
}

export function normalizePair(r) {
  if (!UUID.test(r.a_id ?? '') || !UUID.test(r.b_id ?? '')) throw new Error(`pair without valid a_id / b_id: ${JSON.stringify(r).slice(0, 120)}`);
  if (r.a_id.toLowerCase() === r.b_id.toLowerCase()) throw new Error(`pair of one vehicle: ${r.a_id}`);
  const urls = (x) => (Array.isArray(x) ? x : []).filter((u) => typeof u === 'string' && u).slice(0, MAX_SAMPLES);
  return { a_id: r.a_id.toLowerCase(), b_id: r.b_id.toLowerCase(), a_samples: urls(r.a_samples), b_samples: urls(r.b_samples), fields: r.fields ?? null };
}

export const pairKey = (a, b) => [a, b].sort().join('|');

// ---- the viewer ------------------------------------------------------------------------------------------------------------

export function buildPrompt(aFiles, bFiles) {
  return `You are an independent viewer. Two vehicle records in a database may describe ONE physical vehicle photographed on different occasions. You are given only photos; you are not told anything else about the records. Use the Read tool on each image file below and compare them.

Photos of vehicle A:
${aFiles.map((f) => `- ${f}`).join('\n')}

Photos of vehicle B:
${bFiles.map((f) => `- ${f}`).join('\n')}

Decide whether A and B are the same physical vehicle. Look for features that persist between occasions: body colour and panel colour mismatches, wheels, bumpers and trim, dents, rust, repairs, modifications, interior colour and material, badges, stickers, plate or VIN if legible. Different lighting, angle, season or location is normal and is not a difference. Features that cannot be the same vehicle (different body style, cab or bed length, colour, wheels, grille, door count) are contradictions. Same model and colour alone does not make two vehicles the same; if nothing distinctive is visible in both sets answer "unsure".

Answer with ONLY one JSON object on one line, no markdown and no other text:
{"same_vehicle":<true|false|"unsure">,"confidence":<0 to 1, how sure you are of that answer>,"rationale":"<one or two sentences naming what you compared>","contradictions":["<each feature that differs between A and B, empty if none>"]}`;
}

export function parseJudgment(text) {
  const raw = String(text ?? '');
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  let j;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error(`reply is not JSON: ${e.message}`); }
  let sv = typeof j.same_vehicle === 'string' ? j.same_vehicle.trim().toLowerCase() : j.same_vehicle;
  if (sv === 'true') sv = true; else if (sv === 'false') sv = false;
  if (!(sv === true || sv === false || sv === 'unsure')) throw new Error('same_vehicle must be true, false or "unsure"');
  const c = typeof j.confidence === 'string' && j.confidence.trim() !== '' ? Number(j.confidence) : j.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw new Error('confidence must be a number between 0 and 1');
  const rationale = typeof j.rationale === 'string' ? j.rationale.trim() : '';
  if (!rationale) throw new Error('rationale is required');
  if (j.contradictions != null && !Array.isArray(j.contradictions)) throw new Error('contradictions must be an array');
  const contradictions = (j.contradictions ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  return { same_vehicle: sv, confidence: c, rationale: rationale.slice(0, 1000), contradictions };
}

export function toJudgment(pair, j, { runId, model, createdAt = new Date().toISOString() }) {
  return { run_id: runId, a_id: pair.a_id, b_id: pair.b_id, same_vehicle: j.same_vehicle, verdict: String(j.same_vehicle), confidence: j.confidence,
    rationale: j.rationale, contradictions: j.contradictions, model, fields: pair.fields, producer: PRODUCER, created_at: createdAt };
}

const q = (t) => (t == null ? 'NULL::text' : `'${String(t).replace(/'/g, "''")}'`);

// The visual_dup_judgments CTE, same columns as the placeholder in the preview (WHERE true marks it as filled). The contradictions
// are folded into the rationale text so the cited row keeps them.
export function valuesCte(rows) {
  const head = 'visual_dup_judgments AS (\n  SELECT t.a_id, t.b_id, t.verdict, t.confidence, t.model, t.rationale, t.run_id\n';
  const cols = 't(a_id, b_id, verdict, confidence, model, rationale, run_id)';
  if (!rows.length) {
    return head + `    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::numeric, NULL::text, NULL::text, NULL::uuid))\n         ${cols}\n   WHERE false -- (visual_dup_judgments)\n),`;
  }
  const vals = rows.map((r) => {
    const text = r.contradictions?.length ? `${r.rationale} Contradictions: ${r.contradictions.join('; ')}` : r.rationale;
    return `(${q(r.a_id)}::uuid, ${q(r.b_id)}::uuid, ${q(r.verdict)}, ${Number(r.confidence)}::numeric, ${q(r.model)}, ${q(text)}, ${q(r.run_id)}::uuid)`;
  });
  return head + `    FROM (VALUES\n      ${vals.join(',\n      ')})\n         ${cols}\n   WHERE true -- (visual_dup_judgments)\n),`;
}

export async function judgePair(pair, { backend, cacheDir, model, fetchFn = fetchSample }) {
  const side = async (urls) => { const files = []; for (const u of urls) { try { files.push(await fetchFn(u, cacheDir)); } catch (e) { console.error(`  skip sample: ${e.message}`); } } return files; };
  if (!pair.a_samples.length || !pair.b_samples.length) throw new Error('a side has no photo; nothing to compare');
  const aFiles = await side(pair.a_samples); const bFiles = await side(pair.b_samples);
  if (!aFiles.length || !bFiles.length) throw new Error('no sample image could be downloaded for a side');
  const prompt = buildPrompt(aFiles, bFiles);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry on invalid output
    try { return parseJudgment(await backend({ files: [...aFiles, ...bFiles], cacheDir, model, prompt })); } catch (e) { lastErr = e; }
  }
  throw new Error(`invalid model output after retry: ${lastErr.message}`);
}

// ---- main ------------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  if (args.includes('--pairs-sql-out')) {
    const hist = opt('hist-jsonl'); const histVins = hist && existsSync(hist) ? readFileSync(hist, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).vin).filter(Boolean) : [];
    const sql = buildPairsSql(opt('user-id'), { histVins });
    const dest = opt('pairs-sql-out');
    if (dest && dest !== '-') { writeFileSync(dest, sql + ';\n'); console.error(`wrote ${dest}`); } else console.log(sql + ';');
    return;
  }
  const inFile = opt('pairs-json');
  if (!inFile) { console.error('usage: compare-duplicates.mjs --pairs-sql-out [file] --user-id <uuid>\n   or: compare-duplicates.mjs --pairs-json <file> [--out f.jsonl] [--cte-out f.sql] [--backend claude-cli] [--model m] [--limit n]'); process.exit(2); }
  const backendName = opt('backend', 'claude-cli');
  const backend = BACKENDS[backendName];
  if (!backend) { console.error(`unknown backend ${backendName}; available: ${Object.keys(BACKENDS).join(', ')}`); process.exit(2); }
  const out = opt('out', '/workspace/visual_dup_judgments.jsonl');
  const cteOut = opt('cte-out', out.replace(/\.jsonl$/, '') + '.cte.sql');
  const cacheDir = opt('cache-dir', '/tmp/label-scenes-cache');
  mkdirSync(cacheDir, { recursive: true });
  const limit = Number(opt('limit', '0')) || Infinity;
  const modelOpt = opt('model');
  const model = `${backendName}:${modelOpt ?? 'default'}`;
  const pairs = JSON.parse(readFileSync(inFile, 'utf8')).map(normalizePair).slice(0, limit);
  const runId = randomUUID();
  // Resumable: pairs already in --out (either order) are kept and skipped; each new row is appended as it is produced.
  const rows = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(rows.map((r) => pairKey(r.a_id, r.b_id))); const failed = [];
  for (const [i, p] of pairs.entries()) {
    if (done.has(pairKey(p.a_id, p.b_id))) continue;
    try {
      const j = await judgePair(p, { backend, cacheDir, model: modelOpt });
      const row = toJudgment(p, j, { runId, model }); rows.push(row); appendFileSync(out, JSON.stringify(row) + '\n');
      console.error(`[${i + 1}/${pairs.length}] ${p.a_id} ~ ${p.b_id} -> ${j.same_vehicle} (${j.confidence})`);
    } catch (e) { failed.push({ a_id: p.a_id, b_id: p.b_id, error: e.message }); console.error(`[${i + 1}/${pairs.length}] ${p.a_id} ~ ${p.b_id} FAILED: ${e.message}`); }
  }
  writeFileSync(cteOut, valuesCte(rows) + '\n');
  console.error(`run ${runId}: ${rows.length} judged, ${failed.length} failed -> ${out}, ${cteOut} (no database write)`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });

/**
 * land_read.mjs — land a completed Eye read (pass1/2/3 JSON) into the DB via the
 * ingest-observation rail, then write the vehicle_condition_scores band row.
 *
 * Rebuilds the landing glue lost with the crash scratchpad. Idempotent: the rail
 * dedups by content_hash; the score row upserts on vehicle_id.
 *
 *   node land_read.mjs <readDir> <vehicle_id> <bat_url>
 *
 * readDir has: out/pass1_chunk*.json, out/pass2_crossexam.json,
 * out/pass3_appraisal.json, manifest.json (image_id -> image_url).
 */
import fs from 'node:fs';
import path from 'node:path';

const [readDir, vehicleId, batUrl] = process.argv.slice(2);
if (!readDir || !vehicleId) { console.error('usage: node land_read.mjs <readDir> <vehicle_id> <bat_url>'); process.exit(1); }

const SUPA = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const METHOD = 'blind-3pass v1.4';
const CANON = 'MUSTANG_APPRAISAL_CANON_1965-66 v1+v2';
const VERSION = 'appraisal-blind-3pass-v1.4';
const OBSERVED_AT = new Date().toISOString();
const outDir = path.join(readDir, 'out');

// image_id -> image_url
const manifest = JSON.parse(fs.readFileSync(path.join(readDir, 'manifest.json'), 'utf8'));
const urlById = new Map(manifest.map(r => [r.id, r.large_url || r.image_url]));
const idSet = new Set(manifest.map(r => r.id));

const idFromFile = (f) => {
  const base = path.basename(String(f || '')).replace(/\.jpe?g$/i, '');
  return idSet.has(base) ? base : null;
};

async function ingest(body) {
  const r = await fetch(`${SUPA}/functions/v1/ingest-observation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, j, t: t.slice(0, 300) };
}

let landedObserve = 0, dupObserve = 0, failed = 0, checks = 0, unmapped = 0;

// ---- Layer 1: OBSERVE (one row per image) ----
const chunkFiles = fs.readdirSync(outDir).filter(f => /^pass1_chunk.*\.json$/.test(f)).sort();
for (const cf of chunkFiles) {
  let doc; try { doc = JSON.parse(fs.readFileSync(path.join(outDir, cf), 'utf8')); } catch (e) { console.error('bad json', cf, e.message); continue; }
  const images = Array.isArray(doc.images) ? doc.images : [];
  for (const img of images) {
    const imageId = idFromFile(img.image_file);
    if (!imageId) { unmapped++; continue; }
    const nChecks = (img.parts || []).reduce((s, p) => s + (p.canon_checks || []).length, 0);
    checks += nChecks;
    const res = await ingest({
      source_slug: 'nuke-vision',
      kind: 'condition',
      observed_at: OBSERVED_AT,
      vehicle_id: vehicleId,
      source_url: batUrl || null,
      source_identifier: `observe:${imageId}`,
      structured_data: {
        layer: 'observe', method: METHOD, canon: CANON,
        image_id: imageId, image_url: urlById.get(imageId) || null,
        observation: img,
      },
    });
    if (res.ok && res.j?.duplicate) dupObserve++;
    else if (res.ok) landedObserve++;
    else { failed++; if (failed <= 5) console.error('observe fail', res.status, res.t); }
  }
}
console.log(`OBSERVE: landed=${landedObserve} dup=${dupObserve} failed=${failed} unmapped_images=${unmapped} canon_checks=${checks}`);

// ---- Layer 2: CROSS-EXAMINE (one row) ----
const p2path = path.join(outDir, 'pass2_crossexam.json');
if (fs.existsSync(p2path)) {
  const payload = JSON.parse(fs.readFileSync(p2path, 'utf8'));
  const res = await ingest({
    source_slug: 'nuke-vision', kind: 'condition', observed_at: OBSERVED_AT, vehicle_id: vehicleId,
    source_url: batUrl || null, source_identifier: 'crossexam',
    structured_data: { layer: 'cross_examine', method: METHOD, canon: CANON, payload },
  });
  console.log('CROSS-EXAMINE:', res.ok ? (res.j?.duplicate ? 'duplicate' : 'landed') : `FAIL ${res.status} ${res.t}`);
}

// ---- Layer 3: APPRAISE (one row) + score row ----
const p3path = path.join(outDir, 'pass3_appraisal.json');
if (fs.existsSync(p3path)) {
  const payload = JSON.parse(fs.readFileSync(p3path, 'utf8'));
  const res = await ingest({
    source_slug: 'nuke-vision', kind: 'condition', observed_at: OBSERVED_AT, vehicle_id: vehicleId,
    source_url: batUrl || null, source_identifier: 'appraise',
    structured_data: { layer: 'appraise', method: METHOD, canon: CANON, payload },
  });
  console.log('APPRAISE:', res.ok ? (res.j?.duplicate ? 'duplicate' : 'landed') : `FAIL ${res.status} ${res.t}`);

  // ---- vehicle_condition_scores band row (what the value block + dossier read) ----
  const band = payload.band_usd || {};
  const low = Number(band.low ?? payload.band_low);
  const high = Number(band.high ?? payload.band_high);
  const grades = payload.system_grades || {};
  const gvals = Object.values(grades).map(g => Number(g?.grade)).filter(Number.isFinite);
  const meanGrade = gvals.length ? gvals.reduce((a, b) => a + b, 0) / gvals.length : null;
  const conditionScore = meanGrade != null ? Math.round((meanGrade / 5) * 100) : null;
  const cls = String(payload.condition_class || '');
  const tierMatch = cls.match(/#\s*([1-5])/);
  const tier = tierMatch ? `#${tierMatch[1]}` : (payload.condition_tier || null);
  const descriptor_summary = {
    as_is_band_usd: (Number.isFinite(low) && Number.isFinite(high)) ? [low, high] : null,
    condition_class: cls || null,
    priceable: payload.priceable !== false,
    confidence: payload.confidence ?? null,
  };
  const frames = manifest.length;
  const row = {
    vehicle_id: vehicleId,
    condition_score: conditionScore,
    condition_tier: tier,
    descriptor_summary,
    observation_count: frames,
    computed_at: OBSERVED_AT,
    computation_version: VERSION,
  };
  const r = await fetch(`${SUPA}/rest/v1/vehicle_condition_scores?on_conflict=vehicle_id`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  const t = await r.text();
  console.log('SCORE ROW:', r.ok ? `upserted score=${conditionScore} tier=${tier} band=[${low},${high}] frames=${frames}` : `FAIL ${r.status} ${t.slice(0,300)}`);
}
console.log('DONE — refresh matview next: REFRESH MATERIALIZED VIEW appraisal_canon_checks;');

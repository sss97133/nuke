/**
 * classify-image-subjects.mjs — subscription-powered subject classifier (depth-aware).
 *
 * The deep-analysis drain already spent vision and wrote, per frame, a narrative AND a
 * structured multi-target verdict (components_seen, text_regions/OCR) now exposed as the
 * image_component_targets / image_text_targets views. This pass does NOT re-spend vision:
 * it reads that depth and asks Claude (via `claude --print`, billed to the SUBSCRIPTION —
 * see subject-classify-batch.sh) which of the owner's OWNED vehicles each frame depicts.
 * OCR (data plates, badges, serials) and component labels are decisive evidence — e.g. an
 * "INTERNATIONAL HARVESTER / SCOUT" plate means it is a Scout, not a Mustang. SQL
 * keyword-matching was proven wrong for SUBJECT identity (see engineering-manual Ch.16);
 * the LLM decides, and nothing is moved automatically — proposals are reversible.
 *
 * Modes:
 *   prepare  --user-id <uuid> [--limit N]   -> prints a JSON job {candidates, frames}
 *   ingest   --user-id <uuid> --results <f> -> applies the classification (flags + proposals)
 *
 * Provenance/safety:
 *   - candidates are OWNED vehicles only (owner_id, non-craigslist), numbered 1..N with NO
 *     cap (a 146-vehicle fleet must all be addressable; the old 26-letter scheme silently
 *     dropped 120 of them, so cross-make frames could never be matched).
 *   - 'NONE' (facility / document / personal photo / not-an-owned-vehicle) ->
 *     image_vehicle_match_status 'unrelated' (the gallery honors it; de-pollutes).
 *   - matched-but-different owned vehicle -> a row in image_attribution_review
 *     (status 'proposed') + match_status 'mismatch'. The vehicle_id move stays a separate,
 *     reviewed apply — this script never moves images.
 *   - near-identical guard: if the picked vehicle has the SAME year+make+model as the
 *     current one (text cannot distinguish duplicate records), treat as 'confirmed' rather
 *     than shuffle a frame between indistinguishable rows.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const mode = args[0];
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

async function ownedCandidates(userId) {
  // Cross-make on purpose: the pollution is cross-make (a Scout on a Mustang), so the
  // candidate set must span makes. Owned only; no craigslist comps. Numbered 1..N, no cap.
  const { data, error } = await sb
    .from('vehicles')
    .select('id, year, make, model, trim')
    .eq('owner_id', userId)
    .neq('source', 'craigslist')
    .not('make', 'is', null)
    .order('make').order('model').order('year').order('id');
  if (error) { console.error('candidates: ' + error.message); process.exit(1); }
  return (data || []).map((v, i) => ({
    n: i + 1,
    id: v.id,
    year: v.year, make: v.make, model: v.model,
    label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '),
  }));
}

// Per-frame depth (components + OCR) keyed by image_id, from the target views.
async function frameDepth(imageIds) {
  const comps = new Map(), texts = new Map();
  if (!imageIds.length) return { comps, texts };
  const CHUNK = 200;
  for (let i = 0; i < imageIds.length; i += CHUNK) {
    const ids = imageIds.slice(i, i + CHUNK);
    const { data: cd } = await sb
      .from('image_component_targets').select('image_id, label, confidence').in('image_id', ids);
    for (const r of cd || []) {
      if ((r.confidence ?? 1) < 0.6) continue;
      if (!comps.has(r.image_id)) comps.set(r.image_id, new Set());
      if (r.label) comps.get(r.image_id).add(r.label);
    }
    const { data: td } = await sb
      .from('image_text_targets').select('image_id, text').in('image_id', ids);
    for (const r of td || []) {
      if (!r.text || r.text.length < 3) continue;
      if (!texts.has(r.image_id)) texts.set(r.image_id, new Set());
      texts.get(r.image_id).add(r.text);
    }
  }
  return { comps, texts };
}

async function prepare() {
  const userId = arg('--user-id'); const limit = parseInt(arg('--limit', '40'), 10);
  if (!userId) { console.error('prepare: --user-id required'); process.exit(1); }
  const candidates = await ownedCandidates(userId);

  // Frames already deep-analyzed (narrative exists) but not yet subject-classified.
  const { data, error } = await sb
    .from('vehicle_images')
    .select('id, vehicle_id, ai_scan_metadata')
    .eq('user_id', userId)
    .is('image_vehicle_match_status', null)
    .not('ai_scan_metadata->byok_deep_analysis', 'is', null)
    .limit(limit);
  if (error) { console.error('prepare: ' + error.message); process.exit(1); }

  const base = (data || []).map((r) => ({
    image_id: r.id,
    current_vehicle_id: r.vehicle_id,
    narrative: r.ai_scan_metadata?.byok_deep_analysis?.narrative_one_line || '',
  })).filter((f) => f.narrative);

  const { comps, texts } = await frameDepth(base.map((f) => f.image_id));
  const frames = base.map((f) => ({
    ...f,
    components: [...(comps.get(f.image_id) || [])].slice(0, 12).join('; '),
    ocr: [...(texts.get(f.image_id) || [])].slice(0, 12).join(' | '),
  }));

  console.log(JSON.stringify({ candidates, frames }));
}

async function ingest() {
  const userId = arg('--user-id'); const resultsFile = arg('--results');
  if (!userId || !resultsFile) { console.error('ingest: --user-id and --results required'); process.exit(1); }

  // Re-derive the number->vehicle map exactly as prepare built it (deterministic order).
  const candidates = await ownedCandidates(userId);
  const byNum = new Map(candidates.map((c) => [String(c.n), c]));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const sameVehicleModel = (aId, bId) => {
    const a = byId.get(aId), b = byId.get(bId);
    return a && b && a.year === b.year && a.make === b.make && a.model === b.model;
  };

  const raw = readFileSync(resultsFile, 'utf8');
  let rows = [];
  try { rows = JSON.parse(raw); if (!Array.isArray(rows)) rows = rows.results || []; }
  catch { rows = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

  let confirmed = 0, unrelated = 0, proposed = 0, skipped = 0;
  for (const r of rows) {
    const imageId = r.image_id;
    const pick = String(r.n ?? r.vehicle_letter ?? r.letter ?? '').toUpperCase().trim();
    const conf = typeof r.confidence === 'number' ? r.confidence : 0.7;
    if (!imageId) { skipped++; continue; }

    const { data: img } = await sb.from('vehicle_images').select('vehicle_id').eq('id', imageId).maybeSingle();
    if (!img) { skipped++; continue; }

    if (pick === 'NONE' || pick === '') {
      await sb.from('vehicle_images').update({ image_vehicle_match_status: 'unrelated' }).eq('id', imageId);
      unrelated++; continue;
    }
    const cand = byNum.get(pick);
    if (!cand) { skipped++; continue; }
    const target = cand.id;

    // Same vehicle, or a near-identical duplicate record (text can't tell them apart) -> keep.
    if (target === img.vehicle_id || sameVehicleModel(target, img.vehicle_id)) {
      await sb.from('vehicle_images').update({ image_vehicle_match_status: 'confirmed' }).eq('id', imageId);
      confirmed++;
    } else {
      await sb.from('image_attribution_review').insert({
        image_id: imageId, from_vehicle_id: img.vehicle_id, proposed_vehicle_id: target,
        resolution: 'classified', evidence: `subscription subject-classify depth (conf ${conf})`,
        session_key: 'subject_classify', status: 'proposed',
      }).then(() => {}, () => {}); // ignore unique-conflict on re-runs
      await sb.from('vehicle_images').update({ image_vehicle_match_status: 'mismatch' }).eq('id', imageId);
      proposed++;
    }
  }
  console.log(`ingest: confirmed=${confirmed} unrelated=${unrelated} proposed=${proposed} skipped=${skipped}`);
}

if (mode === 'prepare') await prepare();
else if (mode === 'ingest') await ingest();
else { console.error('mode must be "prepare" or "ingest"'); process.exit(1); }

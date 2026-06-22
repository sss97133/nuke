/**
 * classify-image-subjects.mjs — subscription-powered, TEXT-ONLY subject classifier.
 *
 * The deep-analysis drain already spent vision and wrote a narrative for every frame
 * (vehicle_images.ai_scan_metadata.byok_deep_analysis.narrative_one_line). This pass
 * does NOT re-spend vision: it reads those narratives and asks Claude (via `claude
 * --print`, billed to the SUBSCRIPTION — see subject-classify-batch.sh) which of the
 * owner's OWNED vehicles each frame actually depicts. That is the only reliable subject
 * signal (SQL keyword-matching was proven wrong repeatedly; see engineering-manual
 * Ch.16). It then stages REVERSIBLE proposals — nothing is moved automatically.
 *
 * Modes:
 *   prepare  --user-id <uuid> [--limit N]   -> prints a JSON job {candidates, frames}
 *   ingest   --user-id <uuid> --results <f> -> applies the classification (flags + proposals)
 *
 * Provenance/safety:
 *   - candidates are OWNED vehicles only (owner_id, non-craigslist) so a frame can never
 *     be proposed onto a discovery comp.
 *   - 'NONE' (facility / document / not-an-owned-vehicle) -> image_vehicle_match_status
 *     'unrelated' (the gallery honors it; de-pollutes the current vehicle).
 *   - matched-but-different owned vehicle -> a row in image_attribution_review
 *     (status 'proposed') + match_status 'mismatch'. The actual vehicle_id move is a
 *     separate, reviewed apply — this script never moves images.
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
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function ownedCandidates(userId) {
  // Cross-make on purpose: the pollution is cross-make (a Scout on a Mustang), so the
  // candidate set must span makes. Owned only; no craigslist comps.
  const { data, error } = await sb
    .from('vehicles')
    .select('id, year, make, model, trim')
    .eq('owner_id', userId)
    .neq('source', 'craigslist')
    .not('make', 'is', null)
    .order('make').order('model');
  if (error) { console.error('candidates: ' + error.message); process.exit(1); }
  return (data || []).slice(0, 26).map((v, i) => ({
    letter: LABELS[i],
    id: v.id,
    label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '),
  }));
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

  const frames = (data || []).map((r) => ({
    image_id: r.id,
    current_vehicle_id: r.vehicle_id,
    narrative: r.ai_scan_metadata?.byok_deep_analysis?.narrative_one_line || '',
  })).filter((f) => f.narrative);

  console.log(JSON.stringify({ candidates, frames }));
}

async function ingest() {
  const userId = arg('--user-id'); const resultsFile = arg('--results');
  if (!userId || !resultsFile) { console.error('ingest: --user-id and --results required'); process.exit(1); }

  // Re-derive the letter->vehicle map exactly as prepare built it (deterministic order).
  const candidates = await ownedCandidates(userId);
  const byLetter = new Map(candidates.map((c) => [c.letter, c.id]));

  const raw = readFileSync(resultsFile, 'utf8');
  // Accept either a JSON array or JSONL.
  let rows = [];
  try { rows = JSON.parse(raw); if (!Array.isArray(rows)) rows = rows.results || []; }
  catch { rows = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

  let confirmed = 0, unrelated = 0, proposed = 0, skipped = 0;
  for (const r of rows) {
    const imageId = r.image_id; const letter = (r.vehicle_letter || r.letter || '').toUpperCase().trim();
    const conf = typeof r.confidence === 'number' ? r.confidence : 0.7;
    if (!imageId) { skipped++; continue; }

    const { data: img } = await sb.from('vehicle_images').select('vehicle_id').eq('id', imageId).maybeSingle();
    if (!img) { skipped++; continue; }

    if (letter === 'NONE' || letter === '') {
      await sb.from('vehicle_images').update({ image_vehicle_match_status: 'unrelated' }).eq('id', imageId);
      unrelated++; continue;
    }
    const target = byLetter.get(letter);
    if (!target) { skipped++; continue; }

    if (target === img.vehicle_id) {
      await sb.from('vehicle_images').update({ image_vehicle_match_status: 'confirmed' }).eq('id', imageId);
      confirmed++;
    } else {
      // Different owned vehicle: stage a reversible proposal; flag mismatch so it leaves
      // the wrong gallery. The vehicle_id move stays a separate, reviewed apply.
      await sb.from('image_attribution_review').insert({
        image_id: imageId, from_vehicle_id: img.vehicle_id, proposed_vehicle_id: target,
        resolution: 'classified', evidence: `subscription subject-classify (conf ${conf})`,
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

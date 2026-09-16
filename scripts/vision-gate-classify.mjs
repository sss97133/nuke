#!/usr/bin/env node
/**
 * Vision Gate Multi-Signal Classifier — cheap-first layered pipeline.
 *
 * Per Skylar 2026-05-03: USE ALL SIGNALS, cheapest first. Pixels last.
 *   L0 — caption + file_name text patterns (free, in DB)
 *   L1 — source rules (free, in DB)
 *   L2 — apple_ml_labels keyword match (free, in DB when populated)
 *   L3 — explicit flags (is_sensitive, is_document) and attribution
 *   L4 — vision via check-image-vehicle-match (opt-in, $$)
 *
 * Verdict at first layer with confidence ≥ HIGH_CONFIDENCE wins.
 * Falls through to next layer otherwise. Final layer's verdict applied
 * even if low confidence — review_needed when nothing is decisive.
 *
 * Writes: vision_gate_status, vision_gate_attribution_confidence,
 *         vision_gate_agent_reasoning, vision_gate_processed_at
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-gate-classify.mjs --vehicle-id <uuid>
 *   dotenvx run -- node scripts/vision-gate-classify.mjs --vehicle-id <uuid> --limit 50 --dry-run
 *   dotenvx run -- node scripts/vision-gate-classify.mjs --vehicle-id <uuid> --include-null --call-vision
 *
 * Flags:
 *   --vehicle-id <uuid>   target one vehicle's rows (uses indexed lookup)
 *   --limit N             max rows to process (default 100)
 *   --include-null        also process legacy rows with vision_gate_status IS NULL
 *   --dry-run             log verdicts, don't write
 *   --call-vision         allow L4 (Haiku vision via check-image-vehicle-match)
 */

import { createClient } from '@supabase/supabase-js';

const HIGH_CONFIDENCE = 0.85;
const FALLTHROUGH_CONFIDENCE = 0.7;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const VEHICLE_ID = arg('--vehicle-id');
const LIMIT = parseInt(arg('--limit', '100'));
const INCLUDE_NULL = flag('--include-null');
const INCLUDE_REVIEW = flag('--include-review');
const DRY_RUN = flag('--dry-run');
const CALL_VISION = flag('--call-vision');

if (!VEHICLE_ID) {
  console.error('--vehicle-id <uuid> required');
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Lexicons ────────────────────────────────────────────────────────────────

// Lexicons consolidated from classify-work-photos.py, ollama-classify-photo.py,
// vision-agent.mjs, check-image-vehicle-match prompts. Default stance per
// ollama-classify-photo.py: "ONLY personal for photos with ZERO vehicle connection."

const VEHICLE_KW = [
  'engine','frame','bumper','fender','hood','transmission','axle','wheel','tire',
  'paint','body','cabin','dash','seat','wiring','lift','garage','shop','restoration',
  'mechanic','repair','install','replace','fabrication','machining','weld','harness',
  'chassis','suspension','exhaust','intake','radiator','manifold','differential',
  'driveshaft','brake','rotor','caliper','spark','plug','carburetor','fuel','rust',
  'primer','sand','grind','torch','blast','strip','disassembl','assembl','rebuild',
  'undercarriage','firewall','rocker','quarter panel','tailgate','grille','headlight',
  'taillight','bedside','overhaul','swap','crossmember','k-member','vin',
  'mileage','odometer','dealer',
  'inspection','mockup','test_fit','parts_staging','cooling','fuel_system','steering',
  'plumbing','lift_kit','aftermarket','progress','before','after','measurement',
  'cleaning','cutting','fitment','painting','test fit',
  // K2500-caption patterns observed: "Damage/wear detail", "Driver-side profile"
  'damage','wear','dent','scratch','panel','profile','side','rear','front',
  'driver-side','passenger-side','close-up','closeup','overview','interior',
  'exterior','engine bay','wheel well','underside',
  // Year-make-model anchors used by Skylar's iphoto export
  'gmc','chevrolet','chevy','ford','dodge','plymouth','pontiac','k5','k10','k20',
  'k2500','k1500','c10','c1500','silverado','sierra','blazer','suburban','jimmy',
  'mustang','bronco','camaro','corvette',
];

const PERSONAL_KW = [
  'kids','child','toddler','baby','family','pool','vacation','holiday','christmas',
  'birthday','party','wedding','anniversary','dinner','lunch','breakfast','meal',
  'food','drink','coffee','beer','wine','cocktail','plate','dish','meme','funny',
  'gift','present','wife','husband','jenny','date night','beach','mountain','hike',
  'cat','dog','pet','puppy','kitten','flower','garden','sunset','sunrise','selfie',
  'pajama','bath','bedroom','living room','couch','tv','movie','game','toy','playing',
  'villa','hotel','resort','restaurant','dining','gym','fitness','tour','leisure',
  'medical','health',
];

const DOC_KW = [
  'title','registration','receipt','invoice','bill','statement','contract','tax',
  'insurance','license plate','vin sticker','build sheet','window sticker',
  'manual','service record','deal jacket','repair order','stock number',
  'part number','badge',
];

function kwScore(text, kws) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const k of kws) if (lower.includes(k)) hits++;
  return hits;
}

// ── Layers ──────────────────────────────────────────────────────────────────

function L0_text(row) {
  const text = [row.caption, row.file_name, row.user_notes, row.image_context].filter(Boolean).join(' ');
  if (!text) return null;
  const v = kwScore(text, VEHICLE_KW);
  const p = kwScore(text, PERSONAL_KW);
  const d = kwScore(text, DOC_KW);

  // Vehicle keywords outrank everything when present and not contested.
  if (v >= 2 && p === 0) {
    return { verdict: 'approved', confidence: 0.9, reasoning: `L0: ${v} vehicle keywords, 0 personal in caption/filename: "${text.slice(0,120)}"` };
  }
  if (p >= 2 && v === 0) {
    return { verdict: 'rejected_personal', confidence: 0.92, reasoning: `L0: ${p} personal keywords, 0 vehicle in caption/filename: "${text.slice(0,120)}"` };
  }
  // Doc only fires if there's no vehicle/personal noise — pure document context.
  if (d >= 1 && p === 0 && v === 0) {
    return { verdict: 'approved', confidence: 0.88, reasoning: `L0: doc-only context (${d} doc keywords, 0 vehicle/personal): "${text.slice(0,120)}"` };
  }
  if (v >= 1 && p >= 1) {
    return { verdict: 'review_needed', confidence: 0.5, reasoning: `L0: mixed signal — ${v} vehicle vs ${p} personal keywords` };
  }
  if (v === 1 && p === 0) {
    return { verdict: 'approved', confidence: 0.75, reasoning: `L0: 1 vehicle keyword, 0 personal: "${text.slice(0,120)}"` };
  }
  return null;
}

function L1_source(row) {
  const src = (row.source || '').toLowerCase();
  if (!src) return null;

  // Auction-pipeline sources: provenance is the attribution. Cannot be
  // contaminated by personal photos. Auto-approve.
  if (src.startsWith('bat_') || src.startsWith('mecum') || src.startsWith('barrett') ||
      src === 'cars-and-bids' || src === 'hagerty' || src === 'pcarmarket' ||
      src === 'external_import' || src === 'gaaclassiccars') {
    return { verdict: 'approved', confidence: 0.95, reasoning: `L1: source=${src} — auction-pipeline image, attribution by provenance` };
  }
  // GoPro timelapse: captured during shop sessions, vehicle-context by design.
  if (src === 'gopro_timelapse' || src === 'gopro') {
    return { verdict: 'approved', confidence: 0.88, reasoning: `L1: source=${src} — captured during shop work session` };
  }
  // OCR'd receipts: documentation by definition.
  if (src === 'receipt-scan' || src === 'receipt_scan' || src === 'receipt-ocr') {
    return { verdict: 'approved', confidence: 0.95, reasoning: `L1: source=${src} — receipt/document, legitimate on profile` };
  }
  if (src === 'numbers_spreadsheet') {
    return { verdict: 'approved', confidence: 0.85, reasoning: `L1: source=numbers_spreadsheet — Skylar's structured data` };
  }
  // High-contamination-risk sources (imessage, iphoto, dropbox, manual_upload)
  // fall through to L0/L2/L3/L4 — that's where the cheap-text and pixel signals must do work.
  return null;
}

function L2_apple_ml(row) {
  const labels = row.apple_ml_labels;
  if (!labels || !Array.isArray(labels) || labels.length === 0) return null;
  const set = new Set(labels.map(l => String(l).toLowerCase()));

  const personal = ['child','toddler','baby','infant','kid','family','pet','cat','dog','puppy','kitten','food','meal','plate','beverage','drink','flower','beach','sunset','swimming pool'];
  const vehicle = ['car','vehicle','automobile','truck','engine','tire','wheel','tool','workshop','garage','machinery'];
  const doc = ['document','text','sign','license plate','receipt','paper'];

  const pHit = personal.filter(k => set.has(k));
  const vHit = vehicle.filter(k => set.has(k));
  const dHit = doc.filter(k => set.has(k));

  if (dHit.length && !pHit.length) {
    return { verdict: 'approved', confidence: 0.85, reasoning: `L2: apple_ml_labels include doc terms ${JSON.stringify(dHit)}` };
  }
  if (pHit.length >= 2 && vHit.length === 0) {
    return { verdict: 'rejected_personal', confidence: 0.9, reasoning: `L2: apple_ml_labels include ${JSON.stringify(pHit)} with no vehicle terms` };
  }
  if (vHit.length >= 1 && pHit.length === 0) {
    return { verdict: 'approved', confidence: 0.85, reasoning: `L2: apple_ml_labels include vehicle terms ${JSON.stringify(vHit)}` };
  }
  if (vHit.length && pHit.length) {
    return { verdict: 'review_needed', confidence: 0.55, reasoning: `L2: apple_ml mixed — vehicle ${JSON.stringify(vHit)} + personal ${JSON.stringify(pHit)}` };
  }
  return null;
}

function L3_flags(row) {
  if (row.is_sensitive === true) {
    return { verdict: 'rejected_personal', confidence: 0.99, reasoning: `L3: is_sensitive=true${row.sensitive_type ? ` (${row.sensitive_type})` : ''} — definitive` };
  }
  if (row.is_document === true) {
    return { verdict: 'approved', confidence: 0.95, reasoning: `L3: is_document=true${row.document_classification ? ` (${row.document_classification})` : ''} — legitimate on profile` };
  }
  return null;
}

// ── L0.5 Sender / Contact Affinity ───────────────────────────────────────
// Per Skylar 2026-05-05: "system has to work for everyone — take anyone's
// image library and organize their images." Generic, no hardcoded rules.
//
// Reads the per-library sender_contact_affinity table populated from
// historical verdicts. > 0.8 → approved, < 0.2 → rejected_personal.
// Cold-start (< 10 obs) → null fall-through. Saves L4 vision spend on
// already-known-pattern contacts (e.g. spouse iMessage thread, contractor
// shop phone).

const _affinityCache = new Map(); // user_id → Map<contact_id, {affinity, confidence, count}>

async function loadAffinities(userId) {
  if (_affinityCache.has(userId)) return _affinityCache.get(userId);
  const { data, error } = await sb
    .from('sender_contact_affinity')
    .select('contact_identifier, vehicle_affinity, confidence, observation_count')
    .eq('user_scope_id', userId);
  const map = new Map();
  if (!error && data) {
    for (const r of data) {
      map.set(r.contact_identifier, {
        affinity: r.vehicle_affinity,
        confidence: r.confidence,
        count: r.observation_count,
      });
    }
  }
  _affinityCache.set(userId, map);
  return map;
}

async function L0_5_sender_affinity(row, ownerId) {
  const src = (row.source || '').toLowerCase();
  // Only fires for high-contamination sources where contact context can resolve
  if (!['imessage', 'manual_upload', 'iphoto', 'iphoto_60d', 'dropbox', 'photo_auto_sync', 'user_upload'].includes(src)) {
    return null;
  }
  const contactId = row.photographer_attribution || row.documented_by_device;
  if (!contactId) return null;
  const map = await loadAffinities(ownerId);
  const a = map.get(contactId);
  if (!a || a.count < 10 || a.affinity == null) return null;

  if (a.affinity > 0.8) {
    return {
      verdict: 'approved',
      confidence: Math.min(0.95, Number(a.confidence) + 0.10),
      reasoning: `L0.5: contact "${contactId}" has vehicle-affinity ${a.affinity} (${a.count} obs) — vehicle-pattern contact`,
    };
  }
  if (a.affinity < 0.2) {
    return {
      verdict: 'rejected_personal',
      confidence: Math.min(0.95, Number(a.confidence) + 0.10),
      reasoning: `L0.5: contact "${contactId}" has vehicle-affinity ${a.affinity} (${a.count} obs) — personal-pattern contact`,
    };
  }
  return null;
}

async function L4_vision(row) {
  // Defer to existing check-image-vehicle-match edge function for one image.
  const url = `${SUPABASE_URL}/functions/v1/check-image-vehicle-match`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_ids: [row.id], dry_run: true }),
  });
  if (!resp.ok) return { verdict: 'review_needed', confidence: 0.3, reasoning: `L4: vision call failed ${resp.status}` };
  const data = await resp.json();
  const r = data?.results?.[0];
  if (!r) return { verdict: 'review_needed', confidence: 0.3, reasoning: `L4: vision returned no result` };

  const map = {
    confirmed: 'approved',
    mismatch: 'rejected_misattributed',
    unrelated: 'rejected_personal',
    ambiguous: 'review_needed',
    reassigned: 'approved',
  };
  return {
    verdict: map[r.status] || 'review_needed',
    confidence: r.confidence ?? 0.6,
    reasoning: `L4(haiku): ${r.status} — ${r.reason || '(no reason)'}`,
  };
}

// ── Pipeline ────────────────────────────────────────────────────────────────

async function classify(row, ownerId) {
  // L0.5 is async (DB lookup); the rest are sync.
  const syncLayers = [L0_text, L1_source, L2_apple_ml, L3_flags];
  let last = null;
  for (const layer of syncLayers) {
    const verdict = layer(row);
    if (!verdict) continue;
    last = verdict;
    if (verdict.confidence >= HIGH_CONFIDENCE) return verdict;
  }
  // L0.5 sender-affinity check (async DB lookup; cached per user)
  if (ownerId) {
    const v = await L0_5_sender_affinity(row, ownerId);
    if (v) {
      last = v;
      if (v.confidence >= HIGH_CONFIDENCE) return v;
    }
  }
  // Fall through: low-confidence verdict from cheap layers, or nothing.
  if (last && last.confidence >= FALLTHROUGH_CONFIDENCE) return last;

  if (CALL_VISION) {
    const v = await L4_vision(row);
    return v;
  }
  return last || { verdict: 'review_needed', confidence: 0.2, reasoning: 'no layer produced a verdict — review_needed' };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const filter = INCLUDE_NULL ? 'IS NULL or pending' : 'pending';
  console.log(`vehicle_id=${VEHICLE_ID} status=${filter} limit=${LIMIT} dry=${DRY_RUN} vision=${CALL_VISION}`);

  // Resolve vehicle owner once for L0.5 lookups
  const { data: vehicleRow } = await sb
    .from('vehicles')
    .select('user_id')
    .eq('id', VEHICLE_ID)
    .single();
  const ownerId = vehicleRow?.user_id || null;

  let q = sb
    .from('vehicle_images')
    .select('id, vehicle_id, source, file_name, caption, user_notes, image_context, apple_ml_labels, is_sensitive, sensitive_type, is_document, document_classification, photographer_attribution, documented_by_device, vision_gate_status, vision_gate_agent_reasoning')
    .eq('vehicle_id', VEHICLE_ID)
    .limit(LIMIT);
  if (INCLUDE_REVIEW) {
    q = q.or('vision_gate_status.is.null,vision_gate_status.eq.pending,vision_gate_status.eq.review_needed');
    // Skip rows already claimed by L4 prepare — those are in flight.
    q = q.not('vision_gate_agent_reasoning', 'like', 'L4-claimed:%');
  } else if (INCLUDE_NULL) {
    q = q.or('vision_gate_status.is.null,vision_gate_status.eq.pending');
  } else {
    q = q.eq('vision_gate_status', 'pending');
  }

  const { data: rows, error } = await q;
  if (error) { console.error('fetch failed:', error.message); process.exit(1); }
  console.log(`fetched ${rows.length} rows`);

  const tally = { approved: 0, rejected_personal: 0, rejected_misattributed: 0, review_needed: 0 };
  let visionCalls = 0;

  let skipped = 0;
  for (const row of rows) {
    const v = await classify(row, ownerId);
    tally[v.verdict] = (tally[v.verdict] || 0) + 1;
    if (v.reasoning?.startsWith('L4')) visionCalls++;

    // In re-drain mode, skip no-progress rewrites (already review_needed → still review_needed).
    if (INCLUDE_REVIEW && v.verdict === 'review_needed' && row.vision_gate_status === 'review_needed') {
      skipped++;
      continue;
    }

    console.log(`  ${row.id}  ${v.verdict.padEnd(24)} c=${v.confidence.toFixed(2)}  ${v.reasoning}`);

    if (!DRY_RUN) {
      const { error: upErr } = await sb
        .from('vehicle_images')
        .update({
          vision_gate_status: v.verdict,
          vision_gate_attribution_confidence: v.confidence,
          vision_gate_agent_reasoning: v.reasoning,
          vision_gate_processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (upErr) console.error(`    write failed: ${upErr.message}`);
    }
  }
  if (skipped > 0) console.log(`  (skipped ${skipped} no-progress review_needed rewrites)`);

  console.log('\n── tally ──');
  for (const [k, n] of Object.entries(tally)) console.log(`  ${k}: ${n}`);
  console.log(`  L4 vision calls: ${visionCalls}`);
  console.log(`  ${DRY_RUN ? '[DRY RUN — nothing written]' : '[writes applied]'}`);
}

main().catch(e => { console.error(e); process.exit(1); });

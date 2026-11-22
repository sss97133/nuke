// Pure parts of the doubt loop (no network, no model): deriving doubts from a vehicle_facet_items payload, building the
// question row, building the BLIND task an answering reader sees, and validating a closed answer.
// Producer: scripts/doubts/raise-fact-doubts.mjs. Runner: scripts/doubts/answer-fact-doubts.mjs.
// Contract: supabase/migrations/20261120070000_fact_doubt_questions.sql (kind fact_doubt).
import { canonical, sha256 } from '../garage/derivation-evidence.mjs';

export const DEPARTMENT = 'fact_doubts';
export const QUESTION = 'fact_doubt';
export const HEADER_DIMENSIONS = ['engine', 'transmission', 'body_style', 'trim', 'paint', 'drivetrain'];
export const DOUBT_STATUSES = ['reading', 'conflict', 'missing'];
export const FRAME_CAP = 8;
export const OUTCOMES = ['value', 'not_visible', 'cannot_tell', 'different_measures'];
export const READABLE_TYPES = ['string', 'numeric', 'integer'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// facet item key -> registered property key; roles = claim_role values of existing readings of that part; terms = words that
// a photograph's existing reading uses when it names the part. property null = no registered key yet (proposed names are
// reported, never forced).
export const ITEM_MAP = {
  'engine.current.block_casting': { property: 'engine_block_casting', roles: ['engine_block_casting', 'engine_block_casting_dossier_fields'], terms: ['block casting', 'engine block'] },
  'engine.current.engine_code_stamp': { property: 'engine_code_stamp', roles: ['engine_code_stamp'], terms: ['block pad', 'engine code', 'pad stamp'] },
  'engine.current.heads': { property: 'engine_head_date_code', roles: [], terms: ['cylinder head', 'head casting', 'head date'] },
  'engine.current.family': { property: 'engine_configuration', roles: ['engine_block_casting', 'engine_block_casting_dossier_fields'], terms: ['engine block'] },
  'engine.current.block_date': { property: null, proposed: 'engine_block_date_code', roles: ['engine_block_casting'], terms: ['block date', 'date code'] },
  'transmission.current.id_stamp': { property: 'transmission_id_stamp', roles: ['transmission_id_stamp'], terms: ['id stamp', 'transmission stamp'] },
  'transmission.current.date_code': { property: null, proposed: 'transmission_decoded_year', roles: ['transmission_id_stamp'], terms: ['id stamp'] },
  'transmission.current.case_casting': { property: 'transmission_case_casting', roles: ['transmission_case_model'], terms: ['case casting', 'transmission case'] },
  'transmission.current.tailhousing_casting': { property: 'transmission_tailhousing_casting', roles: ['transmission_tailhousing'], terms: ['tailhousing', 'tail housing'] },
  'transmission.current.side_cover_casting': { property: 'transmission_side_cover_casting', roles: ['transmission_side_cover'], terms: ['side cover'] },
  'transmission.current.bellhousing_casting': { property: 'bellhousing_casting', roles: ['transmission_bellhousing'], terms: ['bellhousing', 'bell housing'] },
  'transmission.current.model': { property: 'transmission_model', roles: ['transmission_case_model', 'transmission_id_stamp'], terms: ['case casting', 'id stamp'] },
  'transmission.current.type': { property: 'transmission_type', roles: ['identified_transmission_housing'], terms: ['transmission'] },
  'body_style.body_tag': { property: 'body_tag_style', roles: ['cowl_tag_style', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'body_style.body_number': { property: 'body_tag_body_number', roles: ['cowl_tag_body_number', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'body_style.build_date': { property: 'body_tag_build_date', roles: ['cowl_tag_build_date', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'body_style.option_codes': { property: 'body_tag_option_codes', roles: ['cowl_tag_option_codes', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'body_style.tag_line5': { property: 'body_tag_line5', roles: ['cowl_tag_line5', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'trim.as_built.interior': { property: 'body_tag_trim_code', roles: ['cowl_tag_trim', 'cowl_tag_transcription'], terms: ['cowl tag', 'body tag'] },
  'paint.as_built.code': { property: 'body_tag_paint_code', roles: ['cowl_tag_paint', 'factory_paint_code'], terms: ['cowl tag', 'body tag'] },
  'drivetrain.axle.current.type': { property: null, proposed: 'rear_axle_type', roles: [], terms: ['axle tag', 'rear axle', 'differential'] },
};

// Doubts from a facet payload ({dimension: [item]} or an array of items). A doubt is raised for an item whose key maps to a
// property and whose status is reading (one reader), conflict or missing. Items with a status of established or claim are not
// doubted. Returns { doubts, unmapped } where unmapped items are those needing a key the registry lacks.
export function deriveDoubts(payload, registry) {
  const items = Array.isArray(payload) ? payload : Object.values(payload ?? {}).flat();
  const doubts = []; const unmapped = [];
  for (const it of items) {
    if (!it || !DOUBT_STATUSES.includes(it.status)) continue;
    const m = ITEM_MAP[it.key];
    if (!m) continue;
    const reg = m.property ? registry.get(m.property) : null;
    if (!reg) { unmapped.push({ item_key: it.key, status: it.status, why: m.property ? `key ${m.property} not registered` : 'no registered key', proposed: m.proposed ?? null }); continue; }
    if (!READABLE_TYPES.includes(reg.data_type)) { unmapped.push({ item_key: it.key, status: it.status, why: `${m.property} is ${reg.data_type}: no closed value list`, proposed: null }); continue; }
    const sources = it.sources ?? [];
    const witnesses = sources.map((s) => s.witness).filter(Boolean);
    doubts.push({
      origin: 'contradiction_check', origin_ref: `facet_items:${it.key}:${it.status}`, property_key: m.property, property_id: reg.id,
      item_key: it.key, status: it.status, roles: m.roles, terms: m.terms,
      witness_image_ids: witnesses.filter((w) => w.kind === 'image').map((w) => w.id),
      receipt_item_ids: witnesses.filter((w) => w.kind === 'receipt_item').map((w) => w.id),
    });
  }
  return { doubts, unmapped };
}

// Doubts from a simulated-reader file [{property_key, words_ref}]: the words stay at words_ref, only the key is used.
export function doubtsFromReaderFile(rows, registry) {
  const byProp = new Map(Object.entries(ITEM_MAP).filter(([, m]) => m.property).map(([k, m]) => [m.property, { item_key: k, ...m }]));
  const doubts = []; const unmapped = [];
  for (const r of rows ?? []) {
    const reg = registry.get(r.property_key); const m = byProp.get(r.property_key);
    if (!r.words_ref || !reg || !m || !READABLE_TYPES.includes(reg.data_type)) { unmapped.push({ item_key: r.property_key, why: !r.words_ref ? 'words_ref missing' : !reg ? 'not registered' : 'no frame derivation' }); continue; }
    doubts.push({ origin: 'simulated_reader', origin_ref: String(r.words_ref), property_key: r.property_key, property_id: reg.id, item_key: m.item_key,
      status: 'doubted', roles: m.roles, terms: m.terms, witness_image_ids: [], receipt_item_ids: [] });
  }
  return { doubts, unmapped };
}

// Rank candidate frames and cap them: witnesses of the doubted item first, then readings of the same part, then text matches;
// within a tier the sharper/closer photograph (photo_quality_score) first. Ineligible frames are dropped (the gate re-checks).
export function frameEligible(x) {
  return !!x.taken_at && x.vision_gate_status === 'approved' && x.is_sensitive !== true && x.is_duplicate !== true && x.is_superseded !== true
    && x.is_document !== true && (x.redaction_level ?? 'none') === 'none'
    && !['product_screenshot', 'cross_reference', 'receipt_document', 'hand_drawn_diagram'].includes(x.scene_type ?? '');
}
// Where an existing reading of a photograph names the part it shows. A close-up names its subject in the framing line or
// an open question as often as in the notes, so a term search over the notes alone finds no frame for a photographed part.
export const FRAME_TERM_FIELDS = ['structured_data->>agent_notes', 'structured_data->>narrative_one_line',
  'structured_data->camera_pose->>framing', 'structured_data->>open_questions', 'structured_data->>components_seen'];
// PostgREST or-filter body: any term in any of those fields, case-insensitive.
export function frameTermFilter(terms) {
  return terms.flatMap((t) => FRAME_TERM_FIELDS.map((f) => `${f}.ilike.*${encodeURIComponent(t)}*`)).join(',');
}

// Enlargement boxes for one photograph, from where an existing reading located text (its text_regions bboxes, 0..1000 on both
// axes). Only the positions are used, never the text read there, so the task stays blind. Each box is grown by `margin` of its
// own size (at least `min` units), boxes that then overlap are merged, and at most `cap` are returned, largest first.
export const CLOSEUP_CAP = 3;
export function closeupBoxes(regions, { margin = 0.6, min = 60, cap = CLOSEUP_CAP } = {}) {
  const clamp = (v) => Math.max(0, Math.min(1000, v));
  let boxes = (Array.isArray(regions) ? regions : []).map((r) => r?.bbox)
    .filter((b) => Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(v)) && b[2] > b[0] && b[3] > b[1] && b[0] >= 0 && b[3] <= 1000 && b[2] <= 1000)
    .map(([x0, y0, x1, y1]) => { const mx = Math.max(min, (x1 - x0) * margin); const my = Math.max(min, (y1 - y0) * margin); return [clamp(x0 - mx), clamp(y0 - my), clamp(x1 + mx), clamp(y1 + my)]; });
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
        boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; boxes.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  return boxes.sort((a, b) => area(b) - area(a) || a[0] - b[0] || a[1] - b[1]).slice(0, cap);
}

export function pickFrames(candidates, cap = FRAME_CAP) {
  const tier = { witness: 0, role: 1, text: 2 };
  const seen = new Set();
  return [...candidates].filter((c) => frameEligible(c))
    .sort((a, b) => (tier[a.tier] - tier[b.tier]) || ((b.photo_quality_score ?? -1) - (a.photo_quality_score ?? -1)) || a.id.localeCompare(b.id))
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, cap).map((c) => c.id);
}

export const ANSWER_SCHEMA = {
  type: 'object', required: ['outcome', 'confidence'],
  properties: {
    outcome: { enum: OUTCOMES, description: 'value: the evidence shows one value; not_visible: it is not visible in the cited frames; cannot_tell: visible but not legible or conflicting; different_measures: only for a reader_pair doubt' },
    value: { type: ['string', 'number', 'boolean', 'null'], description: 'only with outcome value; one of params.allowed when listed' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    image_ids: { type: 'array', items: { type: 'string' }, description: 'cited frames that show it' },
    receipt_item_ids: { type: 'array', items: { type: 'string' }, description: 'cited receipt lines that state it' },
    quote: { type: ['string', 'null'], description: 'what in the evidence shows it' },
  },
};

// The doubt as a question row for raise_evidence_judgment. evidenceDb = fact_doubt_evidence_state(...) from the database,
// triggerKey = fact_doubt_trigger_key(evidence_state). Identity = vehicle + key + form + trigger key (the evidence state).
export function buildQuestionRow({ doubt, vehicle, evidenceDb, triggerKey, imageIds, itemIds, runId, version, script, allowed = null }) {
  const params = {
    doubt_form: 'property', property_key: doubt.property_key, origin: doubt.origin, origin_ref: doubt.origin_ref,
    cited_image_ids: [...imageIds], cited_receipt_item_ids: [...itemIds], allowed, evidence_state: { db: evidenceDb },
  };
  const dedupe_key = sha256(canonical({ d: DEPARTMENT, q: QUESTION, v: vehicle.id, k: doubt.property_key, f: 'property', t: triggerKey }));
  return {
    department: DEPARTMENT, question_kind: QUESTION, subject_table: 'observation_properties', subject_id: doubt.property_id,
    vehicle_id: vehicle.id, user_id: vehicle.user_id, params, answer_schema: ANSWER_SCHEMA, priority: doubt.status === 'conflict' ? 2 : 1,
    trigger_evidence_dedupe_key: triggerKey, producer_agent: 'fact-doubt-producer', producer_script: script, producer_version: version,
    run_id: runId, dedupe_key, question_hash: sha256(canonical({ params, answer_schema: ANSWER_SCHEMA })),
  };
}

// The BLIND task. Only these inputs are read: the registry row (label, description, type, unit), params.doubt_form,
// params.allowed, the cited ids, and the evidence itself (frames as images, receipt lines as text). Nothing else on the
// request (stored values, caption, origin, evidence_state, answer or answer_history) is passed on.
// A registry description made safe to show a blind reader: its examples ("e.g. 9799140") are removed because they can be the
// very value on this vehicle's page, and the boilerplate that follows the definition is cut.
export function plainDefinition(description) {
  const cut = String(description ?? '').split(' Instance reading')[0];
  return cut.replace(/\s*\(?\be\.g\.[^).;]*\)?/gi, '').replace(/\s+([,.;])/g, '$1').replace(/\s+/g, ' ').trim();
}

export function buildBlindTask({ params, registryRow, lines = [] }) {
  const label = registryRow.label ?? params.property_key;
  const unit = registryRow.unit ? ` (unit: ${registryRow.unit})` : '';
  const what = [`${label}${unit}`, plainDefinition(registryRow.description) ? `Definition: ${plainDefinition(registryRow.description)}` : null].filter(Boolean).join('\n');
  const allowed = Array.isArray(params.allowed) && params.allowed.length ? `The value must be exactly one of: ${params.allowed.join(' | ')}.` : 'Give the value as printed, character for character, as plain text up to 80 characters.';
  const system = 'You re-read physical evidence about one vehicle and answer one closed question. You have no other information about the vehicle. '
    + 'Report only what the cited photographs and receipt lines show. Read stamps and castings character by character; if a character is not legible, say cannot_tell rather than guessing. '
    + 'Unknown is an acceptable answer: not_visible when the part is not in the frames, cannot_tell when it is visible but not legible or the frames disagree.';
  const text = [
    'Question: what does the evidence show for this vehicle?', what,
    `Answer with JSON: outcome (value | not_visible | cannot_tell), value (only with outcome value), confidence 0..1, image_ids (the frames that show it, only ids given below), receipt_item_ids (only ids given below), quote (what in the evidence shows it).`,
    allowed, 'A value needs at least one witness: an image id or a receipt item id from the evidence below.',
  ].join('\n');
  const evidence = [];
  for (const id of params.cited_image_ids ?? []) evidence.push({ kind: 'image', id });
  for (const l of lines) evidence.push({ kind: 'line', id: l.id, text: [l.description, l.part_number ? `part number ${l.part_number}` : null, l.line_date ? `line date ${l.line_date}` : null].filter(Boolean).join('; ') });
  return { system, text, evidence };
}

// The blind task as a file for an external reader: the same question, definition, schema and allowed values, the frames by file
// name and image id, and receipt lines. frames = [{file, image_id}]. Nothing else from the request is carried.
export function buildExportTask({ task, params, frames }) {
  return {
    instructions: task.system, question: task.text, answer_schema: ANSWER_SCHEMA, allowed: Array.isArray(params.allowed) ? params.allowed : null,
    frames, receipt_lines: task.evidence.filter((e) => e.kind === 'line').map((e) => ({ receipt_item_id: e.id, text: e.text })),
    answer_file: 'answer.json', answer_format: { outcome: 'value | not_visible | cannot_tell', value: 'only with outcome value', confidence: '0..1', image_ids: ['frame image ids that show it'], quote: 'what in the evidence shows it' },
  };
}

// Local mirror of fact_doubt_answer_problems (the database re-checks; this keeps a malformed answer from being submitted).
export function validateAnswer(params, answer) {
  const probs = [];
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return ['answer must be an object'];
  const { outcome, value, confidence } = answer;
  if (!OUTCOMES.includes(outcome)) probs.push('outcome must be value|not_visible|cannot_tell|different_measures');
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) probs.push('confidence must be a number');
  else if (confidence < 0 || confidence > 1) probs.push('confidence must be within 0..1');
  const img = answer.image_ids ?? []; const itm = answer.receipt_item_ids ?? [];
  let n = 0;
  if (!Array.isArray(img) || img.some((e) => typeof e !== 'string' || !(params.cited_image_ids ?? []).includes(e))) probs.push('image_ids must be a subset of cited_image_ids'); else n += img.length;
  if (!Array.isArray(itm) || itm.some((e) => typeof e !== 'string' || !(params.cited_receipt_item_ids ?? []).includes(e))) probs.push('receipt_item_ids must be a subset of cited_receipt_item_ids'); else n += itm.length;
  if (answer.quote != null && typeof answer.quote !== 'string') probs.push('quote must be text');
  if (outcome === 'value') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) probs.push('outcome value needs a scalar value');
    else if (typeof value === 'string' && (value.trim() === '' || value.length > 80)) probs.push('value text must be 1..80 characters');
    else if (Array.isArray(params.allowed) && !params.allowed.includes(String(value))) probs.push('value must be one of params.allowed');
    if (n === 0) probs.push('a value needs a witness: an image id or a receipt item id');
  } else if (value != null) probs.push('value only with outcome value');
  if (outcome === 'different_measures') {
    if (params.doubt_form !== 'reader_pair') probs.push('different_measures is only for a reader_pair doubt');
    if (!String(answer.quote ?? '').trim()) probs.push('different_measures needs a quote');
  }
  return probs;
}

// Strip the model's JSON down to the closed answer's fields (extra fields are dropped, nothing is coerced).
export function closedAnswer(parsed) {
  const out = {};
  for (const k of ['outcome', 'value', 'confidence', 'image_ids', 'receipt_item_ids', 'quote']) if (parsed && parsed[k] !== undefined) out[k] = parsed[k];
  return out;
}

export const isUuid = (s) => typeof s === 'string' && UUID.test(s);

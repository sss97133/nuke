// Ledger context for image verdicts (pure, dependency-free; see
// supabase/migrations/20261022213000_vehicle_context_packet.sql for the SQL side).
//
// An image is interpreted IN THE CONTEXT of the vehicle's ledger: identity, description
// claims, receipts, timeline, sibling photos. A verdict therefore targets a ledger field
// (confirm / contradict / add) instead of filling generic per-image slots.

// Mirrors public.image_document_gate(). Keep the two regexes identical.
export const DOCUMENT_NAME_RE = /(^|[^a-z])(doc|docs|document|receipt|invoice|scan|title|buildsheet|build_sheet|window[-_ ]?sticker|carfax|repair[-_ ]?order|books|log|manual|page)([^a-z]|$)/i;
const DOCUMENT_LABELS = new Set(['document', 'paper', 'receipt', 'text', 'handwriting', 'invoice']);
export const DOCUMENT_SCENES = new Set(['receipt_document', 'data_plate', 'spreadsheet']);
export const CLAIM_KINDS = new Set(['condition', 'work_record', 'provenance', 'specification']);
export const ACTIONS = new Set(['confirm', 'contradict', 'add']);

/** Document gate: runs BEFORE any condition/damage call. */
export function documentGate({ file_name, image_url, apple_ml_labels, scene_type } = {}) {
  if (scene_type && DOCUMENT_SCENES.has(scene_type)) return true;
  if (DOCUMENT_NAME_RE.test(`${file_name || ''} ${image_url || ''}`)) return true;
  return (apple_ml_labels || []).some((l) => DOCUMENT_LABELS.has(String(l).toLowerCase()));
}

/** Does a confirm/contradict ref resolve on this packet? (mirrors the SQL writer's check) */
export function resolvesOnLedger(target, packet) {
  if (!target) return false;
  if (target.ref === 'description') {
    return typeof target.excerpt === 'string' && target.excerpt.length >= 8
      && (packet?.description || '').includes(target.excerpt);
  }
  const ids = [
    ...(packet?.field_claims || []).map((c) => c.id),
    ...(packet?.receipt_items || []).map((r) => r.id),
    ...(packet?.timeline || []).map((t) => t.id),
  ];
  return ids.includes(target.ref);
}

/**
 * Validate one ledger claim derived from an image verdict. Returns a list of errors.
 * claim: { image_id, vehicle_id, kind, scene_type, ledger_target:{field, action, ref?, excerpt?},
 *          value, confidence, baseline? }
 */
export function ledgerClaimErrors(claim, packet, imageRow = {}) {
  const errs = [];
  if (!CLAIM_KINDS.has(claim?.kind)) errs.push(`kind not allowed: ${claim?.kind}`);
  const t = claim?.ledger_target;
  if (!t || !t.field) errs.push('ledger_target.field required');
  if (!t || !ACTIONS.has(t.action)) errs.push(`ledger_target.action must be confirm|contradict|add: ${t?.action}`);
  if (t && (t.action === 'confirm' || t.action === 'contradict') && !resolvesOnLedger(t, packet)) {
    errs.push(`ledger_target.ref does not resolve on the ledger: ${t.ref}`);
  }
  if (claim?.kind === 'condition') {
    if (documentGate({ ...imageRow, scene_type: claim.scene_type })) errs.push('document gate: no condition claim on a document');
    // Condition is vehicle-relative only when a Y/M/M baseline exists; otherwise say so.
    if (!packet?.condition_baseline && claim.baseline !== null) errs.push('no Y/M/M baseline: condition claim must carry baseline:null (absolute, not relative)');
    if (!packet?.condition_baseline && claim?.value?.relative_to_ymm && claim.value.relative_to_ymm !== 'unknown') {
      errs.push('no Y/M/M baseline: relative_to_ymm must be "unknown"');
    }
  }
  if (typeof claim?.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) errs.push('confidence must be 0–1');
  return errs;
}

/** Compact text form of the packet for a prompt (bounded). */
export function packetPromptText(packet, maxChars = 2000) {
  if (!packet) return '';
  const id = packet.identity || {};
  const parts = [
    `VEHICLE: ${[id.year, id.make, id.model, id.trim].filter(Boolean).join(' ')}${id.vin ? ` VIN ${id.vin}` : ''}`,
    packet.description ? `DESCRIPTION (seller claims, not truth): ${packet.description}` : null,
    (packet.receipt_items || []).length ? `RECEIPTS: ${packet.receipt_items.slice(0, 20).map((r) => `${r.date || '?'} ${r.description || ''}`).join('; ')}` : 'RECEIPTS: none on file',
    `TIMELINE: ${(packet.timeline || []).map((t) => `${t.event_type}@${t.platform || '?'}`).join(', ') || 'none'}`,
    `Y/M/M CONDITION BASELINE: ${packet.condition_baseline ? JSON.stringify(packet.condition_baseline) : 'none (condition is absolute, not relative)'}`,
  ].filter(Boolean);
  const s = parts.join('\n');
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

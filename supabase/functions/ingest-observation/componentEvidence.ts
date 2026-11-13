/** Existing observation intake: bind a retained reading to a registered component
 * position. This does not analyse pixels, certify a fact, or identify a physical
 * unit across replacement. PostgreSQL rechecks custody in the insert transaction. */
export const COMPONENT_PRESENCE_PROPERTY = "component_visible_present";
export const COMPONENT_READING_METHOD = "retained_component_reading_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
export interface ComponentReadingSelector {
  source_observation_id: string;
  image_id: string;
  source_url: string;
  path: string[];
  value_sha256: string;
  quote: string;
  absence?: { scope: string; view_coverage_quote: string; absence_quote: string; bbox: number[] };
}
export interface ComponentEvidenceInput {
  component_key?: unknown;
  component_reading?: unknown;
  property_key?: unknown;
  descriptor_key?: unknown;
  vehicle_id?: unknown;
  kind?: unknown;
  agent_inferred?: unknown;
  defer_analysis?: unknown;
  structured_data?: unknown;
}
export interface ComponentSubject { subject_id: string; subject_key: string; display_name: string; is_active: boolean; domain: string; category: string }
export interface ComponentSource {
  id: string; vehicle_id: string; is_superseded: boolean; extraction_method: string;
  source_url: string; observed_at: string; structured_data: ObjectValue;
}
export interface ComponentImage {
  id: string; vehicle_id: string; image_url: string; is_sensitive?: boolean;
  is_document?: boolean; redaction_level?: string | null;
}
export type ComponentEvidenceResult = { ok: false; reason: string } | {
  ok: true; subjectId: string; sourceId: string; imageId: string; sourceUrl: string;
  observedAt: string; structuredData: ObjectValue;
};

export function componentReadingSelector(value: unknown): ComponentReadingSelector | null {
  if (!object(value) || Object.keys(value).some(k => !["source_observation_id", "image_id", "source_url", "path", "value_sha256", "quote", "absence"].includes(k)) ||
    !id(value.source_observation_id) || !id(value.image_id) || !text(value.source_url, 4096) ||
    !text(value.value_sha256, 64) || !SHA.test(value.value_sha256) || !text(value.quote, 2000) ||
    !Array.isArray(value.path) || value.path.some(p => typeof p !== "string")) return null;
  const path = value.path as string[];
  if (!(path.length === 3 && ["components_seen", "damage_localized"].includes(path[0]) &&
    /^(0|[1-9][0-9]{0,2})$/.test(path[1]) && path[2] === "label") &&
    !(path.length === 1 && path[0] === "agent_notes")) return null;
  if (value.absence !== undefined) {
    const a = value.absence;
    if (!object(a) || Object.keys(a).some(k => !["scope", "view_coverage_quote", "absence_quote", "bbox"].includes(k)) ||
      !text(a.scope, 300) || !text(a.view_coverage_quote, 500) || !text(a.absence_quote, 500) || !bbox(a.bbox)) return null;
  }
  return value as unknown as ComponentReadingSelector;
}
function bbox(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 4 && v.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 999) &&
    v[0] < v[2] && v[1] < v[3];
}
async function sha(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,"0")).join("");
}
function explicitAbsence(source: string, label: string, coverage: string, absence: string): boolean {
  const sentences = source.split(/(?<=[.!?])\s+|\r?\n/).map(s => s.trim());
  if (!sentences.includes(coverage.trim()) || !sentences.includes(absence.trim())) return false;
  const suffix = (s: string) => s.toLowerCase().startsWith(label.toLowerCase()) ? s.slice(label.length).trim().toLowerCase() : "";
  return /^(?:(?:position|mounting location|tray|location|area) )?(?:is|are) (?:fully|entirely|completely) (?:visible|exposed|in view)(?: from (?:above|below|front|rear|left|right))?\.?$/.test(suffix(coverage.trim())) &&
    /^(?:is (?:absent|missing|not present)|has been removed)\.?$/.test(suffix(absence.trim()));
}

export async function prepareComponentEvidence(input: ComponentEvidenceInput, subject: ComponentSubject | null,
  source: ComponentSource | null, image: ComponentImage | null, sourceWitness: boolean): Promise<ComponentEvidenceResult> {
  const fail = (reason: string): ComponentEvidenceResult => ({ ok: false, reason });
  const selector = componentReadingSelector(input.component_reading);
  if (!selector || !text(input.component_key, 160) || !id(input.vehicle_id) || input.kind !== "condition" ||
    input.agent_inferred !== true || input.defer_analysis !== true || !object(input.structured_data)) return fail("invalid_component_reading");
  if (!subject || subject.is_active !== true || subject.subject_key !== input.component_key) return fail("unknown_component_key");
  if (!source || source.id.toLowerCase() !== selector.source_observation_id.toLowerCase() ||
    source.vehicle_id !== input.vehicle_id || source.is_superseded !== false ||
    source.extraction_method !== "reviewed_image_analysis_v1" || !object(source.structured_data) ||
    source.source_url !== selector.source_url || !Number.isFinite(Date.parse(source.observed_at))) return fail("component_source_unavailable");
  if (!image || image.id.toLowerCase() !== selector.image_id.toLowerCase() || image.vehicle_id !== input.vehicle_id ||
    image.image_url !== selector.source_url || image.is_sensitive === true || image.is_document === true ||
    ![undefined, null, "none"].includes(image.redaction_level) || !sourceWitness) return fail("component_image_unavailable");
  let selected: unknown = source.structured_data;
  for (const key of selector.path) {
    if (selected === null || typeof selected !== "object" || !Object.prototype.hasOwnProperty.call(selected, key)) return fail("component_source_selector_changed");
    selected = (selected as ObjectValue)[key];
  }
  if (typeof selected !== "string" || !selected.includes(selector.quote) || await sha(selected) !== selector.value_sha256) return fail("component_source_selector_changed");
  const data = input.structured_data;
  if (Object.keys(data).some(k => ![COMPONENT_PRESENCE_PROPERTY, "component_receipt_candidates"].includes(k))) return fail("unsupported_component_payload");
  const presence = data[COMPONENT_PRESENCE_PROPERTY];
  if (input.property_key === COMPONENT_PRESENCE_PROPERTY) {
    if (typeof presence !== "boolean" || input.descriptor_key !== undefined) return fail("invalid_component_presence");
    if (presence) {
      if (selector.path[0] !== "components_seen" || selector.absence !== undefined) return fail("presence_requires_component_sighting");
    } else {
      const a = selector.absence;
      if (selector.path[0] !== "agent_notes" || !a || !selected.includes(a.view_coverage_quote) || !selected.includes(a.absence_quote) ||
        a.scope !== subject.subject_key || !explicitAbsence(selected, subject.display_name, a.view_coverage_quote, a.absence_quote))
        return fail("absence_requires_explicit_scoped_reading");
    }
  } else if (input.property_key !== undefined || !text(input.descriptor_key, 200) ||
    !input.descriptor_key.startsWith(`${subject.domain}.${subject.category}.`) || Object.hasOwn(data, COMPONENT_PRESENCE_PROPERTY) ||
    selector.path[0] !== "damage_localized" || selector.absence !== undefined) return fail("invalid_component_condition");
  const candidates = data.component_receipt_candidates ?? [];
  if (!Array.isArray(candidates) || candidates.length > 10 || candidates.some(c => !object(c) ||
    Object.keys(c).some(k => !["receipt_item_id", "receipt_id", "link_id", "source_table", "source_id", "source_url_sha256", "description", "part_number", "association_basis"].includes(k)) ||
    !id(c.receipt_item_id) || !id(c.receipt_id) || !id(c.link_id) || !id(c.source_id) ||
    !["vehicle_documents", "vehicle_images"].includes(String(c.source_table)) ||
    typeof c.source_url_sha256 !== "string" || !SHA.test(c.source_url_sha256) || !text(c.description, 2000) || !text(c.part_number, 100) ||
    !["same_printed_part_number", "same_component_role"].includes(String(c.association_basis)))) return fail("invalid_component_receipt_candidates");
  if (new Set(candidates.map(c => String(c.receipt_item_id).toLowerCase())).size !== candidates.length) return fail("duplicate_component_receipt_candidate");
  const sourceComponent = selector.path.length === 3
    ? (source.structured_data[selector.path[0]] as ObjectValue[])?.[Number(selector.path[1])] : null;
  const region = sourceComponent && bbox(sourceComponent.bbox) ? sourceComponent.bbox : selector.absence?.bbox ?? null;
  if (!region) return fail("component_view_region_required");
  return { ok: true, subjectId: subject.subject_id, sourceId: source.id, imageId: image.id,
    sourceUrl: image.image_url, observedAt: source.observed_at,
    structuredData: { ...data, image_id: image.id, property_key: input.property_key ?? null,
      component_ref: { subject_id: subject.subject_id, key: subject.subject_key, identity_basis: "position_only" },
      component_reading: { ...selector, source_observation_id: source.id, image_id: image.id, bbox: region,
        source_role: "attributed_retained_image_reading", clock_basis: "source_analysis_time", physical_unit_identity: "unestablished" },
      component_receipt_candidates: candidates } };
}

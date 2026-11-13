import type { FieldProvenance } from './hooks/useFieldProvenance';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A reviewed physical reading remains attributed testimony. It does not change
 * the vehicle column or promote an unregistered property into canonical state. */
export const PHYSICAL_READING_ROLES = {
  engine_size: 'nominal_engine_displacement',
  transmission: 'identified_transmission_housing',
  drivetrain: 'visible_drivetrain_layout',
  mileage: 'odometer_display',
  factory_color: 'factory_paint_code',
  appearance: 'visible_exterior_appearance',
} as const;
export type PhysicalReadingField = keyof typeof PHYSICAL_READING_ROLES;
const PHYSICAL_READING_RELATIONS: Record<PhysicalReadingField, readonly string[]> = {
  engine_size: ['direct_code'], transmission: ['direct_code', 'component_inference'],
  drivetrain: ['direct_visual'], mileage: ['direct_visual'], factory_color: ['direct_code'],
  appearance: ['direct_visual'],
};
export const PHYSICAL_READING_METHOD = 'interactive_physical_source_review_v1';
export function physicalRecordedValue(vehicleId: string, field: PhysicalReadingField, provenance?: FieldProvenance | null):
  { status: 'absent' | 'unavailable' | 'conflict'; value?: never; note?: never }
  | { status: 'resolved'; value: string; note: string } {
  if (!provenance) return { status: 'absent' };
  if (provenance.vehicle_id !== vehicleId || provenance.field !== field
    || (provenance.coverage && provenance.coverage.status !== 'complete_current_reader')) return { status: 'unavailable' };
  const rows = (provenance.image_observations || []).filter(o => {
    const citation = o as typeof o & { witness_id?: string; witness_role?: string; source_url?: string };
    return o.extraction_method === PHYSICAL_READING_METHOD && o.claim_role === PHYSICAL_READING_ROLES[field]
      && o.is_inferred === true && typeof o.agent_model === 'string' && !!o.agent_model.trim()
      && UUID.test(o.image_id) && UUID.test(o.observation_id) && UUID.test(citation.witness_id || '')
      && citation.witness_role === 'derived' && citation.source_url === o.image_url
      && /^https?:\/\//.test(o.image_url) && o.source_family === `image:${o.image_id}`
      && PHYSICAL_READING_RELATIONS[field].includes(o.visual_relation || '')
      && typeof o.value === 'string' && !!o.value.trim() && o.value.length <= 160
      && typeof o.limitation === 'string' && !!o.limitation.trim();
  });
  if (!rows.length) return { status: 'absent' };
  // Different active readings are a disagreement, never a "latest wins" guess.
  const values = [...new Set(rows.map(o => o.value!.trim()))];
  if (values.length !== 1) return { status: 'conflict' };
  const value = values[0];
  if (field === 'mileage') {
    // Units belong to the source reading. A bare number cannot imply miles.
    const reading = /^(\d+(?:\.\d+)?) (?:miles|km) shown$/.exec(value);
    if (!reading || !Number.isFinite(Number(reading[1])) || Number(reading[1]) >= 10000000) return { status: 'unavailable' };
  }
  return { status: 'resolved', value, note: [...new Set(rows.map(o => o.limitation!))].join(' ') };
}
export type SourceValue = string | number | string[];
export type StructuredClaim = {
  property_key: string; property_id: string; observation_id: string; label?: string;
  value: SourceValue; unit: string | null; source_url: string | null;
  observed_at: string | null; ingested_at: string | null;
  image_id: string | null; image_url: string | null;
  evidence_state: 'reported' | 'interpreted' | 'disputed';
  measurement_scope: 'one_image_reading' | 'attributed_source_claim';
  mechanical_verification: 'unestablished';
  alternative_readings?: Array<{ observation_id: string; value: SourceValue; agent_model?: string | null }>;
  qualifiers?: { claim_role?: string; current_configuration_status?: string; factory_configuration_status?: string;
    observed_at_basis?: string; limitation?: string };
};
export type SourceClaimPage = {
  claims: StructuredClaim[]; nextAfter: string | null;
  unresolved: Array<{ property_key: string; reason: string }>;
};
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const valueIsValid = (v: unknown, key: string): v is SourceValue => typeof v === 'string'
  || (typeof v === 'number' && Number.isFinite(v))
  || (key === 'image_spid_rpo_codes' && Array.isArray(v) && v.length > 0 && v.length <= 120
    && v.every(c => typeof c === 'string' && /^[A-Z0-9]{3}$/.test(c)) && new Set(v).size === v.length);

/** Reject incomplete/unqualified replies rather than rendering their numbers as proof. */
export function readProfileSourcePage(input: unknown, vehicleId: string): SourceClaimPage {
  const model = record(input);
  if (!model || model.vehicle_id !== vehicleId || model.schema_version !== 'vehicle_data_model_v1'
    || model.typed_claims_status !== 'current_registered_scope_read' || !Array.isArray(model.typed_claims)
    || model.typed_claims.length > 200 || !Array.isArray(model.unresolved_properties)) throw Error('Unavailable source claims');
  const claims = model.typed_claims as StructuredClaim[];
  if (!claims.every(c => c && /^[a-z][a-z0-9_]*$/.test(c.property_key)
    && UUID.test(c.property_id) && UUID.test(c.observation_id) && valueIsValid(c.value, c.property_key)
    && (c.unit === null || typeof c.unit === 'string') && (c.label == null || typeof c.label === 'string')
    && (c.observed_at === null || typeof c.observed_at === 'string')
    && (c.ingested_at === null || typeof c.ingested_at === 'string')
    && ['reported', 'interpreted', 'disputed'].includes(c.evidence_state) && c.mechanical_verification === 'unestablished'
    && c.measurement_scope === (c.property_key.startsWith('image_') ? 'one_image_reading' : 'attributed_source_claim')
    && (!c.property_key.startsWith('image_') || (typeof c.image_id === 'string' && UUID.test(c.image_id)))
    && (!c.qualifiers || (typeof c.qualifiers === 'object'
      && ['claim_role', 'current_configuration_status', 'factory_configuration_status', 'observed_at_basis', 'limitation']
        .every(key => c.qualifiers?.[key as keyof NonNullable<StructuredClaim['qualifiers']>] == null
          || typeof c.qualifiers?.[key as keyof NonNullable<StructuredClaim['qualifiers']>] === 'string')))
    && (c.alternative_readings == null || (Array.isArray(c.alternative_readings)
      && c.alternative_readings.every(a => a && UUID.test(a.observation_id) && valueIsValid(a.value, c.property_key)))))) {
    throw Error('Invalid source claim');
  }
  if (new Set(claims.map(c => c.observation_id)).size !== claims.length) throw Error('Repeated source claim');
  const page = record(model.claim_page);
  if (!page || page.reader !== 'registered_profile_source_claims_v1' || typeof page.has_more !== 'boolean'
    || (page.has_more ? typeof page.next_after !== 'string' || !UUID.test(page.next_after)
      || claims[claims.length - 1]?.observation_id !== page.next_after : page.next_after !== null)) throw Error('Invalid source page');
  const unresolved = model.unresolved_properties as SourceClaimPage['unresolved'];
  if (!unresolved.every(u => u && typeof u.property_key === 'string' && typeof u.reason === 'string')) throw Error('Invalid source refusal');
  return { claims, nextAfter: page.has_more ? page.next_after as string : null, unresolved };
}
export const sourceValueText = (value: SourceValue) => Array.isArray(value) ? value.join(', ') : String(value);

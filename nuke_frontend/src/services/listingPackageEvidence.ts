type Row = Record<string, any>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type ListingAssessment = {
  method: string; vehicle_id: string;
  market: { status: string; records?: Array<{ sourceUrl: string; amount: number; eventAt: string }>; statistics?: { sold_count: number; median: number | null }; receipt?: { currency?: string } };
  class: { status: string; configuration_specific: { eligible: boolean } };
  commentary: { status: string; records?: Array<{ observation_id: string; source_url: string; quote: string; statement_kind: string; subject_scope: string }>;
    page?: { has_more: boolean }; exclusions?: unknown[] };
  photo_audit: { status: string; coverage: string; condition: string; has_more?: boolean;
    records?: Array<{ image_id: string; source_url: string }> };
  attestations: Array<{ observation_id: string; statement: string; source: { name?: string; relationship?: string } }>;
  listing: { assertions: ListingAssertion[] };
  unresolved_fields: Array<{ field: string; reason: string }>;
};
export type ListingAssertion = { field: string; value: string | number; statement: string; observation_ids: string[];
  sources: Array<{ observation_id: string; source_url?: string | null }> };

export function assertVehicleAssessment(input: unknown, vehicleId: string): asserts input is ListingAssessment {
  if (!object(input) || input.vehicle_id !== vehicleId || input.method !== 'evidence_qualified_vehicle_assessment_v1'
    || input.class?.configuration_specific?.eligible !== false || !Array.isArray(input.listing?.assertions)
    || !Array.isArray(input.unresolved_fields) || !Array.isArray(input.attestations)
    || !['market', 'class', 'commentary', 'photo_audit'].every(s => object(input[s]) && typeof input[s].status === 'string')) {
    throw new Error('Vehicle evidence assessment is unavailable.');
  }
}

/** The v1 package deliberately asserts only attributed identity. Older raw-column
 * packages and accidental mechanical promotions cannot silently autofill. */
export function assertListingPackageEvidence(input: unknown, vehicleId: string): asserts input is Row {
  if (object(input)) assertVehicleAssessment(input.assessment, vehicleId);
  if (!object(input) || !object(input.assessment) || input.assessment.vehicle_id !== vehicleId
    || input.assessment.method !== 'evidence_qualified_vehicle_assessment_v1'
    || input.assessment.class?.configuration_specific?.eligible !== false
    || !['market', 'class', 'commentary', 'photo_audit'].every(s => object(input.assessment[s]) && typeof input.assessment[s].status === 'string')
    || !Array.isArray(input.listing_assertions) || !Array.isArray(input.unresolved_fields)
    || !object(input.identity) || !object(input.listing_content) || !object(input.photos) || !Array.isArray(input.photos.ordered)
    || input.valuation !== null || input.ars_score !== null || input.submission_ready !== false) {
    throw new Error('Evidence-qualified listing package is unavailable.');
  }
  const assertions = input.listing_assertions as ListingAssertion[];
  if (assertions.some(a => !a || !['year', 'make', 'model'].includes(a.field) || typeof a.statement !== 'string'
    || !(['string', 'number'].includes(typeof a.value)) || (typeof a.value === 'number' && !Number.isFinite(a.value))
    || !Array.isArray(a.observation_ids) || !a.observation_ids.length || !a.observation_ids.every(id => UUID.test(id))
    || !Array.isArray(a.sources) || !a.sources.length || a.sources.some(s => !UUID.test(s.observation_id)))
    || new Set(assertions.map(a => a.field)).size !== assertions.length
    || ['vin', 'trim', 'engine_type', 'engine_code', 'displacement', 'transmission', 'drivetrain', 'body_style', 'mileage', 'title_status']
      .some(k => input.identity[k] !== null)
    || input.listing_content.description !== (assertions.map(a => a.statement).join('\n') || null)
    || ['highlights', 'equipment', 'modifications', 'known_flaws', 'recent_service_history', 'documents_on_hand']
      .some(k => input.listing_content[k] !== null)) throw new Error('Unqualified assertions cannot enter listing copy.');
  for (const field of ['year', 'make', 'model']) {
    const a = assertions.find(r => r.field === field);
    if (input.identity[field] !== (a?.value ?? null)) throw new Error('Listing identity and its sources disagree.');
  }
}

export function listingEvidenceSnapshot(pkg: Row) {
  return { assessment: pkg.assessment, listing_assertions: pkg.listing_assertions,
    field_provenance: pkg.field_provenance, unresolved_fields: pkg.unresolved_fields,
    contributor_evidence: pkg.contributor_evidence };
}

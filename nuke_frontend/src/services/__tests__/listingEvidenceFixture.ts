export const VEHICLE = '10000000-0000-4000-8000-000000000001';
export const OTHER = '10000000-0000-4000-8000-000000000002';
export const SOURCE = '20000000-0000-4000-8000-000000000001';
export function fixture(id = VEHICLE) {
  const assertions = [{ field: 'make', value: 'Pontiac', statement: 'Source-reported make: Pontiac.', observation_ids: [SOURCE],
    sources: [{ observation_id: SOURCE, source_url: 'https://example.test/source' }] }];
  return { platform: 'bat', assessment: { vehicle_id: id, method: 'evidence_qualified_vehicle_assessment_v1',
    market: { status: 'unavailable', records: [] }, class: { status: 'unresolved', configuration_specific: { eligible: false } },
    commentary: { status: 'retained_candidate_interpretations', records: [{ observation_id: SOURCE,
      source_url: 'https://bringatrailer.com/listing/fixture/', quote: 'Is this an SD455?', statement_kind: 'question', subject_scope: 'vehicle' }] },
    photo_audit: { status: 'retained_gallery_review', coverage: 'unknown', condition: 'not_assessed', records: [] },
    listing: { assertions }, unresolved_fields: [{ field: 'engine_configuration', reason: 'mechanical_acceptance_rule_not_established' }],
    attestations: [{ observation_id: SOURCE, statement: 'I believe it is an SD455.', source: { name: 'Owner', relationship: 'owner' } }] },
    listing_assertions: assertions, unresolved_fields: [{ field: 'engine_configuration', reason: 'mechanical_acceptance_rule_not_established' }],
    identity: { year: null, make: 'Pontiac', model: null, vin: null, trim: null, engine_type: null, engine_code: null,
      displacement: null, transmission: null, drivetrain: null, body_style: null, mileage: null, title_status: null },
    listing_content: { title: 'Vehicle — identity evidence pending', description: 'Source-reported make: Pontiac.', highlights: null,
      equipment: null, modifications: null, known_flaws: null, recent_service_history: null, documents_on_hand: null },
    photos: { count: 0, hero_image: null, zones_covered: [], zones_missing: [], ordered: [] },
    valuation: null, ars_score: null, tier: null, submission_ready: false, market_context: {}, submission_fields: null,
    contributor_evidence: { status: 'available', testimony: [{ observation_id: SOURCE, statement: 'I believe it is an SD455.' }] },
    field_provenance: assertions };
}

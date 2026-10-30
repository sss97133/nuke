import { parseClaimResponse, type CommentRow } from './commentRefinery.ts';
import { COMMENT_VERSION } from '../batch-comment-discovery/deriveComment.ts';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(object) : [];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clock = (v: unknown): number => typeof v === 'string' ? Date.parse(v) : NaN;
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, records: [] as Row[], exclusions: [reason] });
async function bounded(request: any) {
  return await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(8000)) : request);
}

/** Current source claims, with the supplying reader's scope and continuation. */
export function qualifyAssessmentClaims(input: unknown, vehicleId: string) {
  const model = Array.isArray(input) && input.length === 1 ? input[0] : null;
  if (!object(model) || model.vehicle_id !== vehicleId || model.schema_version !== 'vehicle_data_model_v1'
    || model.typed_claims_status !== 'current_registered_scope_read' || !Array.isArray(model.typed_claims)
    || !object(model.claim_page) || model.claim_page.reader !== 'registered_profile_source_claims_v1'
    || typeof model.claim_page.has_more !== 'boolean') return unavailable('source_reader_unavailable');
  const claims = rows(model.typed_claims);
  if (claims.length !== model.typed_claims.length || claims.length > 200 || claims.some(c =>
    !UUID.test(c.observation_id) || !UUID.test(c.property_id) || !UUID.test(c.source_id)
    || !['reported', 'interpreted', 'disputed'].includes(c.evidence_state)
    || c.mechanical_verification !== 'unestablished'
    || (!['string', 'number'].includes(typeof c.value) && !(c.property_key === 'image_spid_rpo_codes' && Array.isArray(c.value)))
    || (typeof c.value === 'number' && !finite(c.value)))) return unavailable('invalid_source_claim_receipt');
  return { status: 'available' as const, records: claims, exclusions: rows(model.unresolved_properties),
    page: model.claim_page, complete: model.claim_page.has_more === false };
}

const IDENTITY = { year: 'year', make: 'make', model: 'model' } as const;
const MECHANICAL = new Set(['vin', 'trim', 'body_style', 'engine_configuration', 'engine_displacement_l',
  'engine_family_label', 'transmission_type', 'drivetrain_layout', 'mileage_miles']);

/** An attributed statement is not a mechanical acceptance rule. Never promote
 * received documents, badge text, raw columns or question completion here. */
export function qualifyListingAssertions(claimRead: ReturnType<typeof qualifyAssessmentClaims>) {
  const assertions: Row[] = [];
  const supported: Row = {};
  const unresolved: Row[] = [];
  for (const [field, property] of Object.entries(IDENTITY)) {
    const candidates = claimRead.records.filter(c => c.property_key === property && c.evidence_state === 'reported');
    const values = new Set(candidates.map(c => JSON.stringify(c.value)));
    const value = candidates[0]?.value;
    const valid = field === 'year' ? Number.isInteger(value) && value >= 1886 && value <= new Date().getUTCFullYear() + 1
      : typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
    if (values.size !== 1 || !valid || claimRead.status !== 'available' || !claimRead.complete
      || claimRead.records.some(c => c.property_key === property && c.evidence_state === 'disputed')) {
      supported[field] = null; unresolved.push({ field, reason: 'no_undisputed_attributed_identity_claim' }); continue;
    }
    supported[field] = value;
    assertions.push({ field, value, statement: `Source-reported ${field}: ${value}.`, evidence_state: 'reported',
      observation_ids: candidates.map(c => c.observation_id), source_ids: candidates.map(c => c.source_id),
      sources: candidates.map(c => ({ observation_id: c.observation_id, source_url: c.source_url,
        observed_at: c.observed_at, ingested_at: c.ingested_at, extraction_method: c.extraction_method })) });
  }
  for (const field of MECHANICAL) unresolved.push({ field, reason: 'mechanical_acceptance_rule_not_established',
    observation_ids: claimRead.records.filter(c => c.property_key === field).map(c => c.observation_id) });
  if ('page' in claimRead && claimRead.page.has_more) unresolved.push({ field: '*', reason: 'source_page_incomplete', continuation: claimRead.page });
  return { supported, assertions, unresolved };
}

/** This is a source-qualified market population, not an appraisal of the subject. */
export function qualifyAssessmentMarket(input: unknown, expectedQuery?: Row) {
  if (!object(input) || input.error) return unavailable('market_reader_unavailable');
  const receipt = input.receipt;
  if (!object(receipt) || receipt.method !== 'source_sale_price_midrank_v1' || receipt.coverage?.complete !== true
    || receipt.cohort?.complete !== true || !Array.isArray(receipt.eligible)
    || !object(input.stats) || !Number.isInteger(input.stats.sold_count)
    || input.stats.sold_count !== receipt.eligible.length || receipt.minimum_sales !== 10
    || receipt.currency !== 'USD'
    || receipt.price_basis_rule !== 'bat_published_result_fee_separate_v1'
    || (expectedQuery && (!object(input.query) || ['year', 'make', 'model'].some(k => input.query[k] !== expectedQuery[k])))
    || (input.stats.sold_count < 10 && ['median', 'p10', 'p90', 'min', 'max', 'avg'].some(k => input.stats[k] != null))) {
    return unavailable('market_qualification_unestablished');
  }
  if (receipt.eligible.some((r: Row) => !object(r) || !UUID.test(r.vehicleId) || !finite(r.amount) || r.amount <= 0
    || r.outcome !== 'sold' || r.currency !== receipt.currency || !/^[a-f0-9]{64}$/.test(r.sourceSha256)
    || !Number.isFinite(clock(r.knownAt)) || !Number.isFinite(clock(r.eventAt))
    || !['per_read_inline_hash_parser', 'producer_attested_archived_hash_parser'].includes(r.sourceVerification)
    || r.priceBasis !== 'published_bid_excluding_fees'
    || typeof r.sourceUrl !== 'string' || !/^https:\/\/(www\.)?bringatrailer\.com\/listing\/[^/?#]+\/$/.test(r.sourceUrl))) {
    return unavailable('invalid_market_source_receipt');
  }
  return { status: 'available' as const, scope: 'recorded_ymm_source_qualified_sale_context',
    query: input.query,
    subject_configuration_membership: 'unestablished', vehicle_specific_value: null,
    statistics: input.stats, records: receipt.eligible, receipt, source_context: input.source_context ?? null,
    exclusions: receipt.exclusions ?? {}, limitations: ['No condition or configuration adjustment is established.',
      'Recorded source-label membership does not prove the subject belongs to a mechanical comparison class.'] };
}

/** Revalidate retained atoms against their actual current source and the
 * existing parser. Questions and model-level claims never become car facts. */
export function qualifyAssessmentCommentary(atoms: Row[], comments: Row[], vehicleId: string) {
  const byId = new Map(comments.map(c => [c.id, c]));
  const records: Row[] = []; const exclusions: Row[] = [];
  for (const atom of atoms) {
    const c = byId.get(atom.source_comment_id); const s = atom.structured_data;
    const refuse = (reason: string) => exclusions.push({ observation_id: atom.id, reason });
    if (!c || c.vehicle_id !== vehicleId || atom.vehicle_id !== vehicleId || atom.is_superseded === true
      || atom.extraction_method !== 'comment_refinery_atom' || !object(s) || s.analysis_kind !== 'comment_atom'
      || s.prompt_version !== COMMENT_VERSION || s.source_comment_id !== c.id || atom.source_url !== c.source_url
      || typeof c.source_url !== 'string' || !/^https:\/\/(www\.)?bringatrailer\.com\/listing\//.test(c.source_url)
      || clock(atom.observed_at) !== clock(c.posted_at) || !Number.isFinite(clock(c.posted_at))
      || clock(c.posted_at) > Date.now() || !Number.isFinite(clock(atom.ingested_at)) || clock(atom.ingested_at) > Date.now()) {
      refuse('source_or_method_unqualified'); continue;
    }
    const parsed = parseClaimResponse(JSON.stringify([{ comment_index: 1, claims: [{ ...s,
      quote: s.source_quote_actual, confidence: s.model_confidence,
      temporal_anchor: s.temporal_anchor_basis === 'comment_posted_at' ? 'current' : s.temporal_anchor === 'unknown' ? null : s.temporal_anchor,
    }] }]), [c as CommentRow]);
    const qualified = parsed.claims[0];
    if (parsed.parseErrors.length || !qualified || s.source_quote_offset_unit !== 'utf16_code_units'
      || qualified.source_quote_start !== s.source_quote_start || qualified.source_quote_end !== s.source_quote_end) {
      refuse('current_source_does_not_support_retained_atom'); continue;
    }
    records.push({ observation_id: atom.id, comment_id: c.id, source_url: c.source_url,
      observed_at: atom.observed_at, ingested_at: atom.ingested_at, method: COMMENT_VERSION,
      claim_type: qualified.claim_type, category: qualified.category, subject_scope: qualified.subject_scope,
      statement_kind: qualified.statement_kind, epistemic_status: qualified.epistemic_status,
      action_status: qualified.action_status, value: qualified.proposed_value, quote: qualified.source_quote_actual,
      confidence: qualified.confidence, qualification: 'candidate_interpretation', mechanical_verification: 'unestablished' });
  }
  const groups = new Map<string, { target: string; statement_kind: string; source_comment_ids: Set<string> }>();
  for (const r of records) {
    const key = `${r.claim_type}:${r.statement_kind}`;
    const group = groups.get(key) ?? { target: r.claim_type, statement_kind: r.statement_kind, source_comment_ids: new Set<string>() };
    group.source_comment_ids.add(r.comment_id); groups.set(key, group);
  }
  return { status: records.length ? 'retained_candidate_interpretations' : 'not_assessed', records, exclusions,
    distributions: [...groups.values()].map(g => ({ ...g, source_comment_ids: [...g.source_comment_ids],
      source_comments: g.source_comment_ids.size })),
    population: 'returned_current_atoms_only', unscored_comment_population: 'not_enumerated',
    condition_or_value_effect: 'unestablished', rule: 'Questions are questions; repeated statements do not establish independently observed defects.' };
}

export async function readVehicleAssessment(db: any, vehicle: Row, options: {
  photos?: Row[]; photoHasMore?: boolean; contributorEvidence?: any; claimAfter?: string; commentAfter?: string; photoAfter?: string;
} = {}) {
  const vehicleId = vehicle.id;
  if (!UUID.test(vehicleId) || (options.claimAfter && !UUID.test(options.claimAfter)) || (options.commentAfter && !UUID.test(options.commentAfter))
    || (options.photoAfter && !UUID.test(options.photoAfter))) {
    throw new Error('Invalid assessment scope');
  }
  const asOf = new Date().toISOString();
  const profile = bounded(db.rpc('get_vehicle_specs', { p_vehicle_ids: [vehicleId], p_include_typed_claims: true,
    p_claim_cursor: options.claimAfter ? { after: options.claimAfter } : {} }));
  const market = Number.isInteger(vehicle.year) && typeof vehicle.make === 'string' && typeof vehicle.model === 'string'
    ? bounded(db.rpc('valuation_by_ymm', { p_year: vehicle.year, p_make: vehicle.make, p_model: vehicle.model,
      p_subject_vehicle_id: vehicleId, p_currency: 'USD' })) : Promise.resolve({ data: null, error: 'identity_query_unavailable' });
  let atoms = db.from('vehicle_observations').select('id,vehicle_id,source_comment_id,source_url,observed_at,ingested_at,structured_data,extraction_method,is_superseded')
    .eq('vehicle_id', vehicleId).eq('kind', 'comment').eq('extraction_method', 'comment_refinery_atom').not('is_superseded', 'is', true);
  if (options.commentAfter) atoms = atoms.gt('id', options.commentAfter);
  let photoRequest: any = Promise.resolve({ data: options.photos, error: null });
  if (options.photos === undefined) {
    photoRequest = db.from('vehicle_images').select('id,image_url,vehicle_zone').eq('vehicle_id', vehicleId)
      .eq('vehicle_image_gallery_eligible', true).not('is_sensitive', 'is', true)
      .not('is_document', 'is', true).not('doc_flag', 'is', true);
    if (options.photoAfter) photoRequest = photoRequest.gt('id', options.photoAfter);
    photoRequest = photoRequest.order('id').limit(201);
  }
  const [p, m, a, gallery] = await Promise.allSettled([profile, market, bounded(atoms.order('id').limit(201)), bounded(photoRequest)]);
  const claims = qualifyAssessmentClaims(p.status === 'fulfilled' && !p.value.error ? p.value.data : null, vehicleId);
  const listing = qualifyListingAssertions(claims);
  const qualifiedMarket = qualifyAssessmentMarket(m.status === 'fulfilled' && !m.value.error ? m.value.data : null,
    { year: vehicle.year, make: vehicle.make, model: vehicle.model });
  let commentary: Row = unavailable('comment_reader_unavailable');
  if (a.status === 'fulfilled' && !a.value.error && Array.isArray(a.value.data)) {
    const selected = rows(a.value.data).slice(0, 200);
    const ids = [...new Set(selected.map(r => r.source_comment_id).filter(id => typeof id === 'string' && UUID.test(id)))];
    try {
      const sources = ids.length ? await bounded(db.from('auction_comments')
        .select('id,vehicle_id,comment_text,posted_at,is_seller,source_url').in('id', ids).eq('vehicle_id', vehicleId)) : { data: [], error: null };
      if (!sources.error) commentary = { ...qualifyAssessmentCommentary(selected, rows(sources.data), vehicleId),
        page: { limit: 200, has_more: a.value.data.length > 200, next_after: a.value.data.length > 200 ? selected.at(-1)?.id : null } };
    } catch { /* Preserve the failed reader boundary. */ }
  }
  const photoRows = gallery.status === 'fulfilled' && !gallery.value.error && Array.isArray(gallery.value.data) ? rows(gallery.value.data) : null;
  const photos = photoRows?.slice(0, options.photos ? 600 : 200) ?? [];
  const hasMorePhotos = options.photos ? options.photoHasMore ?? false : (photoRows?.length ?? 0) > 200;
  const photoAudit = { status: photoRows === null ? 'unavailable' : 'retained_gallery_review',
    records: photos.map(p => ({ image_id: p.id, source_url: p.image_url, filing_correctness: 'not_assessed',
      retained_zone: p.vehicle_zone ?? null, zone_qualification: 'unestablished' })),
    exclusions: ['Gallery eligibility does not establish correct filing, full capture coverage or mechanical condition.'],
    coverage: 'unknown', condition: 'not_assessed', has_more: hasMorePhotos,
    page: { limit: options.photos ? 600 : 200, has_more: hasMorePhotos, next_after: hasMorePhotos ? photos.at(-1)?.id : null,
      reader: 'current_gallery_eligible_source_rows' } };
  return { method: 'evidence_qualified_vehicle_assessment_v1', vehicle_id: vehicleId, observed_at: asOf,
    knowledge_mode: 'current_retained_sources', historical_replay: 'not_established_for_this_package',
    market: qualifiedMarket,
    class: { status: 'unresolved', configuration_specific: { eligible: false,
      reasons: ['No cited mechanical acceptance rule establishes installed/factory configuration or a specialized comparison class.'] },
      body_specific: { eligible: false, reasons: ['Current physical body-class qualification remains unestablished.'] },
      records: claims.records.filter(c => MECHANICAL.has(c.property_key)), source_page: 'page' in claims ? claims.page : null,
      exclusions: listing.unresolved },
    commentary, photo_audit: photoAudit, source_claims: claims, listing,
    attestations: options.contributorEvidence?.status === 'available' ? options.contributorEvidence.testimony : [],
    attestation_status: options.contributorEvidence?.status ?? 'not_requested',
    unresolved_fields: listing.unresolved };
}

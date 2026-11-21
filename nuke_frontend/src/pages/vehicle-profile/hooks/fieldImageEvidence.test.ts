import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { bindFacetCitations, hasImageAnalysis, hasImageZone, heroFacetImages, isRelatedFieldImage, relatedFieldImages, referenceFieldImages, webSourceUrl, type EvidenceImage } from './useVehicleImageEvidence';
import { FIELD_TOKEN, facetImageCitations } from './facetImageCitations';
import type { FacetItem } from '../../../kit/types';
import { citedFieldImages, evidenceOrder, type FieldProvenance } from './useFieldProvenance';
const image = (id: string, changes: Partial<EvidenceImage> = {}): EvidenceImage => ({ id, image_url: `https://example.com/${id}.jpg`, thumbnail_url: null, medium_url: null, vehicle_zone: null, angle: null, ai_detected_angle: null, ai_processing_status: 'pending', vision_analyzed_at: null, vision_model_version: null, created_at: null, taken_at: null, source: 'external_import', is_primary: false, is_document: false, is_sensitive: false, is_duplicate: false, is_superseded: false, superseded_by: null, category: 'general', ...changes });
const provenance = (changes: Partial<FieldProvenance> = {}): FieldProvenance => ({ field: 'color', value: 'Silver Pearl', inline_source: 'listing', source_image_url: null, evidence: [], observations: [], ...changes });
describe('field image evidence boundaries', () => {
  it('reuses dossier field owners and keeps current, as-built, conflict-side and examined citations separate', () => {
    expect([FIELD_TOKEN.engine_type, FIELD_TOKEN.engine_size, FIELD_TOKEN.transmission, FIELD_TOKEN.drivetrain, FIELD_TOKEN.color]).toEqual([
      'engine', 'engine', 'transmission', 'drivetrain', 'paint',
    ]);
    expect(FIELD_TOKEN.vin).toBeUndefined();
    const engine = '10000000-0000-4000-8000-000000000001';
    const conflict = '10000000-0000-4000-8000-000000000002';
    const examined = '10000000-0000-4000-8000-000000000003';
    const source = (id: string) => ({ witness: { kind: 'image', id }, value: 'recorded reading' });
    const items = [{ key: 'engine.current.displacement', facet: 'current', status: 'reading', sources: [source(engine)] },
      { key: 'engine.as_built.engine', facet: 'as_built', status: 'conflict', sources: [],
        sides: [{ value: '250', sources: [source(conflict)] }] },
      { key: 'engine.current.bore', facet: 'current', status: 'missing', sources: [], examined: [source(examined)] }] as unknown as FacetItem[];
    const citations = facetImageCitations(items);
    expect(citations.map(c => [c.imageId, c.itemKey, c.facet, c.status, c.relation, c.sideValue])).toEqual([
      [engine, 'engine.current.displacement', 'current', 'reading', 'source', undefined],
      [conflict, 'engine.as_built.engine', 'as_built', 'conflict', 'conflict_side', '250'],
      [examined, 'engine.current.bore', 'current', 'missing', 'examined', undefined],
    ]);
    expect(facetImageCitations([{ ...items[0], sources: [{ witness: { kind: 'observation', id: engine }, url: 'https://example.com/source' }] }] as FacetItem[])).toEqual([]);
  });
  it('binds exact facet citations only to current same-vehicle public gallery rows', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const citations = facetImageCitations([{ key: 'transmission.current.type', facet: 'current', status: 'conflict',
      sources: [{ witness: { kind: 'image', id }, value: 'manual' }] }] as FacetItem[]);
    const current = image(id, { vehicle_id: 'vehicle-a' });
    expect(bindFacetCitations('vehicle-a', citations, [current]).map(x => x.image.id)).toEqual([id]);
    for (const held of [image(id, { vehicle_id: 'vehicle-b' }), image(id, { vehicle_id: 'vehicle-a', is_sensitive: true }),
      image(id, { vehicle_id: 'vehicle-a', is_document: true }), image(id, { vehicle_id: 'vehicle-a', is_duplicate: true }),
      image(id, { vehicle_id: 'vehicle-a', is_superseded: true }), image(id, { vehicle_id: 'vehicle-a', superseded_by: 'replacement' }),
      image(id, { vehicle_id: 'vehicle-a', superseded_by: undefined }),
      image(id, { vehicle_id: 'vehicle-a', image_url: 'file:///private/source.jpg' })]) {
      expect(bindFacetCitations('vehicle-a', citations, [held])).toEqual([]);
    }
    expect(bindFacetCitations('vehicle-a', citations, [image('10000000-0000-4000-8000-000000000099', { vehicle_id: 'vehicle-a' })])).toEqual([]);
  });
  it('keeps as-built and current citations in the drill while the current hero selects current evidence', () => {
    const asBuiltId = '10000000-0000-4000-8000-000000000010';
    const currentId = '10000000-0000-4000-8000-000000000011';
    const source = (id: string) => ({ witness: { kind: 'image', id } });
    const citations = facetImageCitations([
      { key: 'engine.as_built.engine', facet: 'as_built', status: 'established', sources: [source(asBuiltId)] },
      { key: 'engine.current.displacement', facet: 'current', status: 'reading', sources: [source(currentId)] },
    ] as FacetItem[]);
    const bound = bindFacetCitations('vehicle-a', citations, [image(asBuiltId, { vehicle_id: 'vehicle-a' }), image(currentId, { vehicle_id: 'vehicle-a' })]);
    expect(bound).toHaveLength(2);
    expect(heroFacetImages(bound, citations).map(row => row.id)).toEqual([currentId]);
    expect(heroFacetImages(bound.slice(0, 1), citations)).toEqual([]);
    expect(heroFacetImages(bound.slice(0, 1), citations.filter(c => c.facet === 'as_built')).map(row => row.id)).toEqual([asBuiltId]);
  });
  it('retains examined and conflict-side photos without presenting them as support for a current value', () => {
    const examinedId = '10000000-0000-4000-8000-000000000021';
    const conflictId = '10000000-0000-4000-8000-000000000022';
    const citations = facetImageCitations([
      { key: 'engine.current.displacement', facet: 'current', status: 'missing', sources: [],
        examined: [{ witness: { kind: 'image', id: examinedId } }] },
      { key: 'engine.current.family', facet: 'current', status: 'conflict', sources: [],
        sides: [{ value: 'Pontiac V8', sources: [{ witness: { kind: 'image', id: conflictId } }] }] },
    ] as unknown as FacetItem[]);
    const bound = bindFacetCitations('vehicle-a', citations, [image(examinedId, { vehicle_id: 'vehicle-a' }), image(conflictId, { vehicle_id: 'vehicle-a' })]);
    expect(bound).toHaveLength(2);
    expect(heroFacetImages(bound, citations)).toEqual([]);
  });
  it('rejects executable, malformed and local source links while retaining web citations', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/source.jpg', '//example.com/a', 'https-not-a-url', null]) expect(webSourceUrl(url)).toBeNull();
    expect(webSourceUrl('https://example.com/source.jpg')).toBe('https://example.com/source.jpg');
    expect(webSourceUrl('http://example.com/source')).toBe('http://example.com/source');
  });
  it('does not treat importer defaults as analysis or a photo classification', () => {
    expect(hasImageAnalysis(image('pending'))).toBe(false);
    expect(hasImageZone(image('pending'))).toBe(false);
    expect(hasImageZone(image('other', { vehicle_zone: 'other' }))).toBe(false);
  });
  it('keeps area relevance separate from claim citation', () => {
    const exterior = image('exterior', { vehicle_zone: 'ext_front' });
    expect(relatedFieldImages([exterior], 'color')).toEqual([exterior]);
    expect(citedFieldImages(provenance(), [exterior])).toEqual([]);
  });
  it('does not use the engine bay as evidence of transmission speeds', () => {
    expect(relatedFieldImages([image('engine', { vehicle_zone: 'mech_engine_bay' })], 'transmission')).toEqual([]);
  });
  it('prioritizes indexed drivetrain views over generic controls without treating either as citations', () => {
    const dashboard = image('controls', { vehicle_zone: 'int_dashboard' });
    const drivetrain = image('drivetrain', { vehicle_zone: 'mech_drivetrain' });
    const underbody = image('underbody', { vehicle_zone: 'ext_undercarriage' });
    expect(relatedFieldImages([dashboard, underbody, drivetrain], 'transmission')).toEqual([drivetrain, underbody, dashboard]);
    expect(relatedFieldImages([dashboard, drivetrain], 'drivetrain')).toEqual([drivetrain]);
    expect(citedFieldImages(provenance(), [drivetrain, underbody])).toEqual([]);
  });
  it('recovers a component mention outside the coarse zone and ranks it ahead of generic drivetrain views', () => {
    const axle = image('axle', { vehicle_zone: 'mech_drivetrain' });
    const transmission = image('transmission', { vehicle_zone: 'mech_suspension', ai_byok_narrative: 'Automatic transmission staged on the frame.' });
    expect(relatedFieldImages([axle, transmission], 'transmission')).toEqual([transmission, axle]);
    expect(citedFieldImages(provenance(), [transmission])).toEqual([]);
  });
  it('does not return document flags as related vehicle areas', () => {
    expect(relatedFieldImages([image('doc', { vehicle_zone: 'ext_front', is_document: true })], 'color')).toEqual([]);
  });
  it('honors the source document reading even when the legacy document flag is false', () => {
    const receipt = image('receipt', { is_document: false, ai_byok_scene: 'receipt_document',
      ai_byok_narrative: 'Invoice for a front-axle service tool.', ai_byok_components: [{ label: 'Axle service tool' }] });
    const physical = image('physical', { vehicle_zone: 'mech_drivetrain', ai_byok_scene: 'undercarriage' });
    expect(relatedFieldImages([receipt, physical], 'drivetrain')).toEqual([physical]);
    expect(receipt.ai_byok_narrative).toContain('Invoice');
  });
  it.each(['cross_reference', 'product_screenshot', 'spreadsheet', 'hand_drawn_diagram'])('keeps %s context out of related physical-area photographs', scene => {
    const reference = image('reference', { vehicle_zone: 'mech_drivetrain', ai_byok_scene: scene, ai_byok_narrative: 'Transmission design reference.' });
    expect(relatedFieldImages([reference], 'transmission')).toEqual([]);
    expect(referenceFieldImages([reference], 'transmission')).toEqual([reference]);
  });
  it('keeps relevant references inspectable in component order without including physical photos, paper or unrelated material', () => {
    const area = image('area-reference', { vehicle_zone: 'mech_drivetrain', ai_byok_scene: 'cross_reference' });
    const component = image('component-reference', { ai_byok_scene: 'product_screenshot', ai_byok_components: [{ label: 'Transmission assembly' }] });
    const unrelated = image('unrelated', { vehicle_zone: 'mech_engine_bay', ai_byok_scene: 'cross_reference' });
    const receipt = image('receipt', { vehicle_zone: 'mech_drivetrain', ai_byok_scene: 'receipt_document' });
    const document = image('document', { ...area, id: 'document', is_document: true });
    const physical = image('physical', { vehicle_zone: 'mech_drivetrain' });
    const inventory = [area, physical, receipt, unrelated, document, component];
    expect(referenceFieldImages(inventory, 'transmission')).toEqual([component, area]);
    expect(relatedFieldImages(inventory, 'transmission')).toEqual([physical]);
    expect(inventory[0]).toBe(area);
  });
  it('accepts nested source context and withholds explicit attribution doubt', () => {
    const physical = image('physical', { vehicle_zone: 'mech_drivetrain' });
    expect(isRelatedFieldImage({ ...physical, ai_scan_metadata: { byok_deep_analysis: { scene_type: 'cross_reference' } } }, 'transmission')).toBe(false);
    expect(isRelatedFieldImage({ ...physical, ai_scan_metadata: { byok_deep_analysis: { attribution_doubt: 'Vehicle association unresolved' } } }, 'transmission')).toBe(false);
    expect(relatedFieldImages([physical], 'transmission')).toEqual([physical]);
  });
  it('joins direct citations only to the visible inventory for this vehicle', () => {
    const allowed = image('allowed');
    const p = provenance({ evidence: [{ source: 'vehicle_field_sources', value: 'Silver Pearl', source_type: 'vision', confidence: null, verified: false, image_id: 'allowed', at: null }, { source: 'vehicle_field_sources', value: 'Silver Pearl', source_type: 'vision', confidence: null, verified: false, image_id: 'other-vehicle-or-hidden', at: null }] });
    expect(citedFieldImages(p, [allowed])).toEqual([allowed]);
  });
  it('retains an explicit accepted citation even when a reference is not an uncited area recommendation', () => {
    const reference = image('reference', { vehicle_zone: 'mech_engine_bay', ai_byok_scene: 'cross_reference' });
    const p = provenance({ evidence: [{ source: 'field_evidence', value: 'Recorded source claim', source_type: 'owner',
      confidence: 80, verified: true, image_id: reference.id, at: null }] });
    expect(relatedFieldImages([reference], 'engine_type')).toEqual([]);
    expect(citedFieldImages(p, [reference])).toEqual([reference]);
  });
  it('does not render unfiltered legacy URL references or unaccepted field evidence', () => {
    const allowed = image('allowed');
    const p = provenance({ source_image_url: allowed.image_url, evidence: [{ source: 'field_evidence', value: 'Silver Pearl', source_type: 'vision', confidence: 99, verified: false, image_id: allowed.id, at: null }] });
    expect(citedFieldImages(p, [allowed])).toEqual([]);
  });
  it('ranks explicit code observations ahead of appearance and component inference without manufacturing probabilities', () => {
    const component = image('component'); const appearance = image('appearance'); const code = image('code');
    const p = provenance({ image_observations: [
      { observation_id: 'obs-1', image_id: component.id, image_url: component.image_url, value: 'component inference', source_slug: 'agent-submission', observed_at: null, ingested_at: null, extraction_method: 'image_analysis', agent_model: null, claim_role: 'component_inference', visual_relation: 'component_inference', limitation: 'not independently confirmed', image_region: null, is_inferred: true },
      { observation_id: 'obs-2', image_id: code.id, image_url: code.image_url, value: 'code reading', source_slug: 'agent-submission', observed_at: null, ingested_at: null, extraction_method: 'image_analysis', agent_model: null, claim_role: 'coded_factory_configuration', visual_relation: 'direct_code', limitation: 'not authentication', image_region: null, is_inferred: true },
      { observation_id: 'obs-3', image_id: appearance.id, image_url: appearance.image_url, value: 'visual appearance', source_slug: 'agent-submission', observed_at: null, ingested_at: null, extraction_method: 'image_analysis', agent_model: null, claim_role: 'observed_appearance', visual_relation: 'direct_visual', limitation: 'lighting affects color', image_region: null, is_inferred: true },
    ] });
    expect(citedFieldImages(p, [component, appearance, code])).toEqual([code, appearance, component]);
    expect(evidenceOrder('unrecognized')).toBe(3);
    expect(citedFieldImages(p, [appearance])).toEqual([appearance]);
  });
  it('deduplicates images cited by several accepted records', () => {
    const allowed = image('allowed');
    const citation = { source: 'field_evidence', value: 'Silver Pearl', source_type: 'vision', confidence: 80, verified: true, image_id: allowed.id, at: null };
    expect(citedFieldImages(provenance({ evidence: [citation, citation] }), [allowed])).toEqual([allowed]);
  });
  it('withholds citation counts when the reader refuses incomplete coverage', () => {
    const allowed = image('allowed');
    const p = provenance({
      evidence: [{ source: 'field_evidence', value: 'claim', source_type: 'vision', confidence: 80, verified: true, image_id: allowed.id, at: null }],
      coverage: { contract: 'field_provenance_aggregate_cap_v1', status: 'refused_input_limit', collectionRowLimit: 1000, scanRowsBounded: false, responseBytesBounded: false },
    });
    expect(citedFieldImages(p, [allowed])).toEqual([]);
  });
});

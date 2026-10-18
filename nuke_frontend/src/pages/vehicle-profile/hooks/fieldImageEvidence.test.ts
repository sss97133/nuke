import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { hasImageAnalysis, hasImageZone, relatedFieldImages, webSourceUrl, type EvidenceImage } from './useVehicleImageEvidence';
import { citedFieldImages, evidenceOrder, type FieldProvenance } from './useFieldProvenance';
const image = (id: string, changes: Partial<EvidenceImage> = {}): EvidenceImage => ({ id, image_url: `https://example.com/${id}.jpg`, thumbnail_url: null, medium_url: null, vehicle_zone: null, angle: null, ai_detected_angle: null, ai_processing_status: 'pending', vision_analyzed_at: null, vision_model_version: null, created_at: null, taken_at: null, source: 'external_import', is_primary: false, is_document: false, category: 'general', ...changes });
const provenance = (changes: Partial<FieldProvenance> = {}): FieldProvenance => ({ field: 'color', value: 'Silver Pearl', inline_source: 'listing', source_image_url: null, evidence: [], observations: [], ...changes });
describe('field image evidence boundaries', () => {
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
  it('does not return document flags as related vehicle areas', () => {
    expect(relatedFieldImages([image('doc', { vehicle_zone: 'ext_front', is_document: true })], 'color')).toEqual([]);
  });
  it('joins direct citations only to the visible inventory for this vehicle', () => {
    const allowed = image('allowed');
    const p = provenance({ evidence: [{ source: 'vehicle_field_sources', value: 'Silver Pearl', source_type: 'vision', confidence: null, verified: false, image_id: 'allowed', at: null }, { source: 'vehicle_field_sources', value: 'Silver Pearl', source_type: 'vision', confidence: null, verified: false, image_id: 'other-vehicle-or-hidden', at: null }] });
    expect(citedFieldImages(p, [allowed])).toEqual([allowed]);
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

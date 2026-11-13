import { describe, expect, it } from 'vitest';
import { physicalRecordedValue, PHYSICAL_READING_METHOD } from './profileSourceClaims';
import type { FieldProvenance } from './hooks/useFieldProvenance';

const vehicle = '10000000-0000-4000-8000-000000000001';
const image = '20000000-0000-4000-8000-000000000001';
const source = () => ({ vehicle_id: vehicle, field: 'mileage', value: null, evidence: [], observations: [], image_observations: [{
  observation_id: '30000000-0000-4000-8000-000000000001', image_id: image,
  witness_id: '40000000-0000-4000-8000-000000000001', witness_role: 'derived',
  image_url: 'https://example.test/a.jpg', source_url: 'https://example.test/a.jpg',
  value: '12.3 miles shown', limitation: 'Total mileage unknown.', claim_role: 'odometer_display',
  extraction_method: PHYSICAL_READING_METHOD, agent_model: 'fixture', source_family: `image:${image}`,
  is_inferred: true, visual_relation: 'direct_visual',
}] }) as unknown as FieldProvenance;
describe('physical recorded value', () => {
  it('retains fractional odometer display without asserting accumulated distance', () => {
    expect(physicalRecordedValue(vehicle, 'mileage', source())).toEqual({ status: 'resolved', value: '12.3 miles shown', note: 'Total mileage unknown.' });
  });
  it('does not invent a unit, convert kilometers, or flatten a decimal', () => {
    const p = source(); p.image_observations![0].value = '12.3';
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('unavailable');
    p.image_observations![0].value = '12.3 km shown';
    expect(physicalRecordedValue(vehicle, 'mileage', p)).toMatchObject({ status: 'resolved', value: '12.3 km shown' });
  });
  it('requires a direct visible odometer reading, not component inference', () => {
    const p = source(); p.image_observations![0].visual_relation = 'component_inference';
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('absent');
  });
  it('keeps exterior appearance separate from badge-derived trim identity', () => {
    const p = source(); p.field = 'appearance';
    Object.assign(p.image_observations![0], { value: 'Sport-style', claim_role: 'visible_exterior_appearance',
      limitation: 'Appearance only; factory trim is not established.' });
    expect(physicalRecordedValue(vehicle, 'appearance', p)).toMatchObject({ status: 'resolved', value: 'Sport-style' });
    p.image_observations![0].visual_relation = 'direct_code';
    expect(physicalRecordedValue(vehicle, 'appearance', p).status).toBe('absent');
    p.image_observations![0].visual_relation = 'direct_visual';
    p.image_observations![0].claim_role = 'trim';
    expect(physicalRecordedValue(vehicle, 'appearance', p).status).toBe('absent');
  });
  it.each(['image_id', 'witness_id', 'witness_role', 'source_url', 'source_family', 'claim_role', 'agent_model', 'extraction_method', 'limitation'])(
    'withholds a reading with invalid %s', key => {
      const p = source(); (p.image_observations![0] as unknown as Record<string, unknown>)[key] = '';
      expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('absent');
    });
  it('does not reuse withdrawn, moved, private, or superseded sources omitted by the reader', () => {
    const p = source(); p.image_observations = [];
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('absent');
    expect(physicalRecordedValue('50000000-0000-4000-8000-000000000001', 'mileage', source()).status).toBe('unavailable');
  });
  it('does not rank conflicting active readings or count duplicate testimony as corroboration', () => {
    const p = source(); p.image_observations!.push({ ...p.image_observations![0] });
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('resolved');
    p.image_observations![1].value = '123 miles shown';
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('conflict');
  });
  it('does not treat an incomplete provenance collection as agreement', () => {
    const p = source(); p.coverage = { contract: 'field_provenance_aggregate_cap_v1', status: 'refused_input_limit', collectionRowLimit: 1000, scanRowsBounded: false, responseBytesBounded: false };
    expect(physicalRecordedValue(vehicle, 'mileage', p).status).toBe('unavailable');
  });
});

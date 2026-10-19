import { describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: null as any, rpc: vi.fn(), from: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (query: any) => { fixture.query = query; return query; } }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from } }));
import { bindEngineCanonical, ENGINE_PROPERTY_IDS, useFieldProvenance, type FieldProvenance } from './useFieldProvenance';
const vehicleId = 'local-public';
const field = 'engine_displacement_l';
const report = { id: 'local-winner', value: '2.5' };
const provenance = { field, vehicle_id: vehicleId, value: null, evidence: [], observations: [report] } as unknown as FieldProvenance;
const winner = { vehicle_id: vehicleId, property_id: ENGINE_PROPERTY_IDS[field], observation_id: report.id, structured_data: { [field]: 2.5 }, discriminator_value: '__single__' };

describe('existing canonical owner qualified by readable report', () => {
  it('binds the existing winner rather than a competing higher confidence report', () => {
    const data = { ...provenance, observations: [...provenance.observations, { id: 'other', value: '3', confidence: 1 }] };
    expect(bindEngineCanonical(vehicleId, field, data, [winner])).toEqual({ status: 'resolved', value: '2.5', observation_id: report.id });
  });
  it('withholds private, changed, ambiguous or differently scoped winners', () => {
    for (const rows of [[], [winner, winner], [{ ...winner, vehicle_id: 'other' }], [{ ...winner, property_id: ENGINE_PROPERTY_IDS.engine_configuration }], [{ ...winner, observation_id: 'not-readable' }], [{ ...winner, discriminator_value: 'other' }], [{ ...winner, structured_data: { [field]: 3 } }], [{ ...winner, structured_data: { [field]: '2.5' } }]]) {
      expect(bindEngineCanonical(vehicleId, field, provenance, rows).status).toBe('unknown');
    }
  });
  it('does not turn refused collections into a resolved claim', () => {
    expect(bindEngineCanonical(vehicleId, field, { ...provenance, coverage: { status: 'refused_input_limit' } as any }, [winner]).status).toBe('unknown');
  });
  it('does not read the view after denial, refusal or for a legacy field', async () => {
    for (const [key, data] of [[field, null], [field, { ...provenance, coverage: { status: 'refused_input_limit' } }], ['engine_size', provenance]] as const) {
      fixture.from.mockClear();
      fixture.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data, error: null }) });
      useFieldProvenance(vehicleId, key);
      expect(await fixture.query.queryFn({ signal: new AbortController().signal })).toBe(data);
      expect(fixture.from).not.toHaveBeenCalled();
    }
  });
  it('keeps readable source reports when the canonical read fails', async () => {
    fixture.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: provenance, error: null }) });
    const query: any = { select: () => query, eq: () => query, limit: () => query, abortSignal: () => Promise.resolve({ data: null, error: new Error('unavailable') }) };
    fixture.from.mockReturnValue(query);
    useFieldProvenance(vehicleId, field);
    const data = await fixture.query.queryFn({ signal: new AbortController().signal });
    expect(data.canonical.status).toBe('unavailable');
    expect(data.observations).toEqual(provenance.observations);
  });
});

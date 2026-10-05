import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldEvidenceMap } from './useFieldEvidence';

const fixture = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  queryError: null as any,
  agentFields: [] as any[],
  queryFn: null as null | (() => Promise<FieldEvidenceMap>),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => Promise<FieldEvidenceMap> }) => {
    fixture.queryFn = options.queryFn;
    return { data: {}, isLoading: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('../../../lib/supabase', () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({ data: fixture.rows, error: fixture.queryError })),
  };
  return { supabase: {
    from: vi.fn(() => query),
    rpc: vi.fn(async (name: string) => {
      if (name !== 'vehicle_wiki') throw new Error('Unexpected writer/backfill call in classification test');
      return { data: { cited_fields: fixture.agentFields }, error: null };
    }),
  } };
});
import { useFieldEvidence } from './useFieldEvidence';
import { supabase } from '../../../lib/supabase';

beforeEach(() => {
  fixture.rows = []; fixture.queryFn = null; fixture.queryError = null; fixture.agentFields = [];
  vi.restoreAllMocks(); vi.clearAllMocks();
});

describe('evidence reads preserve sparse source state', () => {
  it.each([75, 0, null])('preserves raw native confidence %s for display without changing rank or either clock', async score => {
    fixture.rows = [{ id: 'offline-score', vehicle_id: 'offline-subject', field_name: 'color', proposed_value: 'Blue',
      source_type: 'source-report', source_confidence: score, status: 'pending',
      extracted_at: null, created_at: '2026-01-02T00:00:00Z' }];
    const before = JSON.stringify(fixture.rows);
    useFieldEvidence('offline-subject'); const data = await fixture.queryFn!();
    expect(data.color.primary).toMatchObject({ source_confidence: score, evidence_origin: 'field_evidence',
      confidence: (score ?? 0) / 100, extracted_at: null, created_at: fixture.rows[0].created_at });
    expect(JSON.stringify(fixture.rows)).toBe(before);
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('vehicle_wiki', { p_vehicle_id: 'offline-subject' });
  });
  it.each([0, 1, 2])('reads %s retained rows without requesting a backfill or changing testimony', async count => {
    const subject = `offline-sparse-${count}`;
    fixture.rows = Array.from({ length: count }, (_, i) => ({ id: `offline-evidence-${i}`, vehicle_id: subject,
      field_name: `field-${i}`, proposed_value: `reported-${i}`, source_type: 'source-report', source_confidence: 75,
      status: 'pending', extracted_at: '2026-01-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z' }));
    const before = JSON.stringify(fixture.rows);
    useFieldEvidence(subject); const data = await fixture.queryFn!();
    expect(Object.keys(data)).toHaveLength(count);
    fixture.rows.forEach((row, i) => expect(data[`field-${i}`].primary).toMatchObject({
      id: row.id, field_value: row.proposed_value, source_type: row.source_type,
      status: row.status, extracted_at: row.extracted_at, created_at: row.created_at,
    }));
    expect(JSON.stringify(fixture.rows)).toBe(before);
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect((supabase.from as any).mock.results[0].value.eq).toHaveBeenCalledWith('vehicle_id', subject);
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('vehicle_wiki', { p_vehicle_id: subject });
  });

  it('keeps the existing agent reader when native evidence is empty', async () => {
    fixture.agentFields = [{ attribute: 'vehicle.horsepower', consensus: 300, total_support: 1, consensus_support: 1 }];
    useFieldEvidence('offline-agent-only'); const data = await fixture.queryFn!();
    expect(data.horsepower.primary.field_value).toBe('300');
    expect(data.horsepower.primary.source_type).toBe('agent_agent');
    expect(data.horsepower.primary.evidence_origin).toBe('vehicle_wiki');
    expect(data.horsepower.primary.source_confidence).toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('vehicle_wiki', { p_vehicle_id: 'offline-agent-only' });
  });

  it('does not turn a failed native read into empty evidence or a writer request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fixture.queryError = { code: 'offline-read-error', message: 'Offline reader unavailable' };
    useFieldEvidence('offline-reader-error');
    await expect(fixture.queryFn!()).rejects.toBe(fixture.queryError);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps rejected and superseded rows out of current evidence without altering their history', async () => {
    fixture.rows = ['rejected', 'superseded'].map((status, i) => ({ id: `offline-history-${i}`,
      vehicle_id: 'offline-history', field_name: 'color', proposed_value: 'Reported color', status,
      source_type: 'source-report', source_confidence: 75, created_at: '2026-01-01T00:00:00Z' }));
    const before = JSON.stringify(fixture.rows);
    useFieldEvidence('offline-history'); expect(await fixture.queryFn!()).toEqual({});
    expect(JSON.stringify(fixture.rows)).toBe(before);
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('vehicle_wiki', { p_vehicle_id: 'offline-history' });
  });
});

async function group(field: string, primary: string, alternatives: string[]) {
  fixture.rows = [primary, ...alternatives, primary].map((value, index) => ({
    id: `native-evidence-${index}`,
    vehicle_id: 'local-public-vehicle',
    field_name: field,
    proposed_value: value,
    source_type: index === 0 ? 'bat' : 'bat_listing',
    source_confidence: 85 - index * 5,
    extraction_context: null,
    extracted_at: '2026-04-06T05:00:28.054492Z',
    status: index === 0 ? 'pending' : 'accepted',
    created_at: '2026-04-06T05:00:28.054492Z',
  }));
  useFieldEvidence('local-public-vehicle');
  const result = await fixture.queryFn!();
  return result[field];
}

describe('native evidence conflict classification', () => {
  it.each([
    ['mileage', '87', '87000'],
    ['mileage', '87000', '87'],
    ['odometer', '10000', '110000'],
    ['displacement', '3.5', '35'],
    ['displacement', '35', '3.5'],
    ['sale_price', '-87', '87'],
    ['horsepower', '-0.5', '0.5'],
  ])('keeps numeric magnitude, decimal and sign differences visible: %s %s / %s', async (field, primary, other) => {
    const value = await group(field, primary, [other]);
    expect(value.hasConflict).toBe(true);
    expect(value.conflictType).toBe('genuine');
    expect(value.primary.field_value).toBe(primary);
    expect(value.primary.status).toBe('pending');
    expect(value.sources.map(row => row.field_value)).toEqual([primary, other, primary]);
    expect(value.agreementCount).toBe(2);
  });

  it.each([
    ['mileage', '87,000', '87000'],
    ['displacement', '3.50', '3.5'],
    ['displacement', '.5', '0.5'],
    ['sale_price', '-1,000', '-1000'],
    ['horsepower', '+300', '300'],
  ])('recognizes complete equal scalar representations: %s %s / %s', async (field, primary, other) => {
    expect((await group(field, primary, [other])).conflictType).toBe('synonym');
  });

  it.each([
    ['mileage', '100000', '101000'],
    ['horsepower', '300', '305'],
    ['asking_price', '10000', '10010'],
  ])('retains the existing nearby-number variance rule: %s', async (field, primary, other) => {
    expect((await group(field, primary, [other])).conflictType).toBe('variance');
  });

  it('retains the strict existing 5%-of-mean boundary', async () => {
    // Range 10 / mean 200 is exactly 5%, which does not meet the strict rule.
    expect((await group('mileage', '195', ['205'])).conflictType).toBe('genuine');
  });

  it.each([
    ['under 87k', '87000'],
    ['under 87k', '87'],
    ['10000 miles', '10000 km'],
    ['10000 shown', '10000 actual'],
    ['displayed 10000', 'inferred 110000'],
    ['1,2', '12'],
    ['1e3', '1000'],
    ['87k', '87000'],
    ['10000 miles', '10100 miles'],
    ['10000-11000', '10000'],
    ['Infinity', '10000'],
  ])('does not discard a numeric qualifier, unit or incomplete notation: %s / %s', async (primary, other) => {
    expect((await group('mileage', primary, [other])).conflictType).toBe('genuine');
  });

  it('preserves identical qualified literals without converting their units or role', async () => {
    const value = await group('mileage', '10,000 Miles Shown, TMU', ['10,000 miles shown, TMU']);
    expect(value.hasConflict).toBe(false);
    expect(value.conflictType).toBeUndefined();
    expect(value.primary.field_value).toBe('10,000 Miles Shown, TMU');
    expect(value.agreementCount).toBe(3);
  });

  it('does not discard an unknown alternative to manufacture numeric variance', async () => {
    expect((await group('mileage', '100000', ['101000', 'unknown'])).conflictType).toBe('genuine');
  });

  it.each([
    ['drivetrain', '4WD', '4x4', 'synonym'],
    ['engine_type', 'V8', 'V-8', 'synonym'],
    ['transmission', 'auto', 'automatic', 'synonym'],
    ['description', 'Carburetor', 'Carburetor (Edelbrock 4bbl)', 'refinement'],
    ['model', 'C/K Pickup', 'C2500 Sierra Classic', 'refinement'],
    ['color', 'Black', 'Red', 'genuine'],
  ])('preserves existing text classification: %s %s / %s', async (field, primary, other, expected) => {
    expect((await group(field, primary, [other])).conflictType).toBe(expected);
  });
});

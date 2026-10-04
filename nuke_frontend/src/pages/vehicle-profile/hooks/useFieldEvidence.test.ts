import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldEvidenceMap } from './useFieldEvidence';

const fixture = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
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
    order: vi.fn(async () => ({ data: fixture.rows, error: null })),
  };
  return { supabase: {
    from: vi.fn(() => query),
    rpc: vi.fn(async (name: string) => {
      if (name !== 'vehicle_wiki') throw new Error('Unexpected writer/backfill call in classification test');
      return { data: { cited_fields: [] }, error: null };
    }),
  } };
});
import { useFieldEvidence } from './useFieldEvidence';

beforeEach(() => { fixture.rows = []; fixture.queryFn = null; vi.clearAllMocks(); });

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
  // Three or more native rows avoid the existing sparse-evidence backfill path.
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

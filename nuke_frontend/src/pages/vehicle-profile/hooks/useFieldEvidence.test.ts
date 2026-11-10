import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldEvidenceMap } from './useFieldEvidence';

const fixture = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  queryError: null as any,
  agentFields: [] as any[],
  images: [] as any[], imageError: null as any,
  cachedData: {} as FieldEvidenceMap, hookError: null as Error | null,
  viewer: null as string | null, authLoading: false, query: null as any,
  queryFn: null as null | (() => Promise<FieldEvidenceMap>),
}));
vi.mock('../../../lib/vehicleImageColumns', () => ({ vehicleImageGallerySource: async () => 'vehicle_images_public' }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.viewer ? { id: fixture.viewer } : null, loading: fixture.authLoading }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => Promise<FieldEvidenceMap> }) => {
    fixture.query = options;
    fixture.queryFn = options.queryFn;
    return { data: fixture.cachedData, isLoading: false, error: fixture.hookError, refetch: vi.fn() };
  },
}));
vi.mock('../../../lib/supabase', () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({ data: fixture.rows, error: fixture.queryError })),
    in: vi.fn(async () => ({ data: fixture.images, error: fixture.imageError })),
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
  fixture.images = []; fixture.imageError = null;
  fixture.cachedData = {}; fixture.hookError = null;
  fixture.viewer = null; fixture.authLoading = false;
  vi.restoreAllMocks(); vi.clearAllMocks();
});

describe('evidence reads preserve sparse source state', () => {
  it('keys source eligibility to the viewer and waits for resolved authentication', () => {
    fixture.viewer = 'owner'; fixture.authLoading = true; fixture.cachedData = { make: {} } as any;
    expect(useFieldEvidence('vehicle').evidence).toEqual({});
    expect(fixture.query.enabled).toBe(false);
    expect(fixture.query.queryKey).toEqual(['field-evidence', 'vehicle', 'owner']);
    fixture.viewer = null; fixture.authLoading = false;
    useFieldEvidence('vehicle');
    expect(fixture.query.queryKey).toEqual(['field-evidence', 'vehicle', 'anonymous']);
  });
  it('withholds cached claims when a refresh cannot verify current source eligibility', () => {
    fixture.cachedData = { make: { sources: [{ source_image_id: 'old-image' }] } } as any;
    fixture.hookError = new Error('Cited image sources could not be checked');
    const read = useFieldEvidence('local-vehicle');
    expect(read.evidence).toEqual({});
    expect(read.error).toContain('Cited image sources could not be checked');
  });
  it('withdraws accepted photo claims when the cited image is unavailable while preserving independent sources', async () => {
    const row = { vehicle_id: 'local-vehicle', field_name: 'make', source_type: 'ai_visual', status: 'accepted', source_confidence: 90, created_at: '2026-01-01' };
    const present = 'ABCDEF00-0000-4000-8000-000000000001', absent = '00000000-0000-4000-8000-000000000002';
    fixture.rows = [
      { ...row, id: 'present', proposed_value: 'Current reading', fallback_image_id: present },
      { ...row, id: 'withdrawn', proposed_value: 'Unfiled image reading', source_image_id: absent },
      { ...row, id: 'independent', proposed_value: 'Document reading', source_type: 'receipt' },
      { ...row, id: 'broken', proposed_value: 'Broken ID reading', source_image_id: 'invalid', cited_image_url: 'https://example.test/current.jpg' },
      { ...row, id: 'old-url', proposed_value: 'Replaced photo reading', source_image_id: present, cited_image_url: 'https://example.test/old.jpg' },
      { ...row, id: 'disagreeing-ids', proposed_value: 'Conflicting IDs', source_image_id: present, fallback_image_id: absent },
      { ...row, id: 'url-only', proposed_value: 'URL photo', source_image_id: null, cited_image_url: 'https://example.test/current.jpg' },
    ];
    fixture.images = [{ id: present.toLowerCase(), image_url: 'https://example.test/current.jpg', vision_gate_status: 'approved' }];
    useFieldEvidence('local-vehicle'); const data = await fixture.queryFn!();
    expect(data.make.sources.map(r => r.id).sort()).toEqual(['independent', 'present', 'url-only']);
    expect(data.make.sources.find(r => r.id === 'present')?.source_image_id).toBe(present.toLowerCase());
    expect(data.make.sources.find(r => r.id === 'url-only')?.source_image_id).toBe(present.toLowerCase());
  });
  it.each([{ is_superseded: true }, { is_sensitive: true }, { is_duplicate: true }, { vision_gate_status: 'rejected' }, { image_vehicle_match_status: 'mismatch' }])('does not promote ineligible source %j', async status => {
    const id = '00000000-0000-4000-8000-000000000002';
    fixture.rows = [{ id: 'claim', vehicle_id: 'local-vehicle', field_name: 'make', proposed_value: 'Reading', status: 'accepted', source_image_id: id }];
    fixture.images = [{ id, image_url: 'https://example.test/photo.jpg', ...status }];
    useFieldEvidence('local-vehicle'); expect(await fixture.queryFn!()).toEqual({});
  });
  it('reports a failed source lookup rather than treating it as an empty successful read', async () => {
    fixture.rows = [{ id: 'claim', vehicle_id: 'local-vehicle', source_image_id: '00000000-0000-4000-8000-000000000002' }];
    fixture.imageError = { message: 'temporary failure' };
    useFieldEvidence('local-vehicle'); await expect(fixture.queryFn!()).rejects.toThrow('Cited image sources could not be checked');
  });
  it('retains withdrawn source references separately without promoting their higher scores or creating conflicts', async () => {
    const row = { vehicle_id: 'offline-history', field_name: 'engine_type', source_type: 'review',
      extracted_at: null, created_at: '2026-01-01T00:00:00Z' };
    fixture.rows = [
      { ...row, id: 'current', proposed_value: 'Reported engine', source_confidence: 75, status: 'accepted' },
      { ...row, id: 'withdrawn', proposed_value: 'Wrong engine', source_confidence: 99, status: 'superseded',
        extraction_context: 'The cited photo was an intake, not an identity plate', assigned_at: '2026-02-01T00:00:00Z',
        source_image_id: '00000000-0000-4000-8000-000000000001' },
      { ...row, id: 'rejected', proposed_value: 'Another wrong engine', source_confidence: 98, status: 'rejected_misattributed', source_image_id: '../invalid' },
      { ...row, id: 'foreign', vehicle_id: 'offline-other', proposed_value: 'Foreign engine', source_confidence: 100, status: 'accepted' },
    ];
    useFieldEvidence('offline-history'); const data = await fixture.queryFn!();
    expect(data.engine_type.primary.id).toBe('current');
    expect(data.engine_type.sources).toHaveLength(1);
    expect(data.engine_type.hasConflict).toBe(false);
    expect(data.engine_type.history?.map(r => r.id)).toEqual(['withdrawn', 'rejected']);
    expect(data.engine_type.history?.[0]).toMatchObject({ source_image_id: '00000000-0000-4000-8000-000000000001', assigned_at: '2026-02-01T00:00:00Z' });
    expect(data.engine_type.history?.[1].source_image_id).toBeNull();
  });
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

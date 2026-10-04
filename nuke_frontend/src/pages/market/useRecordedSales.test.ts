import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: fixture }));
import { fetchRecordedSales, fetchSalesScopes, matchSalesMake, recordedSalesRequest, recordedSalesWindow } from './useRecordedSales';

beforeEach(() => { fixture.rpc.mockReset(); fixture.from.mockReset(); });
describe('existing recorded-sales reader contract', () => {
  it('uses exact UTC boundaries across local timezone and seven-day cap', () => {
    expect(recordedSalesWindow(7, Date.parse('2026-10-04T00:30:00+09:00'))).toEqual({ event_from: '2026-09-26T00:00:00.000Z', event_to: '2026-10-03T00:00:00.000Z' });
  });
  it('calls only the existing overload with explicit scope and focused evidence filters', async () => {
    const request = recordedSalesRequest({ kind: 'supported_subject', subject_id: 'synthetic-scope' }, recordedSalesWindow(2, Date.parse('2026-10-04T12:00:00Z')),
      { bucket: '2026-10-03T00:00:00Z', series: 'benchmark' });
    fixture.rpc.mockResolvedValue({ data: { state: 'unavailable', reason: 'unsupported_or_unknown_subject' } });
    expect(await fetchRecordedSales(request)).toEqual({ state: 'unavailable', reason: 'unsupported_or_unknown_subject' });
    expect(fixture.rpc).toHaveBeenCalledWith('get_market_trends', { p_request: request });
    expect(request).not.toHaveProperty('knowledge_as_of');
    fixture.rpc.mockResolvedValue({ data: { state: 'partial', series: [] } });
    await expect(fetchRecordedSales(request)).rejects.toThrow('Unsupported recorded-sales receipt');
    fixture.rpc.mockResolvedValue({ error: new Error('Read timed out') });
    await expect(fetchRecordedSales(request)).rejects.toThrow('Read timed out');
  });
  it('selects only bounded public registry fields and uses returned IDs without a literal model policy', async () => {
    const reads: any[] = [];
    fixture.from.mockImplementation(table => {
      const read = { table, fields: '', filter: null as any, order: '', limit: 0 }; reads.push(read);
      const builder = { select: (fields: string) => { read.fields = fields; return builder; },
        eq: (key: string, value: string) => { read.filter = [key, value]; return builder; },
        order: (key: string) => { read.order = key; return builder; },
        limit: (n: number) => { read.limit = n; return Promise.resolve({ data: table === 'canonical_makes'
          ? [{ id: 'returned-make-id', canonical_name: 'Fixture' }]
          : [{ subject_id: 'returned-subject-id', canonical_make: 'Fixture', canonical_model: 'Model', grain: 'year', year: 2000 }] }); } };
      return builder;
    });
    const options = await fetchSalesScopes();
    expect(reads[0]).toMatchObject({ fields: 'id,canonical_name', limit: 201 });
    expect(reads[1]).toMatchObject({ filter: ['comparison_scope_status', 'supported'], limit: 101 });
    expect(matchSalesMake(options, 'FIXTURE')?.scope).toEqual({ kind: 'canonical_make', canonical_make_id: 'returned-make-id' });
    expect(options[1].scope).toEqual({ kind: 'supported_subject', subject_id: 'returned-subject-id' });
    expect(matchSalesMake([...options, options[0]], 'Fixture')).toBeUndefined();
    expect(matchSalesMake(options, 'unknown')).toBeUndefined();
  });
});

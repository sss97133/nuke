import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: fixture }));
import { fetchRecordedSales, fetchSalesScopes, matchSalesMake, recordedSalesRequest, recordedSalesWindow, retryColdTimeout } from './useRecordedSales';

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
        limit: (n: number) => { read.limit = n; return Promise.resolve({ count: 1, data: table === 'canonical_makes'
          ? [{ id: 'returned-make-id', canonical_name: 'Fixture' }]
          : [{ subject_id: 'returned-subject-id', canonical_make: 'Fixture', canonical_model: 'Model', grain: 'year', year: 2000 }] }); } };
      return builder;
    });
    const options = await fetchSalesScopes();
    expect(reads[0]).toMatchObject({ fields: 'id,canonical_name', limit: 1001 });
    expect(reads[1]).toMatchObject({ filter: ['comparison_scope_status', 'supported'], limit: 101 });
    expect(matchSalesMake(options, 'FIXTURE')?.scope).toEqual({ kind: 'canonical_make', canonical_make_id: 'returned-make-id' });
    expect(options[1].scope).toEqual({ kind: 'supported_subject', subject_id: 'returned-subject-id' });
    expect(matchSalesMake([...options, options[0]], 'Fixture')).toBeUndefined();
    expect(matchSalesMake(options, 'unknown')).toBeUndefined();
  });
  it('accepts a complete registry above the former 200-row ceiling and refuses a truncated catalog', async () => {
    let size = 402;
    fixture.from.mockImplementation(table => {
      const builder = {select:()=>builder,eq:()=>builder,order:()=>builder,
        limit:()=>Promise.resolve({count:table==='canonical_makes'?size:0,data:table==='canonical_makes'
          ? Array.from({length:Math.min(size,1000)},(_,i)=>({id:`make-${i}`,canonical_name:`Fixture ${i}`})) : []})};
      return builder;
    });
    expect(await fetchSalesScopes()).toHaveLength(402);
    size=1001;
    await expect(fetchSalesScopes()).rejects.toThrow('Scope catalog response is incomplete');
  });
});

describe('a cold read past the reader\'s time limit', () => {
  it('is retried once, and only a statement timeout is', () => {
    const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(retryColdTimeout(0, timeout)).toBe(true);
    expect(retryColdTimeout(1, timeout)).toBe(false);
    expect(retryColdTimeout(0, { code: '42501', message: 'permission denied' })).toBe(false);
    expect(retryColdTimeout(0, new Error('Unsupported recorded-sales receipt'))).toBe(false);
    expect(retryColdTimeout(0, null)).toBe(false);
  });
});

function capturedFixture() {
  return {contract_version:1,metric_id:'captured_sell_through',state:'partial',
    event_from:'2026-11-20T00:00:00Z',event_to:'2026-11-27T00:00:00Z',
    scope:{kind:'canonical_make',canonical_make_id:'fixture-make'},
    unit:'fraction_of_known_retained_bidding_outcomes',method_id:'captured_auction_outcomes',method_version:1,
    knowledge_mode:'current_recorded_state',truncated:false,coverage:{complete_external_capture:false},
    summary:[{series:'selected',numerator:1,denominator:2,ratio:.5},
      {series:'benchmark',numerator:0,denominator:0,ratio:null}],
    series:[{bucket_start:'2026-11-20T00:00:00Z',series:'selected',numerator:1,denominator:2,value:.5,ratio:.5,
      unit:'fraction_of_known_retained_bidding_outcomes'}],
    evidence:{snapshot_hash:'a'.repeat(32),offset:0,next_offset:null,has_more:false,pagination_supported:true,
      contributors:[{outcome_class:'no_sale',numerator_contribution:0,denominator_contribution:1}]}};
}
describe('captured-only outcome receipts', () => {
  const scope={kind:'canonical_make' as const,canonical_make_id:'fixture-make'};
  const window={event_from:'2026-11-20T00:00:00Z',event_to:'2026-11-27T00:00:00Z'};
  const request=()=>recordedSalesRequest(scope,window,null,'captured_sell_through');
  it('keeps the metric, reserve policy and exact evidence continuation in the existing RPC', async () => {
    const r=recordedSalesRequest(scope,window,{bucket:'2026-11-20',series:'selected',offset:20,
      snapshotHash:'a'.repeat(32),outcome:'no_sale'},'captured_sell_through');
    expect(r).toMatchObject({metric:'captured_sell_through',reserve_policy:'all_recorded_policies',
      evidence_offset:20,evidence_snapshot_hash:'a'.repeat(32),evidence_outcome:'no_sale'});
    fixture.rpc.mockResolvedValue({data:capturedFixture()});
    expect(await fetchRecordedSales(r)).toMatchObject({metric_id:'captured_sell_through'});
    expect(fixture.rpc).toHaveBeenCalledWith('get_market_trends',{p_request:r});
  });
  it('preserves real zero and unknown fractions and an explicit changed-snapshot refusal', async () => {
    const data=capturedFixture();data.series[0]={...data.series[0],numerator:0,value:0,ratio:0};
    fixture.rpc.mockResolvedValue({data});
    expect((await fetchRecordedSales(request()) as any).series[0].value).toBe(0);
    data.series[0]={...data.series[0],denominator:0,value:null as any,ratio:null as any};
    expect((await fetchRecordedSales(request()) as any).series[0].value).toBeNull();
    fixture.rpc.mockResolvedValue({data:{state:'unavailable',reason:'evidence_snapshot_changed'}});
    expect(await fetchRecordedSales(request())).toEqual({state:'unavailable',reason:'evidence_snapshot_changed'});
  });
  it.each(['wrong-rate','wrong-unit','missing-hash','mixed-metric','bad-contribution','wrong-scope','wrong-window'])(
    'refuses %s instead of drawing an unsupported percentage', async failure => {
      const data=capturedFixture();
      if(failure==='wrong-rate')data.series[0].value=.7;
      if(failure==='wrong-unit')data.unit='USD';
      if(failure==='missing-hash')data.evidence.snapshot_hash='';
      if(failure==='mixed-metric')data.metric_id='recorded_sale_events';
      if(failure==='bad-contribution')data.evidence.contributors[0].denominator_contribution=0;
      if(failure==='wrong-scope')data.scope.canonical_make_id='other-make';
      if(failure==='wrong-window')data.event_to='2026-11-26T00:00:00Z';
      fixture.rpc.mockResolvedValue({data});
      await expect(fetchRecordedSales(request())).rejects.toThrow(/Unsupported/);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:mock}));
import { assertBidPath, bidDecimal, bidRequestFromParams, clearBidSelection, fetchBidPath, formatBidAmount,
  selectBidParams, type BidPathReceipt, type BidPathRequest } from './bidPathReader';
import { bidFixture, bidId, BID_CLOSE, BID_LOT, BID_VEHICLE } from './__fixtures__/bidPath';
beforeEach(()=>mock.rpc.mockReset());
const check=(d:BidPathReceipt,r:BidPathRequest={})=>assertBidPath(d,BID_VEHICLE,BID_LOT,r);

describe('SQL bid-path contract',()=>{
  it('reads the exact existing owner overload, preserving source IDs and server statistics',async()=>{
    const data=bidFixture();mock.rpc.mockResolvedValue({data,error:null});
    expect(await fetchBidPath(BID_VEHICLE,BID_LOT,{})).toEqual(data);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('lot_order_book_read',{p_auction_event_id:BID_LOT,p_request:{}});
    expect(data.states[4]).toMatchObject({amount:'325',price:'350',price_change:'0',top_two_gap:'25',depth_90:2,depth_75:3});
  });
  it('uses the selected entry evidence without replacing the full path or snapshot',()=>{
    const r={selected_bid_comment_id:bidId(2)};const d=bidFixture(r);expect(()=>check(d,r)).not.toThrow();
    expect(d.states).toHaveLength(5);expect(d.book).toHaveLength(2);expect(d.book[0].highest_bid_comment_id).toBe(bidId(2));
  });
  it('accepts the recomputed recorded-input path with the late bidder absent',()=>{
    const r={knowledge_mode:'recorded_input_reconstruction' as const,cutoff:'2026-11-25T20:52:00Z'};
    const d=bidFixture(r);expect(()=>check(d,r)).not.toThrow();expect(d.states).toHaveLength(2);
    expect(d.states[1]).toMatchObject({bid_comment_id:bidId(2),seq:2,identities:1,second_best:null,price_change:'200'});
    expect(d.coverage.posted_bids_recorded_after_cutoff).toBe(1);
  });
  it('keeps a bounded refusal distinct from zero and never falls back to another reader',async()=>{
    mock.rpc.mockResolvedValueOnce({data:{state:'unavailable',reason:'bid_state_limit_exceeded'},error:null});
    expect(await fetchBidPath(BID_VEHICLE,BID_LOT,{})).toEqual({state:'unavailable',reason:'bid_state_limit_exceeded'});
    mock.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}});
    await expect(fetchBidPath(BID_VEHICLE,BID_LOT,{})).rejects.toMatchObject({code:'PGRST202'});
    expect(mock.rpc.mock.calls.every(c=>c[0]==='lot_order_book_read'&&c[1].p_request)).toBe(true);
  });
  it.each([
    ['wrong vehicle',(d:BidPathReceipt)=>{d.vehicle_id=BID_LOT;}],
    ['wrong auction',(d:BidPathReceipt)=>{d.auction_event_id=BID_VEHICLE;}],
    ['unknown method',(d:BidPathReceipt)=>{d.method_version=2 as 1;}],
    ['assumed dollars',(d:BidPathReceipt)=>{d.units.amounts='USD';}],
    ['uncited currency',(d:BidPathReceipt)=>{d.amount_context.currency_code='USD';d.amount_context.currency_state='recorded_claim';}],
    ['future recording',(d:BidPathReceipt)=>{d.states[0].db_recorded_at='2026-12-01T00:00:00Z';}],
    ['duplicate source row',(d:BidPathReceipt)=>{d.states[1].bid_comment_id=d.states[0].bid_comment_id;}],
    ['wrong source anchor',(d:BidPathReceipt)=>{d.states[0].source_url='https://example.test/';}],
    ['out-of-order source clock',(d:BidPathReceipt)=>{d.states[1].posted_at='2026-11-25T19:00:00Z';d.states[1].seconds_to_close=7200;}],
    ['incorrect high-bid change',(d:BidPathReceipt)=>{d.states[4].price_change='-25';}],
    ['incorrect top-two gap',(d:BidPathReceipt)=>{d.states[4].top_two_gap='50';}],
    ['wrong depth order',(d:BidPathReceipt)=>{d.states[4].depth_90=4;}],
    ['wrong book depth',(d:BidPathReceipt)=>{d.book[0].depth_at_revealed_bid=2;}],
    ['wrong highest support',(d:BidPathReceipt)=>{d.book[1].highest_bid_comment_id=bidId(1);}],
    ['wrong first support',(d:BidPathReceipt)=>{d.book[1].first_bid_comment_id=bidId(4);}],
    ['missing entry support',(d:BidPathReceipt)=>{d.book[1].supporting_bid_comment_ids=[bidId(4)];d.book[1].bid_count=1;d.book[1].first_bid_comment_id=bidId(4);}],
    ['wrong participant support',(d:BidPathReceipt)=>{d.book[1].supporting_bid_comment_ids=[bidId(0),bidId(4)];d.book[1].first_bid_comment_id=bidId(0);}],
    ['missing coverage',(d:BidPathReceipt)=>{delete (d.coverage as Partial<typeof d.coverage>).bid_marked_unknown_recording_time;}],
    ['wrong state count',(d:BidPathReceipt)=>{d.coverage.eligible_bid_states=6;}],
    ['wrong selection',(d:BidPathReceipt)=>{d.selected_bid_comment_id=bidId(0);}],
  ])('withholds %s',(_label,mutate)=>{const d=bidFixture();mutate(d);expect(()=>check(d)).toThrow('Unsupported bid-path');});
  it('preserves exact decimal labels above JavaScript integer precision',()=>{
    expect(formatBidAmount('9007199254740993.123456')).toBe('9,007,199,254,740,993.123456');
    expect(formatBidAmount('100.25')).toBe('100.25');expect(formatBidAmount('100.00')).toBe('100.00');
    expect(formatBidAmount(null)).toBe('unknown');expect(bidDecimal('100.25')).toBe(100250000n);
    expect(()=>bidDecimal('NaN')).toThrow();expect(()=>bidDecimal('1000000000000000001')).toThrow();
    expect(()=>bidDecimal('1.0000001')).toThrow();
  });
  it('keeps a full native comment ID in the source anchor without rounding it',()=>{
    const d=bidFixture();d.states[4].native_comment_id='9223372036854775807';
    d.states[4].source_url=d.source_url+'#comment-9223372036854775807';expect(()=>check(d)).not.toThrow();
  });
  it('accepts known zero eligible inputs with explicit source-clock gaps',()=>{
    const d=bidFixture();d.states=[];d.book=[];d.selected_seq=null;d.selected_bid_comment_id=null;
    d.coverage.eligible_bid_states=0;d.coverage.eligible_bids_without_platform_key=0;d.coverage.bid_marked_unknown_event_time=5;
    d.summary={...d.summary,bid_count:0,keyed_participant_count:0,unresolved_bid_entries:0,first_bid_at:null,last_bid_at:null,
      running_high_bid:null,minimum_bid:null,latest_bid:null,bids_in_60_minutes_to_event_cutoff:0,bids_in_10_minutes_to_event_cutoff:0};
    expect(()=>check(d)).not.toThrow();
  });
});

describe('shared episode and bid-selection URL',()=>{
  it('pins source/hash and both current clocks when selecting a real point',()=>{
    const d=bidFixture();const next=selectBidParams(new URLSearchParams(`lot=${BID_LOT}&layer=fold&csFilter=text`),d,bidId(1));
    expect(bidRequestFromParams(next)).toEqual({selected_bid_comment_id:bidId(1),snapshot_hash:d.snapshot_hash,
      event_cutoff:BID_CLOSE,recorded_cutoff:d.recorded_cutoff});expect(next.get('csFilter')).toBe('text');
    const reset=clearBidSelection(next);expect(reset.get('lot')).toBe(BID_LOT);expect(reset.has('bpHash')).toBe(false);expect(reset.has('at')).toBe(false);
  });
  it('shares the comment reconstruction cutoff, with no second time control',()=>{
    const r={knowledge_mode:'recorded_input_reconstruction' as const,cutoff:'2026-11-25T20:52:00Z'},d=bidFixture(r);
    const params=selectBidParams(new URLSearchParams('layer=fold&csCutoff='+encodeURIComponent(r.cutoff)),d,bidId(0));
    expect(bidRequestFromParams(params)).toEqual({...r,selected_bid_comment_id:bidId(0),snapshot_hash:d.snapshot_hash});
    expect(params.has('bpEvent')).toBe(false);
  });
  it.each(['at=bad','bpHash=bad','bpEvent=2026-11-25T20%3A52%3A00Z','bpHash='+('1'.repeat(32)),
    'csCutoff=yesterday','csCutoff=2026-11-25T20%3A52%3A00','at='+bidId(0)+'&at='+bidId(1),
    'csCutoff=2026-11-25T20%3A52%3A00Z&bpEvent=2026-11-25T20%3A52%3A00Z'])('does not guess missing or invalid context: %s',s=>{
    expect(bidRequestFromParams(new URLSearchParams(s))).toBeNull();
  });
  it('refuses a point outside the actual measured path',()=>{
    expect(()=>selectBidParams(new URLSearchParams(),bidFixture(),BID_LOT)).toThrow('outside');
  });
});

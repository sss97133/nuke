import { describe, expect, it } from 'vitest';
import { decodeStudy, encodeStudy, evaluateBidExpression, foldSoldLot, makeStudy, measured, percentile, participantBehaviorMap, type BidExpression, type BidLot, type StudyBid } from './bidMeasurements';
import { expressionFromParams } from './bidExpression';

const expression: BidExpression = { measure:'increment', grouping:'make', from:2016, to:2026, make:null, model:null, weighting:'auction' };
const capture = '2026-10-08T05:29:00Z';
function sequence(id: string, amounts: number[], options: { make?: string; model?: string; year?: number; posted?: string[] } = {}) {
  const lot: BidLot = { id, vehicle_id:`v-${id}`, source:'bat', source_url:`https://bringatrailer.com/listing/test-${id}/`,
    auction_end_date: options.posted ? '2026-01-02T20:00:00Z' : '2026-10-01T20:00:00Z', total_bids:amounts.length,
    winning_bid:String(amounts[amounts.length - 1]), winning_bidder_external_identity_id:'a',
    vehicles:{id:`v-${id}`,year:options.year ?? 2002,make:options.make ?? 'Chevrolet',model:options.model ?? 'Corvette Z06',normalized_model:'Corvette'} };
  const bids: StudyBid[] = amounts.map((amount,i) => ({ id:`${id}-${i}`,auction_event_id:id,vehicle_id:lot.vehicle_id,
    source_url:lot.source_url.slice(0,-1),posted_at:options.posted?.[i] ?? `2026-10-01T19:${String(i * 10).padStart(2,'0')}:00Z`,
    created_at:capture,bid_amount:String(amount),external_identity_id:i % 2 ? 'b' : 'a',bat_comment_id:i + 1,author_username:i % 2 ? 'B' : 'A' }));
  return {lot,bids};
}
const dataset = (...episodes: ReturnType<typeof sequence>[]) => makeStudy(episodes.map(e => e.lot),episodes.flatMap(e => e.bids),capture,'Synthetic unit population',false);

describe('complete sequence measurements', () => {
  it('forms increments inside an exact episode; the opening bid has no invented raise', () => {
    const e = sequence('one',[100,200,300]), reading = foldSoldLot(e.lot,e.bids.reverse()).reading!;
    expect(reading.sums).toMatchObject({bids:3,bidSum:600,raises:2,raiseSum:200,relativeSum:150,gaps:[600,600]});
    expect(measured(reading.sums,'amount')?.value).toBe(200);
    expect(measured(reading.sums,'relative')?.value).toBe(75);
    expect(measured(reading.sums,'typical')?.value).toBe(75);
    expect(reading.actors.find(a => a.identity === 'a')).toMatchObject({bids:2,raises:1,raiseSum:100,relativeSum:50,entrySeconds:0,topBid:300});
    const openingOnly = sequence('opening',[100]);
    expect(measured(foldSoldLot(openingOnly.lot,openingOnly.bids).reading!.sums,'increment')).toBeNull();
  });
  it('withholds incomplete, conflicting, duplicate and cross-episode evidence', () => {
    const e = sequence('one',[100,200,300]);
    expect(foldSoldLot({...e.lot,total_bids:4},e.bids).reason).toBe('reported bid count mismatch');
    expect(foldSoldLot({...e.lot,winning_bid:301},e.bids).reason).toBe('terminal bid does not reproduce hammer');
    expect(foldSoldLot(e.lot,[...e.bids.slice(0,2),{...e.bids[2],vehicle_id:'other'}]).reason).toBe('reported bid count mismatch');
    expect(foldSoldLot(e.lot,[e.bids[0],{...e.bids[1],id:e.bids[0].id},e.bids[2]]).reason).toBe('duplicate retained event');
    expect(foldSoldLot(e.lot,[e.bids[0],{...e.bids[1],bid_amount:50},e.bids[2]]).reason).toBe('sequence conflict');
    expect(foldSoldLot(e.lot,[e.bids[0],{...e.bids[1],bid_amount:Infinity},e.bids[2]]).reading).toBeNull();
    expect(foldSoldLot({...e.lot,winning_bid:Infinity},e.bids).reading).toBeNull();
  });
  it('requires source ordering for simultaneous events instead of ordering by ingestion time', () => {
    const e = sequence('one',[100,200,300]); e.bids[1].posted_at = e.bids[0].posted_at;
    expect(foldSoldLot(e.lot,[...e.bids].reverse()).reading?.sums.gaps).toEqual([0,1200]);
    e.bids[1].bat_comment_id = null;
    expect(foldSoldLot(e.lot,e.bids).reason).toBe('unresolved source order');
  });
  it('keeps price measurements but withholds participant totals when identity coverage is incomplete', () => {
    const e = sequence('one',[100,200,300]); e.bids[1].external_identity_id = null;
    const s = foldSoldLot(e.lot,e.bids).reading!.sums;
    expect(measured(s,'increment')?.value).toBe(100);
    expect(measured(s,'participants')).toBeNull();
  });
});

describe('grouping and reference population', () => {
  it('reduces a tiny-opening jump with a record median while preserving the arithmetic mean as a separate measure', () => {
    const d = dataset(sequence('one',[1,10000,11000,12000]));
    const typical = evaluateBidExpression(d,{...expression,measure:'typical'});
    const arithmetic = evaluateBidExpression(d,{...expression,measure:'relative'});
    expect(typical.groups[0].mean).toBeCloseTo(10);
    expect(arithmetic.groups[0].mean).toBeGreaterThan(300000);
  });
  it('distinguishes an equal-auction mean from a bid-weighted mean with the actual denominators', () => {
    const d = dataset(sequence('one',[100,200,300]),sequence('two',[1000,2000]));
    const equal = evaluateBidExpression(d,expression), weighted = evaluateBidExpression(d,{...expression,weighting:'bid'});
    expect(equal.groups[0].mean).toBe(550);
    expect(weighted.groups[0].mean).toBe(400);
    expect(weighted.groups[0].observations).toBe(3);
    expect(equal).toMatchObject({bidN:5,raiseN:3,contributingLots:2});
  });
  it('assigns a New Year raise to the later event while retaining the preceding year’s standing bid', () => {
    const cross = sequence('cross',[100,150,300],{posted:['2025-12-31T23:59:00Z','2026-01-01T00:01:00Z','2026-01-01T00:03:00Z']});
    const d = dataset(cross), result = evaluateBidExpression(d,{...expression,grouping:'year',from:2026,to:2026});
    expect(result.groups[0]).toMatchObject({year:2026,mean:100,observations:2});
    expect(result).toMatchObject({bidN:2,raiseN:2});
    expect(evaluateBidExpression(d,{...expression,grouping:'participant',from:2026,to:2026}).groups).toHaveLength(0);
  });
  it('changes contributors by make, model and vehicle year independently of the bid calendar year', () => {
    const d = dataset(sequence('one',[100,200],{year:2002}),sequence('two',[100,300],{year:2003}),sequence('ford',[100,400],{make:'Ford',model:'Mustang'}));
    const result = evaluateBidExpression(d,{...expression,make:'chevrolet',model:'Corvette',vehicleYear:2002,grouping:'auction',from:2026});
    expect(result.groups.map(g => g.key)).toEqual(['one']);
    expect(result.groups[0].mean).toBe(100);
  });
  it('keeps canonical participant records and counts only captured, attributed outcomes', () => {
    const d = dataset(sequence('one',[100,200,300]),sequence('two',[100,200,300]));
    d.lots[1].winner = null;
    const result = evaluateBidExpression(d,{...expression,grouping:'participant'});
    expect(result.groups.find(g => g.key === 'a')).toMatchObject({mean:100,wins:1,knownOutcomes:1,lotIds:['one','two']});
    expect(result.groups.find(g => g.key === 'b')).toMatchObject({wins:0,knownOutcomes:1});
  });
  it('preserves conflicting winner testimony while withholding it from win conversion', () => {
    const e = sequence('one',[100,200,300]); e.lot.winning_bidder_external_identity_id = 'b';
    const d = dataset(e);
    expect(d.lots[0]).toMatchObject({winner:null,recordedWinner:'b',winnerConflict:true});
    expect(evaluateBidExpression(d,{...expression,grouping:'participant',measure:'winRate'}).groups).toHaveLength(0);
    expect(evaluateBidExpression(d,expression).groups[0].mean).toBe(100);
    expect(decodeStudy(JSON.parse(JSON.stringify(encodeStudy(d))))).toEqual(d);
  });
  it('ranks captured win conversion against participant rates instead of binary auction outcomes', () => {
    const d = dataset(...Array.from({length:5},(_,i) => sequence(String(i),[100,200,300])));
    const result = evaluateBidExpression(d,{...expression,grouping:'participant',measure:'winRate'});
    expect(result.rankValues).toEqual([100,0]);
    expect(result.groups.find(g => g.key === 'a')).toMatchObject({mean:100,percentile:75,wins:5,knownOutcomes:5});
    expect(result.groups.find(g => g.key === 'b')).toMatchObject({mean:0,percentile:25,wins:0,knownOutcomes:5});
  });
  it('normalizes entry to the observed source span and pairs both behavior-map axes to the same episodes', () => {
    const d = dataset(...Array.from({length:6},(_,i) => sequence(String(i),[100,200,300])));
    d.lots[0].winner = null;
    const map = participantBehaviorMap(d,expression);
    expect(map.find(p => p.identity === 'a')).toMatchObject({n:5,entryPct:0,winRate:100});
    expect(map.find(p => p.identity === 'b')).toMatchObject({n:5,entryPct:50,winRate:0});
    expect(map[0].lotIds).not.toContain('0');
  });
  it('uses midranks and preserves exact ties; one auction can have a supported population percentile', () => {
    expect(percentile([1,2,2,4],2)).toBe(50);
    const d = dataset(...[100,200,300,400,500].map((raise,i) => sequence(String(i),[100,100 + raise])));
    const result = evaluateBidExpression(d,{...expression,grouping:'auction'});
    expect(result.groups.find(g => g.key === '2')).toMatchObject({mean:300,percentile:50,supported:false});
    expect(result.values).toHaveLength(5);
  });
  it('round trips canonical IDs, precision, calendar partitions and attribution through the transfer encoding', () => {
    const d = dataset(sequence('one',[100,203,509]),sequence('cross',[100,150,300],{posted:['2025-12-31T23:59:00Z','2026-01-01T00:01:00Z','2026-01-01T00:03:00Z']}));
    const retained = decodeStudy(JSON.parse(JSON.stringify(encodeStudy(d))));
    expect(retained).toEqual(d);
    expect(evaluateBidExpression(retained,{...expression,grouping:'participant'})).toEqual(evaluateBidExpression(d,{...expression,grouping:'participant'}));
    expect(() => decodeStudy({contract:0})).toThrow();
  });
  it('restores a shared expression and rejects invalid or incompatible URL fields', () => {
    expect(expressionFromParams(new URLSearchParams('measure=amount&by=model&from=2016&to=2026&make=Chevrolet&model=Corvette&vehicleYear=2002&weight=bid')))
      .toMatchObject({measure:'amount',grouping:'model',from:2016,to:2026,make:'Chevrolet',model:'Corvette',vehicleYear:2002,weighting:'bid'});
    expect(expressionFromParams(new URLSearchParams('measure=participants&by=participant&from=1900&to=9999&vehicleYear=-1')))
      .toMatchObject({measure:'typical',grouping:'participant',from:2014,to:new Date().getUTCFullYear(),vehicleYear:null});
  });
});

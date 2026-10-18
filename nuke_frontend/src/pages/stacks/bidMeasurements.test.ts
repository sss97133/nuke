import { describe, expect, it } from 'vitest';
import { decodeStudy, encodeStudy, evaluateBidExpression, foldSoldLot, makeStudy, measured, emptySums, mergeSums, percentile, participantBehaviorMap, type BidExpression, type BidLot, type StudyBid } from './bidMeasurements';
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
function pairedReference(d: ReturnType<typeof dataset>, e: BidExpression) {
  const entries=evaluateBidExpression(d,{...e,grouping:'participant',measure:'entry',weighting:'auction'});
  const wins=evaluateBidExpression(d,{...e,grouping:'participant',measure:'winRate',weighting:'auction'});
  const byIdentity=new Map(entries.groups.map(g=>[g.key,new Map(g.members.map(m=>[m.lotId,m.value]))]));
  return wins.groups.flatMap(g=>{
    const times=byIdentity.get(g.key),pairs=g.members.filter(m=>times?.has(m.lotId));
    if(pairs.length<5)return [];
    return [{identity:g.key,n:pairs.length,entryPct:pairs.reduce((n,m)=>n+times!.get(m.lotId)!,0)/pairs.length,
      winRate:pairs.reduce((n,m)=>n+m.value,0)/pairs.length,lotIds:pairs.map(m=>m.lotId)}];
  });
}

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
  it('withholds unsupported participant ranks when no record meets the comparison minimum', () => {
    const result = evaluateBidExpression(dataset(sequence('one',[100,200,300])),{...expression,measure:'winRate',grouping:'participant'});
    expect(result.rankValues).toEqual([]);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups.every(g => g.percentile === 0 && !g.supported)).toBe(true);
  });
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
  it('preserves the independent entry/outcome join across full-year, make, model, vehicle-year and empty scopes', () => {
    const d=dataset(...Array.from({length:18},(_,i)=>sequence(String(i),[100,213,521],{make:i<9?'Chevrolet':'Porsche',year:i%2?2002:2003})),
      sequence('cross',[100,213,521],{posted:['2025-12-31T23:59:00Z','2026-01-01T00:01:00Z','2026-01-01T00:03:00Z']}));
    d.lots[0].winner=null;d.lots[1].winnerConflict=true;d.lots[1].winner=null;
    d.lots[2].sums.gaps=[0,0];d.lots[3].model='Other model';
    for(const lot of d.lots)for(const actor of lot.actors)actor.handle=actor.identity==='a'?'Zulu':'Alpha';
    for(const patch of [{},{from:2026},{from:2016,to:2025},{make:'CHEVROLET'},{make:'porsche'},
      {model:'Corvette'},{model:'Other model'},{vehicleYear:2002},{vehicleYear:2003},{make:'Absent'}]) {
      const e={...expression,...patch};
      expect(participantBehaviorMap(d,e)).toEqual(pairedReference(d,e));
    }
    expect(participantBehaviorMap(d,{...expression,from:2026}).every(p=>!p.lotIds.includes('cross'))).toBe(true);
  });
  it('keeps all known-outcome ordering while requiring five paired records and preserving repeated-projection joins', () => {
    const d=dataset(...Array.from({length:5},(_,i)=>sequence(String(i),[100,200,300])),sequence('opening',[100]));
    for(const lot of d.lots)for(const actor of lot.actors)actor.handle=actor.identity==='a'?'Zulu':'Alpha';
    const points=participantBehaviorMap(d,expression);
    expect(points.map(p=>p.identity)).toEqual(['a','b']);
    expect(points.every(p=>p.n===5 && !p.lotIds.includes('opening'))).toBe(true);
    expect(points).toEqual(pairedReference(d,expression));
    expect(participantBehaviorMap({...d,lots:d.lots.slice(0,4)},expression)).toEqual([]);
    // The legacy join keeps the final entry for an identity/episode while wins retain record order.
    d.lots.push({...d.lots[0],actors:d.lots[0].actors.map(a=>({...a,entrySeconds:a.entrySeconds+13.25}))});
    expect(participantBehaviorMap(d,expression)).toEqual(pairedReference(d,expression));
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


describe('scoped measurement vector reuse',()=>{
  it('preserves canonical year merges, duplicate identities, unsupported records and input vectors across measures',()=>{
    const cross=sequence('cross',[100,175,325],{posted:['2025-12-31T23:50:00Z','2026-01-01T00:01:00Z','2026-01-01T00:21:00Z']});
    const d=dataset(cross,sequence('single',[100,170,280]),sequence('opening',[100]));
    for(const lot of d.lots)for(const sums of Object.values(lot.years))sums.identityIds.push(...sums.identityIds);
    // This encoding is admitted by the existing decoder; identity dedup remains required.
    const held=decodeStudy(JSON.parse(JSON.stringify(encodeStudy(d)))),before=structuredClone(held);
    for(const lot of held.lots)for(const sums of Object.values(lot.years)){
      Object.freeze(sums.gaps);Object.freeze(sums.relativeValues);Object.freeze(sums.identityIds);
    }
    for(const [from,to] of [[2025,2025],[2026,2026],[2025,2026],[2024,2024]]){
      const scoped=held.lots.map(l=>({lot:l,sums:Object.entries(l.years).filter(([year])=>Number(year)>=from && Number(year)<=to)
        .reduce((a,[,b])=>mergeSums(a,b),emptySums())}));
      for(const measure of ['amount','increment','relative','typical','spacing','participants','bids'] as const){
        const r=evaluateBidExpression(held,{...expression,measure,grouping:'auction',from,to});
        const eligible=scoped.filter(l=>l.sums.bids>0),supported=eligible.flatMap(l=>{const m=measured(l.sums,measure);return m?[{lot:l.lot,m}]:[];});
        expect(r.eligibleLots).toBe(eligible.length);expect(r.contributingLots).toBe(supported.length);
        expect(r.bidN).toBe(eligible.reduce((n,l)=>n+l.sums.bids,0));expect(r.raiseN).toBe(eligible.reduce((n,l)=>n+l.sums.raises,0));
        expect(r.withheldRecordN).toBe(eligible.length-supported.length);
        expect(r.groups.map(g=>[g.key,g.mean,g.observations]).sort()).toEqual(supported.map(l=>[l.lot.id,l.m.value,l.m.observations]).sort());
      }
      for(const grouping of ['make','model','year','participant'] as const)evaluateBidExpression(held,{...expression,grouping,from,to});
    }
    expect(held).toEqual(before);
    expect(evaluateBidExpression(held,{...expression,measure:'participants',grouping:'auction',from:2026,to:2026}).groups.find(g=>g.key==='single')?.mean).toBe(2);
  });
  it('counts supported-window episodes independently of a withheld participant crossing-year record',()=>{
    const cross=sequence('cross',[100,200,300],{posted:['2025-12-31T23:59:00Z','2026-01-01T00:01:00Z','2026-01-01T00:04:00Z']});
    const d=dataset(cross,sequence('same-year',[100,200,300]));
    const r=evaluateBidExpression(d,{...expression,grouping:'participant',measure:'winRate',from:2026,to:2026});
    expect(r.eligibleLots).toBe(2);expect(r.contributingLots).toBe(1);expect(r.withheldRecordN).toBe(d.lots[0].actors.length);
    expect(r.groups.flatMap(g=>g.lotIds)).toEqual(['same-year','same-year']);
  });
});

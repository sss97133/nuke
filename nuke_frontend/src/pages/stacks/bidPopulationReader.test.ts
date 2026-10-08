import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ reads:[] as Array<{table:string;calls:Array<[string,unknown[]]>}>, responses:[] as Array<{data:unknown;error:unknown}> }));
vi.mock('../../lib/supabase', () => ({supabase:{from:(table:string) => {
  const read = {table,calls:[] as Array<[string,unknown[]]>}; fixture.reads.push(read);
  const q: Record<string,(...args:unknown[]) => unknown> = {then:(fn:unknown) => Promise.resolve(fixture.responses.shift() ?? {data:[],error:null}).then(fn as (value:unknown) => unknown)};
  for (const method of ['select','in','eq','gte','lt','is','or','order','limit','abortSignal','gt']) q[method] = (...args) => {read.calls.push([method,args]); return q;};
  return q;
}}}));
import { POPULATION_LIMIT, readBidPopulation } from './bidPopulationReader';
import type { BidLot, StudyBid } from './bidMeasurements';

const lot: BidLot = {id:'lot',vehicle_id:'v',source:'bat',source_url:'https://bringatrailer.com/listing/test/',auction_end_date:'2026-09-01T20:00:00Z',total_bids:2,winning_bid:200,winning_bidder_external_identity_id:'a',vehicles:{id:'v',year:2002,make:'Chevrolet',model:'Corvette',normalized_model:'Corvette'}};
const bid = (i:number): StudyBid => ({id:String(i).padStart(6,'0'),auction_event_id:'lot',vehicle_id:'v',source_url:lot.source_url,posted_at:'2026-09-01T19:00:00Z',created_at:'2026-10-01T00:00:00Z',bid_amount:i,external_identity_id:'a',author_username:'source-handle',bat_comment_id:i});
const respond = (data:unknown,error:unknown = null) => fixture.responses.push({data,error});
beforeEach(() => {fixture.reads = []; fixture.responses = [];});

it('gates both episodes and child bids to publicly readable non-deleted vehicle parents', async () => {
  respond([lot]); respond([bid(100),bid(200)]); respond([]);
  const abort = new AbortController(), study = await readBidPopulation({make:'Chevrolet',model:null,year:2026},abort.signal);
  expect(study.lots).toHaveLength(1);
  expect(study.lots[0].sums).toMatchObject({bids:2,raises:1,raiseSum:100});
  for (const r of fixture.reads) {
    expect(r.calls).toContainEqual(['eq',['vehicles.is_public',true]]);
    expect(r.calls).toContainEqual(['is',['vehicles.deleted_at',null]]);
    expect(r.calls).toContainEqual(['or',['listing_kind.is.null,listing_kind.neq.non_vehicle_item',{referencedTable:'vehicles'}]]);
    expect(r.calls).toContainEqual(['abortSignal',[abort.signal]]);
    expect(r.calls.find(c => c[0] === 'select')?.[1][0]).toContain('vehicles!inner');
  }
  expect(fixture.reads[0].calls).toContainEqual(['limit',[POPULATION_LIMIT + 1]]);
  expect(fixture.reads[0].calls).toContainEqual(['in',['vehicles.make',['Chevrolet','chevrolet','CHEVROLET']]]);
  expect(fixture.reads[2].calls).toContainEqual(['gt',['id','000200']]);
});
it('reads through a full transport page to an empty boundary instead of trusting the response length', async () => {
  respond([{...lot,total_bids:1001,winning_bid:1001}]);
  respond(Array.from({length:1000},(_,i) => bid(i + 1))); respond([bid(1001)]); respond([]);
  const study = await readBidPopulation({make:null,model:null,year:2026});
  expect(study.lots[0].sums.bids).toBe(1001);
  expect(fixture.reads.filter(r => r.table === 'auction_comments')).toHaveLength(3);
});
it('declares candidate truncation and never substitutes missing sequences as measured zeros', async () => {
  respond(Array.from({length:121},(_,i) => ({...lot,id:`lot-${i}`}))); respond([]); respond([]); respond([]);
  const study = await readBidPopulation({make:null,model:null,year:2026});
  expect(study).toMatchObject({candidateN:120,capped:true,lots:[]});
  expect(study.exclusions).toHaveLength(120);
});
it('fails the requested reading when a later page fails, preserving no partial measurement result', async () => {
  respond([lot]); respond([bid(100)]); respond(null,{message:'failed'});
  await expect(readBidPopulation({make:null,model:null,year:2026})).rejects.toThrow('completely');
});
it('detects a broken primary-key continuation', async () => {
  respond([lot]); respond([bid(100)]); respond([bid(100)]);
  await expect(readBidPopulation({make:null,model:null,year:2026})).rejects.toThrow('boundary');
});
it('validates the calendar request before making a remote read', async () => {
  await expect(readBidPopulation({make:null,model:null,year:1900})).rejects.toThrow('supported');
  expect(fixture.reads).toHaveLength(0);
});

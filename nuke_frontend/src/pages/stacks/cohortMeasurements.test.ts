import { expect, it } from 'vitest';
import { makeStudy, type BidLot, type StudyBid } from './bidMeasurements';
import { cohortReadings } from './cohortMeasurements';
import { expressionFromParams, stackBackParams } from './bidExpression';
import type { OrderBookRead } from './orderBookReader';

it.each(['', '/stacks?'])('inherits the contributor study from either return encoding %s', prefix => {
  const expression = expressionFromParams(stackBackParams(`${prefix}stack=SA&by=auction&measure=spacing&from=2018&to=2018&make=Porsche&model=911`));
  expect(expression).toMatchObject({from:2018,to:2018,measure:'spacing',make:'Porsche',model:'911'});
});

function fixture() {
  const lots:BidLot[] = [], bids:StudyBid[] = [];
  for(let i=0;i<8;i++) {
    const lot:BidLot={id:`lot-${i}`,vehicle_id:i === 1 ? 'vehicle-0' : `vehicle-${i}`,source:'bat',source_url:`https://bringatrailer.com/listing/cohort-${i}/`,auction_end_date:'2026-10-01T20:00:00Z',total_bids:3,winning_bid:300+i*100,winning_bidder_external_identity_id:'winner',vehicles:{id:i === 1 ? 'vehicle-0' : `vehicle-${i}`,year:i<4 ? 2000 : 2001,make:i<7 ? 'Chevrolet' : 'Ford',model:'Source Coupe',normalized_model:i<7 ? 'Corvette' : 'Mustang'}};
    lots.push(lot);
    [100,200+i*100,300+i*100].forEach((bid_amount,j) => bids.push({id:`bid-${i}-${j}`,auction_event_id:lot.id,vehicle_id:lot.vehicle_id,source_url:lot.source_url,posted_at:`2026-10-01T19:${j}0:00Z`,created_at:'2026-10-02T00:00:00Z',bid_amount,external_identity_id:'winner',author_username:'W',bat_comment_id:j+1}));
  }
  const dataset=makeStudy(lots,bids,'2026-10-08T05:29:00Z','Synthetic nonprobability study',false), first=lots[0];
  const read:OrderBookRead={vehicle:{id:first.vehicle_id,year:2000,make:'Chevrolet',model:'Source Coupe',listing_url:first.source_url,sale_status:'sold'},lot:{id:first.id,source:first.source,source_url:first.source_url,lot_number:'1',outcome:'sold',auction_end_date:first.auction_end_date,high_bid:300,winning_bid:300,total_bids:3,seller_name:null,seller_external_identity_id:null,winning_bidder:'W',winning_bidder_external_identity_id:'winner',updated_at:dataset.readAt},lots:[],comments:bids.filter(b => b.auction_event_id === first.id).map(b => ({...b,comment_type:'bid',is_seller:false,comment_text:null})),unkeyedOnUrl:0,frames:[],identities:{},readAt:dataset.readAt};
  return {dataset,read};
}
it('excludes every episode of the selected vehicle and retains the selected reading outside the peer denominator',() => {
  const {dataset,read}=fixture(), a=cohortReadings(dataset,read,'model','typical');
  expect(a.model).toBe('Corvette');expect(a.result.eligibleLots).toBe(5);expect(a.result.rankValues).toHaveLength(5);
  expect(a.result.groups.flatMap(g => g.lotIds)).not.toContain('lot-1');expect(a.reading).toBe(75);
});
it('changes the vehicle model year cohort independently of the bid calendar year and can widen to the make',() => {
  const {dataset,read}=fixture(), a=cohortReadings(dataset,read,'vehicleYear','bids');
  expect(a.expression.from).toBe(2016);expect(a.expression.to).toBe(2026);expect(a.expression.vehicleYear).toBe(2000);
  expect(a.result.rankValues).toHaveLength(2);
  const broad=cohortReadings(dataset,read,'make','spacing');
  expect(broad.expression.model).toBeNull();expect(broad.result.rankValues).toHaveLength(5);
});
it('keeps the inherited bid calendar window instead of silently using all retained years', () => {
  const {dataset,read}=fixture();
  const a=cohortReadings(dataset,read,'model','amount',{from:2025,to:2025});
  expect(a.expression.from).toBe(2025);expect(a.expression.to).toBe(2025);
  expect(a.expression.measure).toBe('amount');
  expect(a.result.rankValues).toHaveLength(0);expect(a.reading).toBeNull();
});
it('admits an uncaptured source episode through the same complete-sequence gate without changing the study',() => {
  const {dataset,read}=fixture(); dataset.lots=dataset.lots.filter(l => l.vehicleId !== read.vehicle.id);
  read.vehicle.model='Corvette';const before=dataset.lots.length;
  const a=cohortReadings(dataset,read,'model','typical');
  expect(a.reading).toBe(75);expect(a.subject?.modelBasis).toBe('source-label');expect(a.admissionFailure).toBeNull();expect(dataset.lots).toHaveLength(before);
});
it('withholds a live episode even if an older held capture has a completed measurement',() => {
  const {dataset,read}=fixture();read.lot!.outcome='live';
  const a=cohortReadings(dataset,read,'model','typical');
  expect(a.reading).toBeNull();expect(a.admissionFailure).toContain('not recorded sold');expect(a.result.rankValues).toHaveLength(5);
});
it('does not infer a normalized model from similar source text or manufacture a reading from an incomplete sequence',() => {
  const {dataset,read}=fixture();dataset.lots=dataset.lots.filter(l => l.vehicleId !== read.vehicle.id);
  read.vehicle.model='Corvette-like custom';
  expect(cohortReadings(dataset,read,'model','typical').result.rankValues).toHaveLength(0);
  read.comments.pop();
  const a=cohortReadings(dataset,read,'model','typical');
  expect(a.reading).toBeNull();expect(a.model).toBeNull();expect(a.effectiveScope).toBe('make');expect(a.admissionFailure).toBe('reported bid count mismatch');
});

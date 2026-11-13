import { expect, it } from 'vitest';
import { recentAuctionEnd, mergeMarketplaceAuctions, auctionPlatform, auctionHouse, type MarketplaceAuction } from './AuctionMarketplace';
import type { MarketPulse, LiveAuction, TapeBid } from './market/useMarketPulse';
const now = Date.parse('2026-11-08T18:00:00Z');
const lot: LiveAuction = { id:'v', house:'ebay-motors', listingUrl:'https://www.ebay.com/itm/123', year:1990, make:'Ford', model:'F-150', currentBid:1234.25, currency:'USD', endsAt:now+60000, updatedAt:now-60000, listedAt:now-86400000, imageUrl:null, noReserve:false, title:null, band:null };
const event = (platform:string, url:string): MarketplaceAuction => ({id:url, source_observed_at:new Date(now).toISOString(), vehicle_id:'v', platform, source_url:url, end_time:new Date(now+60000).toISOString(), current_price_cents:100, currency_code:'USD', bid_count:3, comment_count:null, no_reserve:false, vehicle:{id:'v',year:1990,make:'Ford',model:'F-150',trim:null,mileage:null,primary_image_url:null}});
const board = (auctions:LiveAuction[]= [lot]) => ({auctions,houses:[{house:'ebay-motors',onBoard:true},{house:'cars-and-bids',onBoard:false}]} as MarketPulse);
it('includes canonical eBay inventory without duplicating its episode, preserves another eBay episode and removes held house inventory',()=>{
 const rows=mergeMarketplaceAuctions([event('ebay_motors',lot.listingUrl!),event('ebay_motors','https://www.ebay.com/itm/456'),event('cars_and_bids','https://carsandbids.com/auctions/held')],board(),[],now);
 expect(rows).toHaveLength(2);
 expect(rows.find(r=>r.source_url===lot.listingUrl)).toMatchObject({platform:'ebay_motors',current_price_cents:123425,bid_count:3});
 expect(rows.some(r=>r.platform==='cars_and_bids')).toBe(false);
});
it('lands only matching episode receipts and preserves exact cents without borrowing another source bid',()=>{
 const receipt: TapeBid={id:'r',vehicleId:'v',house:'ebay-motors',sourceUrl:lot.listingUrl!,currency:'USD',eventKind:'bid_snapshot',bidAt:now,ingestedAt:now,amount:1350.50,endAt:null};
 const other: TapeBid={...receipt,id:'other',sourceUrl:'https://www.ebay.com/itm/456',amount:9999};
 expect(mergeMarketplaceAuctions([],board(),[receipt,other],now)[0]).toMatchObject({current_price_cents:135050,bid_count:null});
 expect(mergeMarketplaceAuctions([],board(),[],now+60001)).toEqual([]);
});

it('maps every established board alias to the event platform and back',()=>{ for(const [house,platform] of [['bringatrailer','bat'],['collecting-cars','collecting_cars'],['cars-and-bids','cars_and_bids'],['broad-arrow','broad_arrow'],['ebay-motors','ebay_motors']]) { expect(auctionPlatform(house)).toBe(platform); expect(auctionHouse(platform)).toBe(house); } });

it('preserves a shared Purple Wave episode independently of its canonical board listing',()=>{ const pulse=board([{...lot,house:'purplewave',listingUrl:'https://www.purplewave.com/auction/261111A/item/EX2391'}]); pulse.houses=[{house:'purplewave',onBoard:true,lots:1,readAt:now}]; const shared=event('purplewave','https://www.purplewave.com/auction/261111A/item/EX2392'); expect(mergeMarketplaceAuctions([shared],pulse,[],now)).toHaveLength(2); });

it('retains a fresh PW episode when the canonical board has no equivalent inventory but suppresses a stale witness',()=>{ const pulse=board([]);pulse.houses=[{house:'purplewave',onBoard:false,lots:0,readAt:null}];const lot=event('purplewave','https://www.purplewave.com/auction/261111A/item/EX2392');expect(mergeMarketplaceAuctions([lot],pulse,[],now)).toHaveLength(1);expect(mergeMarketplaceAuctions([{...lot,source_observed_at:new Date(now-7*3600000).toISOString()}],pulse,[],now)).toHaveLength(0); });


it('includes only finite ended clocks within the stated recent window',()=>{
 expect(recentAuctionEnd('2026-11-08T17:36:30Z',now)).toBe('2026-11-08T17:36:30.000Z');
 expect(recentAuctionEnd(new Date(now).toISOString(),now)).toBe(new Date(now).toISOString());
 expect(recentAuctionEnd(new Date(now-30*86400000).toISOString(),now)).not.toBeNull();
 for(const end of ['2437-07-20T18:00:00Z',new Date(now+1).toISOString(),new Date(now-30*86400000-1).toISOString(),'not a date','Infinity','',null,NaN]) {
   expect(recentAuctionEnd(end,now)).toBeNull();
 }
 expect(recentAuctionEnd('2026-11-08T17:36:30Z',NaN)).toBeNull();
});

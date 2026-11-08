import { expect, it } from 'vitest';
import { mergeMarketplaceAuctions, type MarketplaceAuction } from './AuctionMarketplace';
import type { MarketPulse, LiveAuction, TapeBid } from './market/useMarketPulse';
const now = Date.parse('2026-11-08T18:00:00Z');
const lot: LiveAuction = { id:'v', house:'ebay-motors', listingUrl:'https://www.ebay.com/itm/123', year:1990, make:'Ford', model:'F-150', currentBid:1234.25, currency:'USD', endsAt:now+60000, updatedAt:now-60000, listedAt:now-86400000, imageUrl:null, noReserve:false, title:null, band:null };
const event = (platform:string, url:string): MarketplaceAuction => ({id:url, vehicle_id:'v', platform, source_url:url, end_time:new Date(now+60000).toISOString(), current_price_cents:100, currency_code:'USD', bid_count:3, comment_count:null, no_reserve:false, vehicle:{id:'v',year:1990,make:'Ford',model:'F-150',trim:null,mileage:null,primary_image_url:null}});
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

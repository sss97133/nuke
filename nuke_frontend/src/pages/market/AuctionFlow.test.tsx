// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AuctionFlow, sourceActivity } from './AuctionFlow';
import type { TapeBid } from './useMarketPulse';
const now = Date.parse('2026-11-08T18:00:00Z');
const bid = (extra: Partial<TapeBid> = {}): TapeBid => ({ id: 'event', vehicleId: 'v', house: 'bringatrailer', sourceUrl: 'https://bringatrailer.com/listing/a', amount: 1234.25, currency: 'USD', bidAt: now - 2000, ingestedAt: now - 1000, endAt: null, eventKind: 'bid', ...extra });
afterEach(() => vi.useRealTimers());
it('counts unique admitted receipts in the window and never counts malformed or future clocks', () => {
 expect(sourceActivity([bid(),bid(),bid({id:'old',ingestedAt:now-301000}),bid({id:'future',ingestedAt:now+1000}),bid({id:'missing',ingestedAt:undefined})],now)).toHaveLength(1);
});
it('separates snapshots and recovery, retains quiet-source uncertainty, and pulses only new current evidence', async () => {
 vi.useFakeTimers(); vi.setSystemTime(now); (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'); const root=createRoot(host);
 const render=async(bids:TapeBid[],error=false)=>act(async()=>root.render(<AuctionFlow bids={bids} houses={[]} auctions={[]} configuredSources={['ebay-motors','gooding']} now={now} error={error} updatedAt={now} onInspect={()=>{}}/>));
 try {
  await render([bid()]); expect(host.querySelector('.auction-flow__source--arrival')).toBeNull();
  await render([bid(),bid({id:'snapshot',house:'ebay-motors',eventKind:'bid_snapshot'}),bid({id:'quote',house:'ebay-motors',eventKind:'price_snapshot'}),bid({id:'recovery',recovered:true,bidAt:now-86400000})]);
  expect(host.textContent).toContain('1 bids · 0 snapshots · 1 recovered');
  expect(host.textContent).toContain('0 bids · 1 snapshots · 1 price quotes');
  expect(host.textContent).toContain('Price quote · bid/opening unknown');
  expect(host.textContent).toContain('No receipts in window · coverage unverified');
  expect(host.querySelectorAll('.auction-flow__source--arrival')).toHaveLength(1);
  expect(host.textContent).toContain('Recovered evidence');
  await render([bid()],true); expect(host.textContent).toContain('Receipt refresh unavailable');
  expect(host.querySelector('.auction-flow__source--arrival')).toBeNull();
 } finally {await act(async()=>root.unmount());}
});
it('keeps discovery failures and paused collectors visible without inventing inventory', async () => {
 vi.useFakeTimers(); vi.setSystemTime(now); (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'); const root=createRoot(host);
 try {
  await act(async()=>root.render(<AuctionFlow bids={[]} houses={[]} auctions={[]} configuredSources={[]} now={now} error={false} updatedAt={now} onInspect={()=>{}}
   sourceStatus={[
    {house:'govdeals',readAt:null,lots:null,state:null,hasError:false,discoveryState:'no_listings_parsed',discoveryAttemptAt:now-60000},
    {house:'cars-and-bids',readAt:null,lots:null,state:null,hasError:false,collectionState:'paused',discoveryState:'unverified'},
    {house:'autohunter',readAt:null,lots:null,state:null,hasError:false,discoveryState:'disabled'},
   ]}/>));
  expect(host.querySelectorAll('.auction-flow__source')).toHaveLength(4);
  expect(host.textContent).toContain('Discovery failed to parse listings');
  expect(host.textContent).toContain('Native auction collector paused');
  expect(host.textContent).toContain('Discovery feeds disabled');
  expect(host.textContent).toContain('Discovery enabled · landing unverified');
  expect(host.textContent).toContain('Inventory check not recorded');
  expect(host.textContent).not.toContain('Reader found 0 lots');
  expect(host.querySelector('.auction-flow__source--arrival')).toBeNull();
 } finally { await act(async()=>root.unmount()); }
});

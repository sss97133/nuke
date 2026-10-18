// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ signalRead: vi.fn(), valuationRead: vi.fn(), signals: [] as AbortSignal[], fromCalls: [] as any[], fromError: null as any }));
vi.mock('../../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const q: any = { then: (fn: any) => Promise.resolve({ data: table === 'external_identities' ? [{id:'canonical',platform:'bat',handle:'Seller'}] : [{id:'lot',vehicle_id:'other',source_url:'https://example.com/sale',outcome:'sold',vehicle:{make:'Porsche',model:'911'}}], error:fixture.fromError }).then(fn) };
    for (const method of ['select','eq','neq','is','ilike','lt','or','order','limit']) q[method] = (...args: any[]) => { fixture.fromCalls.push([table,method,...args]); return q; };
    return q;
  },
  rpc: (_name: string, args: { vehicle_ids: string[] }) => ({
    abortSignal: (signal: AbortSignal) => {
      fixture.signals.push(signal); return fixture.signalRead(args.vehicle_ids[0], signal);
    },
  }),
} }));
vi.mock('../../../services/vehicleValuationService', () => ({
  VehicleValuationService: { getValuation: (...args: any[]) => fixture.valuationRead(...args) },
}));
import { summarizeSellerLots, usePopoverData } from './useVehicleHeaderData';

let host: HTMLDivElement, root: Root, output: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.signals = []; fixture.fromCalls = []; fixture.fromError = null; fixture.signalRead.mockReset(); fixture.valuationRead.mockReset();
  fixture.signalRead.mockImplementation(async (id: string) => ({ data: [{ vehicle_id: id, primary_value: 10 }], error: null }));
  fixture.valuationRead.mockResolvedValue({ estimatedValue: 20 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('deduplicates seller lots, keeps unresolved outcomes outside sell-through, and scopes experience to exact current labels', () => {
  const rows = [
    {id:'a',vehicle_id:'one',source_url:'https://example.com/one/',outcome:'sold',vehicle:{make:'Porsche',model:'911 Turbo'}},
    {id:'b',vehicle_id:'one',source_url:'https://example.com/one/#comment-5',outcome:'sold',vehicle:{make:'Porsche',model:'911 Turbo'}},
    {id:'c',vehicle_id:'one',source_url:'https://example.com/two',outcome:'reserve_not_met',vehicle:{make:'Porsche',model:'911 Turbo'}},
    {id:'d',vehicle_id:'other',source_url:'https://example.com/three',outcome:'bid_to',vehicle:{make:'Porsche',model:'911 Carrera'}},
  ];
  expect(summarizeSellerLots(rows,'Porsche','911 Turbo')).toMatchObject({n:3,sold:1,resolved:2,unresolved:1,sameModel:2,repeatLots:1});
  expect(summarizeSellerLots([],null,null)).toMatchObject({n:0,resolved:0,sameModel:null});
});

const sellerVehicle = {id:'subject',make:'Porsche',model:'911'} as any;
const sellerPulse = {platform:'bat',seller_username:'Seller',listing_url:'https://example.com/current'} as any;
function SellerSubject() { output = usePopoverData('seller',sellerVehicle,sellerPulse); return null; }
it('reads seller history through one platform identity and keyed public auction parents, excluding this vehicle', async () => {
  await act(async () => root.render(<SellerSubject />));
  expect(output.popoverData.sellerEvidence.sold).toBe(1);
  expect(fixture.fromCalls).toContainEqual(['external_identities','eq','platform','bat']);
  expect(fixture.fromCalls).toContainEqual(['auction_events','eq','seller_external_identity_id','canonical']);
  expect(fixture.fromCalls).toContainEqual(['auction_events','neq','vehicle_id','subject']);
  expect(fixture.fromCalls).toContainEqual(['auction_events','eq','vehicle.is_public',true]);
  expect(fixture.fromCalls).toContainEqual(['auction_events','limit',51]);
  expect(fixture.fromCalls.filter(c => c[1] === 'select').some(c => /seller_username|proof_url|claimed_by,/.test(c[2]))).toBe(false);
});
it('keeps an unreadable seller history distinct from a seller with no sales', async () => {
  fixture.fromError = {message:'read failed'};
  await act(async () => root.render(<SellerSubject />));
  expect(output.popoverData.unavailable).toBe(true);
  expect(output.popoverData.sellerEvidence).toBeUndefined();
});

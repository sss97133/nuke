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
import { usePriceData, summarizeSellerLots, usePopoverData } from './useVehicleHeaderData';

function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
}
let host: HTMLDivElement, root: Root, output: any, renders: any[];
function Subject({ id, initialSignal = null, initialValuation = null }: any) {
  output = usePriceData(id, initialSignal, initialValuation);
  renders.push({ id, ...output });
  return <pre>{JSON.stringify(output)}</pre>;
}
async function render(id: string | undefined, extra = {}) {
  await act(async () => root.render(<Subject id={id} {...extra} />));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.signals = []; fixture.fromCalls = []; fixture.fromError = null; fixture.signalRead.mockReset(); fixture.valuationRead.mockReset(); renders = [];
  fixture.signalRead.mockImplementation(async (id: string) => ({ data: [{ vehicle_id: id, primary_value: 10 }], error: null }));
  fixture.valuationRead.mockResolvedValue({ estimatedValue: 20 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('exposes failure independently from the successfully read price signal', async () => {
  fixture.valuationRead.mockRejectedValue(new Error('private database detail'));
  await render('offline-a');
  expect(output).toEqual({ rpcSignal: { vehicle_id: 'offline-a', primary_value: 10 }, valuation: null, valuationUnavailable: true });
  expect(host.textContent).not.toContain('private');
});

it('hides the previous vehicle before effects settle and ignores both late old responses', async () => {
  const signalA = deferred(), valueA = deferred(), signalB = deferred(), valueB = deferred();
  fixture.signalRead.mockImplementation((id: string) => id === 'offline-a' ? signalA.promise : signalB.promise);
  fixture.valuationRead.mockImplementation((id: string) => id === 'offline-a' ? valueA.promise : valueB.promise);
  await render('offline-a');
  await act(async () => { signalA.resolve({ data: [{ vehicle_id: 'offline-a', primary_value: 11 }], error: null }); });
  await render('offline-b');
  expect(renders.filter(x => x.id === 'offline-b').every(x => x.rpcSignal === null && x.valuation === null)).toBe(true);
  expect(fixture.signals[0].aborted).toBe(true);
  expect(fixture.valuationRead.mock.calls[0][1].aborted).toBe(true);
  await act(async () => {
    valueB.resolve({ estimatedValue: 22 });
    signalB.resolve({ data: [{ vehicle_id: 'offline-b', primary_value: 12 }], error: null });
  });
  await act(async () => { valueA.resolve({ estimatedValue: 99 }); });
  expect(output.valuation.estimatedValue).toBe(22);
  expect(output.rpcSignal.vehicle_id).toBe('offline-b');
});

it('does not let a late failed old valuation mark the next vehicle unavailable', async () => {
  const old = deferred();
  fixture.valuationRead.mockImplementation((id: string) => id === 'offline-a' ? old.promise : Promise.resolve({ estimatedValue: 22 }));
  await render('offline-a'); await render('offline-b');
  await act(async () => old.resolve(Promise.reject(new Error('old failure'))));
  expect(output.valuation.estimatedValue).toBe(22); expect(output.valuationUnavailable).toBe(false);
});

it('rejects a response belonging to a different vehicle', async () => {
  fixture.signalRead.mockResolvedValue({ data: [{ vehicle_id: 'offline-other', primary_value: 999 }], error: null });
  await render('offline-a'); expect(output.rpcSignal).toBeNull();
});

it('clears both values without querying when the parent is absent', async () => {
  await render('offline-a'); await render(undefined);
  expect(output).toEqual({ rpcSignal: null, valuation: null, valuationUnavailable: false });
  expect(fixture.signalRead).toHaveBeenCalledTimes(1); expect(fixture.valuationRead).toHaveBeenCalledTimes(1);
});

it('keeps a failed price signal separate from a stored assessment', async () => {
  fixture.signalRead.mockRejectedValue(new Error('private source detail'));
  await render('offline-a');
  expect(output.rpcSignal).toBeNull(); expect(output.valuation).toEqual({ estimatedValue: 20 });
  expect(output.valuationUnavailable).toBe(false);
});

it('settles unavailable after the deadline even when a dependency ignores abort', async () => {
  vi.useFakeTimers(); const late = deferred();
  fixture.valuationRead.mockReturnValue(late.promise);
  await render('offline-a');
  await act(async () => vi.advanceTimersByTime(10000));
  expect(output.valuation).toBeNull(); expect(output.valuationUnavailable).toBe(true);
  expect(fixture.valuationRead.mock.calls[0][1].aborted).toBe(true);
  await act(async () => late.resolve({ estimatedValue: 99 }));
  expect(output.valuation).toBeNull(); expect(output.valuationUnavailable).toBe(true);
});

it('retains caller-supplied initial data without starting requests', async () => {
  await render('offline-a', { initialSignal: { vehicle_id: 'offline-a', primary_value: 13 }, initialValuation: { estimatedValue: 23 } });
  expect(output.rpcSignal.primary_value).toBe(13); expect(output.valuation.estimatedValue).toBe(23);
  expect(fixture.signalRead).not.toHaveBeenCalled(); expect(fixture.valuationRead).not.toHaveBeenCalled();
});

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

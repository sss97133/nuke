// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Offline contracts only; no synthetic testimony is written to production.
const fixture = vi.hoisted(() => ({ read: vi.fn(), calls: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from(table: string) {
  const call = { table, filters: [] as any[], order: [] as any[], limit: 0, signal: undefined as AbortSignal | undefined };
  const query: any = {
    select: () => query,
    eq: (field: string, value: unknown) => { call.filters.push([field, value]); return query; },
    gt: (field: string, value: unknown) => { call.filters.push([field, 'gt', value]); return query; },
    order: (field: string, options: unknown) => { call.order.push([field, options]); return query; },
    limit: (limit: number) => { call.limit = limit; return query; },
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
    then: (resolve: any, reject: any) => { fixture.calls.push(call); return Promise.resolve(fixture.read(call)).then(resolve, reject); },
  };
  return query;
} } }));
import { BidsPopup } from './BidsPopup';

const VEHICLE = 'synthetic-public-vehicle';
const SOURCE = 'https://bringatrailer.com/listing/synthetic-offline-lot/#comment-101';
function bid(extra = {}) {
  return { comment_id: 'synthetic-bid-1', vehicle_id: VEHICLE, comment_type: 'bid', bid_amount: 4000,
    observed_at: '2025-01-01T10:00:00Z', author_username: 'SyntheticBidder', platform: 'bat', comment_url: SOURCE, ...extra };
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls = []; fixture.read.mockReset();
  fixture.read.mockImplementation((call: any) => ({ data: call.table === 'vehicles' ? [{ id: VEHICLE }] : [bid()], error: null }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function mount(props = {}) { await act(async () => root.render(<BidsPopup vehicleId={VEHICLE} {...props} />)); }

it('requests explicit bid roles in a dated window and separates shown reports from supplied totals', async () => {
  await mount({ bidCount: 125, highBid: 99999 });
  const read = fixture.calls.find(call => call.table === 'vehicle_comments_unified');
  expect(read.filters).toContainEqual(['comment_type', 'bid']);
  expect(read.order[0]).toEqual(['observed_at', { ascending: false, nullsFirst: false }]);
  expect(read.limit).toBe(100);
  expect(container.textContent).toContain('REPORTS SHOWN1');
  expect(container.textContent).toContain('summary: 125');
  expect(container.textContent).toContain('not the full bid count');
  expect(container.textContent).toContain('Currency is unrecorded');
  expect(container.textContent).not.toContain('$4,000');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(SOURCE);
  expect(container.textContent).toContain('SyntheticBidder · bat');
});

it('withholds denied parents, including supplied counts, numbers and source links, before any child read', async () => {
  fixture.read.mockResolvedValue({ data: [], error: null });
  await mount({ bidCount: 777, highBid: 98765, listingUrl: SOURCE });
  expect(fixture.calls.map(call => call.table)).toEqual(['vehicles']);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('unavailable');
  expect(container.textContent).not.toContain('777');
  expect(container.textContent).not.toContain('98,765');
  expect(container.querySelector('a')).toBeNull();
});

it.each([
  { comment_type: 'sold' }, { comment_type: 'observation' }, { vehicle_id: 'synthetic-other-vehicle' }, { bid_amount: 'NaN' },
])('refuses an invalid or non-bid report rather than turning its amount into a bid: %j', async extra => {
  fixture.read.mockImplementation(call => ({ data: call.table === 'vehicles' ? [{ id: VEHICLE }] : [bid(extra)], error: null }));
  await mount();
  expect(container.textContent).toContain('REPORTS SHOWNunavailable');
  expect(container.textContent).not.toContain('4,000');
  expect(container.querySelector('a')).toBeNull();
});

it('keeps absent source/time/author metadata explicit without borrowing the current listing', async () => {
  fixture.read.mockImplementation(call => ({ data: call.table === 'vehicles' ? [{ id: VEHICLE }] : [bid({ comment_url: null, observed_at: null, author_username: null })], error: null }));
  await mount({ listingUrl: 'https://bringatrailer.com/listing/synthetic-different-episode/' });
  expect(container.textContent).toContain('time unrecorded');
  expect(container.textContent).toContain('author unrecorded · bat');
  expect(container.textContent).toContain('Source link unrecorded');
  expect(container.querySelector('a')).toBeNull();
});

it('withholds previous-vehicle reports during a new read and sanitizes its failure', async () => {
  await mount();
  let rejectParent: (value: unknown) => void = () => {};
  fixture.read.mockImplementation(() => new Promise(resolve => { rejectParent = resolve; }));
  await mount({ vehicleId: 'synthetic-next-vehicle' });
  expect(container.textContent).not.toContain('4,000');
  expect(container.querySelector('a')).toBeNull();
  await act(async () => rejectParent({ data: null, error: { message: 'synthetic sensitive internal SQL' } }));
  expect(container.textContent).toContain('REPORTS SHOWNunavailable');
  expect(container.textContent).not.toContain('sensitive');
  expect(container.textContent).not.toContain('REPORTS SHOWN0');
});

it('does not turn a completed empty window into a claim that extraction never happened', async () => {
  fixture.read.mockImplementation(call => ({ data: call.table === 'vehicles' ? [{ id: VEHICLE }] : [], error: null }));
  await mount({ bidCount: 75 });
  expect(container.textContent).toContain('REPORTS SHOWN0');
  expect(container.textContent).toContain('summary: 75');
  expect(container.textContent).toContain('No positive bid reports in this read');
  expect(container.textContent).not.toContain('No granular bid data extracted');
});

it('ends a stalled parent read as unavailable without querying children', async () => {
  vi.useFakeTimers();
  fixture.read.mockImplementation(call => new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true })));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fixture.calls.map(call => call.table)).toEqual(['vehicles']);
  expect(container.textContent).toContain('REPORTS SHOWNunavailable');
  expect(container.textContent).not.toContain('REPORTS SHOWN0');
});

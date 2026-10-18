// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  videos: [] as unknown[], vehicle: null as unknown, metadataError: null as unknown,
  queries: [] as { table: string; columns: string; filters: unknown[][] }[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => {
  const query = { table, columns: '', filters: [] as unknown[][] };
  fixture.queries.push(query);
  const builder = {
    select: (columns: string) => { query.columns = columns; return builder; },
    eq: (...args: unknown[]) => { query.filters.push(['eq', ...args]); return builder; },
    is: (...args: unknown[]) => { query.filters.push(['is', ...args]); return builder; },
    or: (...args: unknown[]) => { query.filters.push(['or', ...args]); return builder; },
    not: (...args: unknown[]) => { query.filters.push(['not', ...args]); return builder; },
    order: () => Promise.resolve({ data: fixture.videos, error: null }),
    maybeSingle: () => Promise.resolve({ data: fixture.vehicle, error: fixture.metadataError }),
  };
  return builder;
}) } }));
import { PriceBreakdownPopup } from './VideoMomentPopups';
import { VehicleVideoSection } from './VehicleVideoSection';

const subject = '00000000-0000-4000-8000-000000000001';
const sourceUrl = 'https://example.com/lots/recorded-episode/';
const video = {
  id: '00000000-0000-4000-8000-000000000002', vehicle_id: subject,
  source: 'recorded-house', source_url: sourceUrl, lot_number: 'LOT-1', auction_name: null,
  auction_start_date: '2025-06-01', winning_bid: 100000, outcome: 'sold',
  estimate_low: 90000, estimate_high: 110000,
  broadcast_video_url: 'https://www.youtube.com/watch?v=abcdefghijk',
  broadcast_timestamp_start: 65, broadcast_timestamp_end: 105,
};

let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.videos = [video];
  fixture.vehicle = { id: subject, year: 1967, make: 'Chevrolet', model: 'Corvette' };
  fixture.metadataError = null;
  fixture.queries = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

async function render(element: React.ReactNode) {
  await act(async () => root.render(
    <MemoryRouter><QueryClientProvider client={client}>{element}</QueryClientProvider></MemoryRouter>,
  ));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

it.each(['mecum', 'barrett_jackson', 'unrecorded-house', undefined])(
  'withholds fees and proceeds without lot-specific terms for %s', async source => {
    await render(<PriceBreakdownPopup recordedAmount={100000} source={source} onClose={() => {}} />);
    const text = document.body.textContent;
    expect(text).toContain('Recorded auction amount100,000');
    expect(text).toContain('Currency and fee basisUnknown');
    expect(text).toContain('Fees and proceedsUnrecorded');
    expect(text).not.toContain('Buyer Total');
    expect(text).not.toContain('Seller Net');
    expect(text).not.toContain('House Take');
    expect(text).not.toContain('$110,000');
    expect(text).not.toContain('$89,650');
    expect(text).not.toContain('Hammer Price');
    expect(text).not.toContain('$');
  },
);

it('preserves raw source estimates without assuming compatible units or calculating a comparison', async () => {
  await render(<PriceBreakdownPopup recordedAmount={100000} estimateLow={90000} estimateHigh={110000} onClose={() => {}} />);
  expect(document.body.textContent).toContain('Recorded estimate range90,000 – 110,000');
  expect(document.body.textContent).not.toContain('vs Estimate');
  expect(document.body.textContent).not.toContain('Within range');
  expect(document.body.textContent).toContain('Fees and proceedsUnrecorded');
});

it('carries the actual video query through clip, attributed amount and qualified-context navigation', async () => {
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).toContain('100,000');
  expect(container.textContent).not.toContain('$');
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  expect(document.querySelector('iframe')?.src).toContain('abcdefghijk?start=65');
  expect(document.body.textContent).toContain('1:05 (40s)');
  expect(document.body.textContent).toContain('RECORDED-HOUSE');
  await click(document.querySelector('button[title="Inspect recorded auction amount"]'));
  expect(document.body.textContent).toContain('Recorded auction amount100,000');
  expect(document.body.textContent).toContain('Currency and fee basisUnknown');
  expect(document.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(sourceUrl);
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/valuation?"]')!;
  const params = new URL(link.href).searchParams;
  expect(Object.fromEntries(params)).toEqual({ year: '1967', make: 'Chevrolet', model: 'Corvette', vehicle_id: subject });
  expect(params.has('price')).toBe(false);
  expect(params.has('currency')).toBe(false);
  expect(document.body.textContent).not.toContain('COMPARABLE SALES');
  const auctionReads = fixture.queries.filter(query => query.table === 'auction_events');
  expect(auctionReads).toHaveLength(1); // The video read, with no second raw comparable-sale reader.
  expect(auctionReads[0].columns).toContain('source_url');
  expect(auctionReads[0].filters).toContainEqual(['eq', 'vehicle_id', subject]);
  const metadataRead = fixture.queries.find(query => query.table === 'vehicles')!;
  expect(metadataRead.filters).toContainEqual(['eq', 'is_public', true]);
  expect(metadataRead.filters).toContainEqual(['is', 'deleted_at', null]);
  expect(metadataRead.filters).toContainEqual(['or', 'listing_kind.is.null,listing_kind.neq.non_vehicle_item']);
});

it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'retains the clip but refuses a price claim for invalid recorded amount %s', async amount => {
    fixture.videos = [{ ...video, winning_bid: amount }];
    await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
    await click(container.querySelector('img[alt="Video thumbnail"]'));
    expect(document.querySelector('iframe')).not.toBeNull();
    expect(document.querySelector('button[title="Inspect recorded auction amount"]')).toBeNull();
    expect(document.body.textContent).not.toContain('AUCTION AMOUNT');
  },
);

it('does not promote an unsold lot with a recorded number into a sale amount', async () => {
  fixture.videos = [{ ...video, outcome: 'reserve_not_met' }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).not.toContain('100,000');
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  expect(document.querySelector('iframe')).not.toBeNull();
  expect(document.querySelector('button[title="Inspect recorded auction amount"]')).toBeNull();
});

it('refuses a returned clip bound to a different vehicle', async () => {
  fixture.videos = [{ ...video, vehicle_id: 'another-vehicle' }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).not.toContain('VIDEO MOMENTS');
  expect(container.querySelector('img')).toBeNull();
});

it.each(['denied', 'error', 'wrong-subject', 'missing-model'])(
  'keeps the recorded amount while withholding sale-context navigation for %s metadata', async state => {
    if (state === 'denied') fixture.vehicle = null;
    if (state === 'error') fixture.metadataError = new Error('metadata unavailable');
    if (state === 'wrong-subject') fixture.vehicle = { id: 'another-vehicle', year: 1967, make: 'Chevrolet', model: 'Corvette' };
    if (state === 'missing-model') fixture.vehicle = { id: subject, year: 1967, make: 'Chevrolet', model: '' };
    await render(<PriceBreakdownPopup recordedAmount={100000} source="recorded-house" vehicleId={subject} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Recorded auction amount100,000');
    expect(document.querySelector('a[href^="/valuation?"]')).toBeNull();
  },
);

it('withholds an unsafe source locator without discarding the attributed amount', async () => {
  await render(<PriceBreakdownPopup recordedAmount={100000} source="recorded-house" lotNumber="LOT-1"
    sourceUrl="javascript:alert(1)" onClose={() => {}} />);
  expect(document.body.textContent).toContain('RECORDED-HOUSE · Lot LOT-1');
  expect(document.querySelector('a[target="_blank"]')).toBeNull();
  expect(document.body.textContent).toContain('Recorded auction amount100,000');
});

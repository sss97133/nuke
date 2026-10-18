// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { ProfileRead } from './profileDocument';
const fixture = vi.hoisted(() => ({ vehicle: {} as Record<string, unknown>, pulse: null as Record<string, unknown> | null, read: null as ProfileRead | null,
  auctionRows: [] as any[], eventRows: [] as any[], request: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let vehicleId: string;
  const query: any = { select: () => query, eq: (_key: string, id: string) => { vehicleId = id; return query; },
    order: () => query, limit: () => fixture.request(table, vehicleId) };
  return query;
} } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, auctionPulse: fixture.pulse }) }));
vi.mock('./profileDocument', async (original) => {
  const real = await original<typeof import('./profileDocument')>();
  // The real document mapping over the fixture read, without a QueryClient: the fetch is the only thing mocked.
  return { ...real, useProfileDocument: (vehicleId: string | undefined, priceOwnedByLiveStack: boolean) =>
    vehicleId && fixture.read ? real.profileDocumentFrom(fixture.read, priceOwnedByLiveStack) : null };
});
vi.mock('../stacks/VehicleCohort', () => ({ VehiclePerformance: ({ facet }: any) => <div>performance stack for {facet.label}</div> }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
import ProfileHeader, { comparableLotKey, extractInlineLotProvenance } from './ProfileHeader';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// What vehicle_profile_read returns for the fixture: five legacy facets and an odometer with the record's source.
const legacy = (value: string) => ({ value, source: { kind: 'legacy' as const, label: 'vehicle record' }, observed_at: null, trust: 0.3 });
function mustangRead(): ProfileRead {
  return {
    vehicle_id: 'v-1', viewer: 'anon', read_at: '2026-10-13T14:00:00+00:00',
    sections: [
      { kind: 'masthead', identity_source: { year: 1966, make: 'Ford', model: 'Mustang', normalized_model: 'Mustang' }, year: 1966, make: 'Ford', model: 'Mustang',
        price: { value: 24000, unit: 'USD', source: { kind: 'listing', url: 'https://bringatrailer.com/listing/x', label: 'BRING A TRAILER', method: 'sold' }, observed_at: '2026-09-21T00:00:00+00:00', trust: 0.9 },
        priceLabel: 'Last recorded sale' },
      { kind: 'strip', coverage: { n: 1, of: 6, grain: 'facts attributed', as_of: null },
        facets: [
          { dimension: 'body_style', label: 'Coupe', member: legacy('Coupe') },
          { dimension: 'engine', label: '4.7L V8', member: legacy('4.7L V8') },
          { dimension: 'transmission', label: 'Automatic', member: legacy('Automatic') },
          { dimension: 'drivetrain', label: 'RWD', member: legacy('RWD') },
          { dimension: 'location', label: 'Boulder City, NV', member: legacy('Boulder City, NV') },
        ],
        odometer: { value: 10000, unit: 'mi', source: { kind: 'listing', label: 'bring a trailer' }, observed_at: null, trust: 0.6 } },
    ],
  };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  host.className = 'vehicle-profile-page';
  document.body.appendChild(host);
  root = createRoot(host);
  fixture.vehicle = { id: 'v-1', year: 1966, make: 'Ford', model: 'Mustang', listing_kind: 'vehicle' };
  fixture.pulse = null;
  fixture.read = mustangRead();
  fixture.auctionRows = []; fixture.eventRows = [];
  fixture.request.mockReset().mockImplementation((table: string) => Promise.resolve({ data: table === 'auction_events' ? fixture.auctionRows : fixture.eventRows, error: null }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<ProfileHeader priceLotId="lot-1" />));
const renderLoaded = render;
const openPrice = () => act(() => (host.querySelector('.k-masthead__result button.k-claim__value') as HTMLButtonElement).click());
function priceSource(vehicleId: string, url: string | null) {
  fixture.vehicle = { id: vehicleId, year: 1966, make: 'Ford', model: 'Mustang', listing_kind: 'vehicle' };
  const read = mustangRead(); read.vehicle_id = vehicleId;
  const masthead = read.sections[0];
  if (masthead.kind === 'masthead' && masthead.price) { masthead.price.source.url = url; masthead.price.observed_at = null; }
  fixture.read = read;
}
const auction = (source_url = 'https://bringatrailer.com/listing/x', extra = {}) => ({ vehicle_id: 'v-1', source_url,
  lot_number: 'EXACT-LOT', auction_end_date: '2025-02-03T04:05:06Z', broadcast_video_url: 'https://www.youtube.com/watch?v=exact_video',
  broadcast_timestamp_start: 125, broadcast_timestamp_end: 180, ...extra });

it('retains exact lot enrichment without changing the price owner or its source observation clock', async () => {
  fixture.auctionRows = [auction()];
  await renderLoaded(); openPrice();
  expect(document.body.textContent).toContain('Lot EXACT-LOT');
  expect(document.body.textContent).toContain('Sep 21, 2026');
  expect(document.body.querySelector('a.k-claim__link')?.getAttribute('href')).toBe('https://bringatrailer.com/listing/x');
  expect(host.querySelector('.k-masthead__result button.k-claim__value')?.textContent).toBe('$24,000');
});

it.each(['vehicle', 'lot'])('withholds prior lot provenance while a changed %s read is pending or fails', async transition => {
  fixture.auctionRows = [auction()]; await renderLoaded();
  priceSource(transition === 'vehicle' ? 'v-2' : 'v-1', 'https://bringatrailer.com/listing/new-lot');
  let resolve!: (value: any) => void;
  const pending = new Promise(done => { resolve = done; }); fixture.request.mockReturnValue(pending);
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).not.toContain('Feb 3, 2025');
  expect(document.body.textContent).toContain('unknown date');
  await act(async () => resolve({ data: null, error: { message: 'PRIVATE ENRICHMENT ERROR' } }));
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).not.toContain('PRIVATE ENRICHMENT ERROR');
});

it('does not link an unaddressed row or arbitrary first event to an unrecorded headline source', async () => {
  priceSource('v-1', null); fixture.auctionRows = [auction('https://bringatrailer.com/listing/other')];
  await renderLoaded(); openPrice();
  expect(document.body.querySelector('a.k-claim__link')).toBeNull();
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).toContain('unknown date');
});

it('does not use source-less rows as a fallback for a different recorded lot', async () => {
  priceSource('v-1', 'https://bringatrailer.com/listing/x');
  fixture.auctionRows = [auction(undefined, { source_url: null, lot_number: 'UNADDRESSED-LOT' })];
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('UNADDRESSED-LOT');
  expect(document.body.textContent).toContain('unknown date');
});

it('does not borrow vehicle, pulse or inline provenance from another headline episode', async () => {
  priceSource('v-1', 'https://bringatrailer.com/listing/x');
  fixture.vehicle = { ...fixture.vehicle, listing_url: 'https://mecum.com/lots/123', lot_number: 'VEHICLE-OTHER-LOT', sale_date: '2024-01-01',
    provenance_metadata: { mec_lot_number: 'INLINE-OTHER-LOT', mec_auction_name: 'Unrelated auction' } };
  fixture.pulse = { listing_url: 'https://mecum.com/lots/456', lot_number: 'PULSE-OTHER-LOT', listing_status: 'sold', event_type: 'auction', platform: 'mecum' };
  await renderLoaded(); openPrice();
  for (const unsupported of ['VEHICLE-OTHER-LOT', 'INLINE-OTHER-LOT', 'PULSE-OTHER-LOT', 'Unrelated auction', 'Jan 1, 2024']) expect(document.body.textContent).not.toContain(unsupported);
  expect(document.body.textContent).toContain('unknown date');
});

it('keeps a matching event ingest clock and opaque listing identity out of the price claim', async () => {
  priceSource('v-1', 'https://bringatrailer.com/listing/x');
  fixture.eventRows = [{ vehicle_id: 'v-1', source_url: 'https://bringatrailer.com/listing/x', source_listing_id: 'bat:listing:opaque-key',
    extracted_at: '2025-02-03T04:05:06Z', metadata: { auction_name: 'Exact event context' } }];
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('bat:listing:opaque-key');
  expect(document.body.textContent).not.toContain('Feb 3, 2025');
  expect(document.body.textContent).toContain('Exact event context');
  expect(document.body.textContent).toContain('unknown date');
});

it('does not use another vehicle URL when the price owner has no source URL', async () => {
  priceSource('v-1', null); fixture.vehicle.listing_url = 'https://bringatrailer.com/listing/other';
  fixture.auctionRows = [auction('https://bringatrailer.com/listing/other')];
  await renderLoaded(); openPrice();
  expect(document.body.querySelector('a.k-claim__link')).toBeNull();
  expect(document.body.textContent).not.toContain('EXACT-LOT'); expect(fixture.request).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('additional lot provenance unlinked');
});

it('keeps an errored response stale payload out and names the unavailable enrichment', async () => {
  fixture.request.mockResolvedValue({ data: [auction()], error: { message: 'PRIVATE PROVIDER ERROR' } });
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).toContain('Additional lot provenance unavailable.');
  expect(document.body.textContent).not.toContain('PRIVATE PROVIDER ERROR');
});

it('preserves an exact positive result when the other additive reader fails', async () => {
  fixture.request.mockImplementation((table: string) => table === 'auction_events'
    ? Promise.resolve({ data: [auction()], error: null }) : Promise.reject(new Error('PRIVATE REJECTED READ')));
  await renderLoaded(); openPrice();
  expect(document.body.textContent).toContain('Lot EXACT-LOT');
  expect(document.body.textContent).toContain('Additional lot provenance unavailable.');
  expect(document.body.textContent).not.toContain('PRIVATE REJECTED READ');
});

it('withdraws old enrichment on a new profile receipt and does not resurrect it from an empty read', async () => {
  fixture.auctionRows = [auction()]; await renderLoaded();
  fixture.read = { ...mustangRead(), read_at: '2026-10-13T14:01:00Z' };
  let resolve!: (value: any) => void;
  const pending = new Promise(done => { resolve = done; }); fixture.request.mockReturnValue(pending);
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).toContain('Additional lot provenance pending.');
  await act(async () => resolve({ data: [], error: null }));
  expect(document.body.textContent).not.toContain('EXACT-LOT');
  expect(document.body.textContent).toContain('No additional matching lot provenance in this read.');
});

it('ignores a late previous-subject response after exact new-subject provenance arrives', async () => {
  let resolveOld!: (value: any) => void;
  const old = new Promise(done => { resolveOld = done; }); fixture.request.mockReturnValue(old);
  await renderLoaded();
  priceSource('v-2', 'https://bringatrailer.com/listing/new-lot');
  fixture.request.mockResolvedValue({ data: [auction('https://bringatrailer.com/listing/new-lot', { vehicle_id: 'v-2', lot_number: 'CURRENT-LOT' })], error: null });
  await renderLoaded(); openPrice();
  expect(document.body.textContent).toContain('CURRENT-LOT');
  await act(async () => resolveOld({ data: [auction()], error: null }));
  expect(document.body.textContent).toContain('CURRENT-LOT'); expect(document.body.textContent).not.toContain('EXACT-LOT');
});

it.each(['https://unrelated.test/mecum.com/lots/123', 'https://mecum.com.evil.test/lots/123', 'https://unrelated.test/?next=https://mecum.com/lots/123'])(
  'does not mistake an untrusted URL fragment for the canonical Mecum source (%s)', async sourceUrl => {
    priceSource('v-1', 'https://mecum.com/lots/123/example'); fixture.auctionRows = [auction(sourceUrl, { lot_number: 'FOREIGN-LOT' })];
    await renderLoaded(); openPrice();
    expect(document.body.textContent).not.toContain('FOREIGN-LOT');
  });

it.each([null, '999', undefined])('does not bind inline metadata without the exact native Mecum web ID (%j)', async mec_web_id => {
  priceSource('v-1', 'https://mecum.com/lots/123/example');
  fixture.vehicle.provenance_metadata = { mec_web_id, mec_lot_number: 'UNBOUND-INLINE', mec_auction_name: 'Unbound auction' };
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('UNBOUND-INLINE'); expect(document.body.textContent).not.toContain('Unbound auction');
});

it('does not bind Mecum inline metadata to a false-host source with a matching native ID in its path', async () => {
  priceSource('v-1', 'https://unrelated.test/mecum.com/lots/123');
  fixture.vehicle.provenance_metadata = { mec_web_id: '123', mec_lot_number: 'UNBOUND-INLINE', mec_auction_name: 'Unbound auction' };
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('UNBOUND-INLINE'); expect(document.body.textContent).not.toContain('Unbound auction');
});

it('does not collapse distinct generic source pages whose native identity is in the query', async () => {
  priceSource('v-1', 'https://source.test/listing?id=current');
  fixture.auctionRows = [auction('https://source.test/listing?id=other', { lot_number: 'FOREIGN-QUERY-LOT' })];
  await renderLoaded(); openPrice();
  expect(document.body.textContent).not.toContain('FOREIGN-QUERY-LOT');
});

it('renders identity, the typed price and the strip with its coverage, with no inline style', async () => {
  await render();
  expect(host.querySelector('h1.k-entity')?.textContent).toContain('Mustang');
  const price = host.querySelector('.k-masthead__result button.k-claim__value') as HTMLButtonElement;
  expect(price.textContent).toBe('$24,000');
  expect(host.textContent).toContain('Last recorded sale');
  expect(host.textContent).toContain('10,000 mi');
  expect(host.querySelectorAll('button.k-facet').length).toBe(5);
  expect(host.textContent).toContain('1 of 6 facts attributed');
  expect(host.querySelector('[style]')).toBeNull();
  expect(host.style.getPropertyValue('--vp-h-masthead')).toMatch(/px$/);
});

it('opens the price source with its platform, clock and the stack link', async () => {
  await render();
  act(() => (host.querySelector('.k-masthead__result button.k-claim__value') as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('BRING A TRAILER');
  expect(document.body.textContent).toContain('Sep 21, 2026');
  expect(document.body.querySelector('a[href="/stacks/order-book/v-1?lot=lot-1"]')).not.toBeNull();
});

it('a facet opens its source and the performance stack', async () => {
  await render();
  act(() => (host.querySelectorAll('button.k-facet')[0] as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('performance stack for Coupe');
  expect(document.body.textContent).toContain('vehicle record');
});

it('leaves the price to the live banner when an auction is live', async () => {
  fixture.pulse = { platform: 'bat', listing_url: 'https://bringatrailer.com/listing/x', listing_status: 'active', event_type: 'auction' };
  await render();
  expect(host.querySelector('.k-masthead__result')).toBeNull();
  expect(host.querySelector('h1.k-entity')?.textContent).toContain('Mustang');
});

it('shows no odometer when the read carries none', async () => {
  const read = mustangRead();
  const strip = read.sections[1];
  if (strip.kind === 'strip') { strip.odometer = null; strip.coverage = { ...strip.coverage, n: 0, of: 5 }; }
  fixture.read = read;
  await render();
  expect(host.textContent).not.toContain(' mi');
  expect(host.textContent).toContain('0 of 5 facts attributed');
});

it('renders nothing until the read answers', async () => {
  fixture.read = null;
  await render();
  expect(host.querySelector('.vp-header-sticky')).toBeNull();
});

it('normalizes Mecum lot URLs and extracts inline lot provenance from description or provenance_metadata', () => {
  expect(comparableLotKey('https://www.mecum.com/lots/FL23-539536/1970-plymouth-road-runner/')).toBe('mecum:539536');
  expect(comparableLotKey('https://mecum.com/lots/539536/1970-plymouth-road-runner')).toBe('mecum:539536');
  expect(comparableLotKey('https://mecum.com/lots/371524/1971-plymouth-road-runner-rapid-transit')).toBe('mecum:371524');

  expect(extractInlineLotProvenance({
    description: '1970 Plymouth Road Runner Highlights: Matching Numbers 383 CI V-8. Offered at Mecum Kissimmee 2023 (Lot F142.1).',
  })).toEqual({
    lotNumber: 'F142.1',
    auctionName: 'Kissimmee 2023',
  });

  expect(extractInlineLotProvenance({
    provenance_metadata: { mec_lot_number: 'F130', mec_auction_name: 'Indy 2019', mec_web_id: '371524' },
  })).toEqual({
    lotNumber: 'F130',
    auctionName: 'Indy 2019',
  });
});

it('enriches price claim popover with source-bound inline Mecum lot provenance when event rows are absent', async () => {
  const read = mustangRead();
  const masthead = read.sections[0];
  if (masthead.kind === 'masthead' && masthead.price) {
    masthead.price = {
      ...masthead.price,
      value: 236500,
      source: { kind: 'listing', url: 'https://mecum.com/lots/371524/1971-plymouth-road-runner-rapid-transit', label: 'Mecum', method: 'sold' },
      observed_at: '2019-05-17T00:00:00+00:00',
    };
  }
  fixture.read = read;
  fixture.vehicle = {
    id: 'v-rr',
    year: 1971,
    make: 'Plymouth',
    model: 'Road Runner',
    listing_kind: 'vehicle',
    provenance_metadata: { mec_lot_number: 'F130', mec_auction_name: 'Indy 2019', mec_web_id: '371524' },
  };
  await render();
  act(() => (host.querySelector('.k-masthead__result button.k-claim__value') as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('Lot F130');
  expect(document.body.textContent).toContain('Indy 2019');
  expect(document.body.textContent).toContain('Watch sale moment');
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { ProfileRead } from './profileDocument';
const fixture = vi.hoisted(() => ({ vehicle: {} as Record<string, unknown>, pulse: null as Record<string, unknown> | null, read: null as ProfileRead | null }));
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
import ProfileHeader from './ProfileHeader';

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
  host = document.createElement('div');
  host.className = 'vehicle-profile-page';
  document.body.appendChild(host);
  root = createRoot(host);
  fixture.vehicle = { id: 'v-1', year: 1966, make: 'Ford', model: 'Mustang', listing_kind: 'vehicle' };
  fixture.pulse = null;
  fixture.read = mustangRead();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(<ProfileHeader priceLotId="lot-1" />));

it('renders identity, the typed price and the strip with its coverage, with no inline style', () => {
  render();
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

it('opens the price source with its platform, clock and the stack link', () => {
  render();
  act(() => (host.querySelector('.k-masthead__result button.k-claim__value') as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('BRING A TRAILER');
  expect(document.body.textContent).toContain('Sep 21, 2026');
  expect(document.body.querySelector('a[href="/stacks/order-book/v-1?lot=lot-1"]')).not.toBeNull();
});

it('a facet opens its source and the performance stack', () => {
  render();
  act(() => (host.querySelectorAll('button.k-facet')[0] as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('performance stack for Coupe');
  expect(document.body.textContent).toContain('vehicle record');
});

it('leaves the price to the live banner when an auction is live', () => {
  fixture.pulse = { platform: 'bat', listing_url: 'https://bringatrailer.com/listing/x', listing_status: 'active', event_type: 'auction' };
  render();
  expect(host.querySelector('.k-masthead__result')).toBeNull();
  expect(host.querySelector('h1.k-entity')?.textContent).toContain('Mustang');
});

it('shows no odometer when the read carries none', () => {
  const read = mustangRead();
  const strip = read.sections[1];
  if (strip.kind === 'strip') { strip.odometer = null; strip.coverage = { ...strip.coverage, n: 0, of: 5 }; }
  fixture.read = read;
  render();
  expect(host.textContent).not.toContain(' mi');
  expect(host.textContent).toContain('0 of 5 facts attributed');
});

it('renders nothing until the read answers', () => {
  fixture.read = null;
  render();
  expect(host.querySelector('.vp-header-sticky')).toBeNull();
});

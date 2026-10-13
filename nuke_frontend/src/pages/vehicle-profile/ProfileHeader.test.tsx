// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ vehicle: {} as any, price: null as any, pulse: null as any, evidence: [] as any[] }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, auctionPulse: fixture.pulse, isRowOwner: false, isVerifiedOwner: false, hasContributorAccess: false }) }));
vi.mock('./hooks/useVehiclePriceFacts', async (original) => ({ ...await original<any>(), useVehiclePriceFacts: () => ({ priceFacts: fixture.price, priceSettled: true, priceFailed: false }) }));
vi.mock('./profileDocument', async (original) => {
  const real = await original<any>();
  // The real builder over the fixture's evidence, without a QueryClient: the hook is the only thing mocked.
  return { ...real, useProfileDocument: (vehicle: any, priceFacts: any, priceOwnedByLiveStack: boolean, viewer: any) =>
    vehicle ? real.buildProfileDocument({ vehicle, priceFacts, evidence: fixture.evidence, viewer, priceOwnedByLiveStack }) : null };
});
vi.mock('../stacks/VehicleCohort', () => ({ VehiclePerformance: ({ facet }: any) => <div>performance stack for {facet.label}</div> }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
import ProfileHeader from './ProfileHeader';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'vehicle-profile-page';
  document.body.appendChild(host);
  root = createRoot(host);
  fixture.vehicle = {
    id: 'v-1', year: 1966, make: 'Ford', model: 'Mustang', normalized_model: 'Mustang', body_style: 'Coupe', engine_size: '4.7L V8',
    transmission: 'Automatic', drivetrain: 'RWD', city: 'Boulder City', state: 'NV', mileage: 10000, mileage_source: 'bring a trailer', listing_kind: 'vehicle',
  };
  fixture.price = { price_kind: 'sold', price_amount: 24000, price_as_of: '2026-09-21T00:00:00+00:00', platform: 'bring-a-trailer', source_url: 'https://bringatrailer.com/listing/x', outcome: 'sold' };
  fixture.pulse = null;
  fixture.evidence = [];
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

it('shows no odometer when the reading has no source', () => {
  fixture.vehicle = { ...fixture.vehicle, mileage: 1, mileage_source: null };
  render();
  expect(host.textContent).not.toContain(' mi');
  expect(host.textContent).toContain('0 of 5 facts attributed');
});

it('attributes a facet from accepted evidence', () => {
  fixture.evidence = [{ field_name: 'engine_size', proposed_value: '4.7L V8', source_type: 'ls3_documentation_corpus_pixel_verified', source_confidence: 95, extracted_at: '2026-06-23T22:24:03Z', status: 'accepted' }];
  render();
  expect(host.textContent).toContain('2 of 6 facts attributed');
  act(() => (host.querySelectorAll('button.k-facet')[1] as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('95%');
  expect(document.body.textContent).toContain('Jun 23, 2026');
});

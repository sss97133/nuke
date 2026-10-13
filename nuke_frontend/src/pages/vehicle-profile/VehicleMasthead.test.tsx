// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ vehicle: {} as any, price: null as any, pulse: null as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, auctionPulse: fixture.pulse }) }));
vi.mock('./hooks/useVehiclePriceFacts', async (original) => ({ ...await original<any>(), useVehiclePriceFacts: () => ({ priceFacts: fixture.price }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
import VehicleMasthead from './VehicleMasthead';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.vehicle = { id:'subject', year:1997, make:'Porsche', normalized_model:'911', model:'911 Turbo', series:'Turbo', transmission:'6-Speed Manual' };
  fixture.price = { price_kind:'sold', price_amount:378000, source_url:'https://example.com/sale', platform:'bat', price_as_of:'2026-08-20' };
  fixture.pulse = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<VehicleMasthead priceLotId="recorded-lot" />)); }

it('uses recorded model/series tokens and the shared brand catalogue with a complete accessible identity', async () => {
  await mount();
  expect(host.querySelector('.vehicle-identity__model')!.textContent).toBe('911');
  expect(host.querySelector('.vehicle-identity__variant image')!.getAttribute('href')).toContain('porsche-turbo-script-1995-1998.jpg');
  expect(host.querySelector('h1')!.getAttribute('aria-label')).toContain('Porsche');
  expect(host.querySelector('h1')!.getAttribute('aria-label')).toContain('manual');
  expect(host.querySelector('.vehicle-identity__maker image')!.getAttribute('href')).toContain('porsche-wordmark.svg');
  expect(host.querySelector('.vehicle-identity__art--emblem image')!.getAttribute('href')).toContain('porsche-crest-1994-2005.png');
  expect(host.querySelector('.vehicle-identity .sr-only')!.textContent).toBe('1997 Porsche 911 Turbo');
});
it('supports another make and a readable fallback without introducing a page-specific brand list', async () => {
  fixture.vehicle = { id:'ford', year:1966, make:'Ford', model:'Mustang' };
  await mount(); expect(host.querySelector('.vehicle-identity__maker')!.textContent).toContain('Ford');
  fixture.vehicle = { id:'unknown', year:2026, make:'Unknown marque', model:'Recorded model' };
  await mount(); expect(host.textContent).toContain('Unknown marque'); expect(host.querySelector('h1')!.textContent).toContain('Recorded model');
});
it('opens the source clock and linked auction without restating the price or inferring an import clock', async () => {
  fixture.price.price_kind = 'bid';
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Inspect recorded price sources"]')!.click());
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Aug 20, 2026');
  expect(dialog.textContent).not.toContain('378,000');
  expect(dialog.querySelector('a')!.href).toBe('https://example.com/sale');
  expect(dialog.querySelector('a[href*="order-book"]')!.getAttribute('href')).toBe('/stacks/order-book/subject?lot=recorded-lot');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('does not promote a model estimate to the recorded price', async () => {
  fixture.price.price_kind = 'estimate';
  await mount(); expect(host.querySelector('[aria-label="Inspect recorded price sources"]')).toBeNull();
});
it('keeps the typed classified ask visible despite a cached unqualified pulse, without inventing bid meaning or currency', async () => {
  fixture.price = { price_kind: 'ask', price_amount: 12500, platform: 'craigslist', source_url: 'https://fixture.craigslist.org/cto/d/fixture/700000000000.html', price_as_of: '2025-03-22' };
  fixture.pulse = { platform: 'craigslist', listing_url: fixture.price.source_url, listing_status: 'active', current_bid: 12500 };
  await mount(); expect(host.textContent).toContain('Asking');
  expect(host.querySelector('[aria-label="Inspect recorded price sources"]')?.textContent).toBe('12,500');
  expect(host.textContent).toContain('Currency unrecorded'); expect(host.textContent).not.toContain('$12,500');
  expect(host.textContent).not.toContain('Current bid');
});
it('keeps genuine live BaT bid ownership in the existing auction stack', async () => {
  fixture.pulse = { platform: 'bat', listing_url: 'https://bringatrailer.com/listing/fixture', listing_status: 'active', current_bid: 12500 };
  await mount(); expect(host.querySelector('[aria-label="Inspect recorded price sources"]')).toBeNull();
});

it('keeps downstream sticky content clear when the identity wraps or artwork loads', async () => {
  host.className = 'vehicle-profile-page';
  let height = 51;
  let resize: () => void = () => {};
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  await mount();
  expect(host.style.getPropertyValue('--vp-h-masthead')).toBe('51px');
  height = 86;
  resize();
  expect(host.style.getPropertyValue('--vp-h-masthead')).toBe('86px');
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalled();
  expect(host.style.getPropertyValue('--vp-h-masthead')).toBe('');
});

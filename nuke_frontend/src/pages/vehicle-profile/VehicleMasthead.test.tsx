// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ vehicle: {} as any, price: null as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle }) }));
vi.mock('./hooks/useVehiclePriceFacts', async (original) => ({ ...await original<any>(), useVehiclePriceFacts: () => ({ priceFacts: fixture.price }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
import VehicleMasthead from './VehicleMasthead';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.vehicle = { id:'subject', year:1997, make:'Porsche', normalized_model:'911', model:'911 Turbo', series:'Turbo', transmission:'6-Speed Manual' };
  fixture.price = { price_kind:'sold', price_amount:378000, source_url:'https://example.com/sale', platform:'bat', price_as_of:'2026-08-20' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(<VehicleMasthead priceLotId="recorded-lot" />)); }

it('uses recorded model/series tokens and the shared brand catalogue with a complete accessible identity', async () => {
  await mount();
  expect(host.querySelector('.vehicle-identity__model')!.textContent).toBe('911');
  expect(host.querySelector('.vp-masthead__variant')!.textContent).toBe('Turbo');
  expect(host.querySelector('h1')!.getAttribute('aria-label')).toContain('Porsche');
  expect(host.querySelector('h1')!.getAttribute('aria-label')).toContain('manual');
  expect(host.querySelector('.vehicle-identity__maker')!.textContent).toContain('Porsche');
  expect(host.querySelector('.vehicle-identity image')).toBeNull();
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

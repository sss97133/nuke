// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: {} as any, source: vi.fn(), more: vi.fn() }));
vi.mock('./useCapturedListings', async original => ({ ...await original<typeof import('./useCapturedListings')>(), useCapturedListings: (source: string) => { fixture.source(source); return fixture.query; } }));
vi.mock('./MarketPulse', () => ({ default: () => <section>Existing BaT bid board</section> }));
vi.mock('./PrivateCaptureHistory', () => ({ default: () => null }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import MarketInventory from './MarketInventory';
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  fixture.source.mockClear(); fixture.more.mockClear();
  fixture.query = { data: { pages: [{ items: [{ id: 'listing', vehicle_id: null, vehicle: null, source_platform: 'craigslist', source_listing_id: '7000000000', source_url: 'https://www.craigslist.org/view/d/fixture-listing/SyntheticShareToken0000', current_price: 0, event_status: 'active', created_at: '2026-10-13T02:31:04Z', updated_at: '2026-10-13T02:32:00Z' }] }] }, hasNextPage: true, fetchNextPage: fixture.more };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(query = 'collection=listings') { window.history.replaceState({}, '', '/?' + query); await act(async () => root.render(<BrowserRouter><MarketInventory /></BrowserRouter>)); }
it('opens the existing explorer at Market and keeps unresolved source presentations one explicit collection away', async () => {
  await render('tab=market');
  expect(container.textContent).toContain('Existing BaT bid board');
  expect(fixture.source).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Captured listings')!.click());
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('market');
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('listings');
  expect(container.textContent).toContain('Vehicle unresolved'); expect(container.textContent).toContain('7000000000');
  expect(container.textContent).toContain('0 · currency unrecorded'); expect(container.textContent).toContain('availability and source-wide coverage are unverified');
  expect(container.textContent).toContain('Source observation time unrecorded');
  expect(container.querySelector('a')?.getAttribute('href')).toContain('craigslist.org/view/d/');
  expect(container.querySelector('a[href^="/vehicle/"]')).toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Load more listings')!.click());
  expect(fixture.more).toHaveBeenCalledOnce();
});
it('keeps source filtering and Market navigation in the URL and retains existing auction deep links', async () => {
  await render('tab=market&source=craigslist'); expect(fixture.source).toHaveBeenLastCalledWith('craigslist');
  await act(async () => { const select = container.querySelector('select')!; select.value = 'ksl'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(new URLSearchParams(window.location.search).get('source')).toBe('ksl');
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('market');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'BaT auctions')!.click());
  expect(container.textContent).toContain('Existing BaT bid board');
});
it('shows the retained source observation separately from admission and update clocks', async () => {
  const row = fixture.query.data.pages[0].items[0];
  row.source_observed_at = '2026-10-12T01:02:03Z';
  await render();
  expect(container.textContent).toContain(`Source observation time ${new Date(row.source_observed_at).toLocaleString()}`);
  expect(container.textContent).toContain(`Retained ${new Date(row.created_at).toLocaleString()}`);
  expect(container.textContent).toContain(`Record updated ${new Date(row.updated_at).toLocaleString()}`);
  expect(container.textContent).not.toContain('Source observation time unrecorded');
});
it('opens the unchanged auction board for a legacy lot deep link', async () => {
  await render('tab=market&lot=retained-lot'); expect(container.textContent).toContain('Existing BaT bid board');
  expect(container.querySelector('section[aria-label="Captured listings"]')).toBeNull();
});
it.each(['make=FORD&board=1', 'live=1&sort=ending&bidRange=under10k', 'day=2026-10-01&salesScope=all&days=7&benchmark=all', 'inspect=sources&series=fixture'])('preserves existing auction lens links: %s', async query => {
  await render(query); expect(container.textContent).toContain('Existing BaT bid board');
});
it('honors an explicit listings selection while retaining the old auction lens context', async () => {
  await render('collection=listings&make=FORD&board=1');
  expect(container.querySelector('section[aria-label="Captured listings"]')).not.toBeNull();
  expect(new URLSearchParams(window.location.search).get('make')).toBe('FORD');
});
it('links eligible vehicles with their exact recorded identity and shared nameplate', async () => {
  const row = fixture.query.data.pages[0].items[0]; row.vehicle_id = 'eligible';
  row.vehicle = { id: 'eligible', year: 1963, make: 'Chevrolet', model: 'Corvette', primary_image_url: 'https://example.com/vehicle.jpg' };
  await render();
  const link = container.querySelector('a[href="/vehicle/eligible"]');
  expect(link?.getAttribute('aria-label')).toBe('1963 Chevrolet Corvette');
  expect(link?.querySelector('.sr-only')?.textContent).toBe('1963 Chevrolet Corvette');
  const visibleIdentity = link!.cloneNode(true) as HTMLElement;
  visibleIdentity.querySelectorAll('.sr-only').forEach(node => node.remove());
  expect(visibleIdentity.textContent?.match(/1963/g)).toHaveLength(1);
  const image = container.querySelector('img'); expect(image?.getAttribute('alt')).toBe('Vehicle record image');
  expect(image?.getAttribute('width')).toBe('80'); expect(image?.getAttribute('height')).toBe('60');
});

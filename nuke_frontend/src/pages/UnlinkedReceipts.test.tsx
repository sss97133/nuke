// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  getUser: vi.fn(), read: vi.fn(), vehicles: vi.fn(), queries: [] as { table: string; calls: unknown[][] }[],
  authChanged: (() => {}) as (event: string) => void, unsubscribe: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: fixture.getUser, onAuthStateChange: (callback: typeof fixture.authChanged) => { fixture.authChanged = callback; return { data: { subscription: { unsubscribe: fixture.unsubscribe } } }; } },
  from: (table: string) => {
    const query = { table, calls: [] as unknown[][] }; fixture.queries.push(query);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or', 'lt', 'in']) chain[method] = (...args: unknown[]) => { query.calls.push([method, ...args]); return chain; };
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(table === 'vehicles' ? fixture.vehicles(query) : fixture.read(query)).then(resolve, reject);
    return chain;
  },
} }));
vi.mock('../components/PrefetchLink', () => ({ default: ({ to, children, ...props }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={to} {...props}>{children}</a> }));
vi.mock('../components/common/MakeIdentity', () => ({ VehicleIdentity: ({ year, make, model }: { year: number; make: string; model: string }) => <span>{year} {make} {model}</span> }));
import UnlinkedReceipts from './UnlinkedReceipts';

const row = (i: number, values = {}) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, vehicle_id: null, title: `Synthetic receipt ${i}`, file_url: null, vendor_name: null, amount: null, currency: null, created_at: '2026-10-20T12:00:00+00:00', ...values });
let host: HTMLDivElement, root: Root;
const button = (label: string) => [...host.querySelectorAll('button')].find(element => element.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const render = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/receipts/unlinked']}><Routes><Route path="/receipts/unlinked" element={<UnlinkedReceipts />} /><Route path="/login" element={<Login />} /></Routes></MemoryRouter>)); };
function Login() { const location = useLocation(); return <h1>Sign in {location.search}</h1>; }
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.queries = []; fixture.getUser.mockReset(); fixture.read.mockReset(); fixture.vehicles.mockReset(); fixture.unsubscribe.mockReset();
  fixture.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  fixture.read.mockResolvedValue({ data: [row(1)], error: null }); fixture.vehicles.mockResolvedValue({ data: [], error: null });
  window.history.replaceState({}, '', '/receipts/unlinked');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('names the image-tag scope, preserves unknown amounts/currencies and links existing destinations', async () => {
  fixture.read.mockResolvedValue({ data: [row(1, { amount: 12, file_url: 'https://example.com/synthetic-receipt.pdf', vehicle_id: 'synthetic-vehicle' }), row(2), row(3, { amount: 0 }), row(4, { amount: -12.3456, currency: ' usd ' }), row(5, { amount: 12, currency: 'dollars' })], error: null });
  fixture.vehicles.mockResolvedValue({ data: [{ id: 'synthetic-vehicle', year: 2004, make: 'Ford', model: 'F-150' }], error: null });
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Receipts without image tags');
  expect(host.textContent).toContain('It does not establish whether a receipt is in your books');
  expect(host.textContent).toContain('12.00 (currency unknown)');
  expect(host.querySelector('a[href="/accounting"]')).not.toBeNull();
  expect(host.querySelector('a[href="/vehicle/synthetic-vehicle"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://example.com/synthetic-receipt.pdf"]')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(fixture.queries[0].calls).toContainEqual(['eq', 'uploaded_by', 'synthetic-owner']);
  expect(fixture.queries[0].calls).toContainEqual(['is', 'linked_to_tag_id', null]);
  expect(host.textContent).toContain('Amount unknown');
  expect(host.textContent).toContain('0.00 (currency unknown)');
  expect(host.textContent).toContain('USD');
  expect(host.textContent).toContain('12.3456');
  expect(host.textContent).toContain('12.00 (currency not recognized)');
  expect(host.textContent).toContain('End of this list.');
});

it('bounds each read and seeks past ties instead of offsetting when new uploads arrive', async () => {
  const first = Array.from({ length: 51 }, (_, i) => row(200 - i));
  fixture.read.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [row(150)], error: null }).mockResolvedValueOnce({ data: [row(999)], error: null });
  await render();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
  expect(host.textContent).toContain('More receipts are available.');
  expect(fixture.queries[0].calls).toContainEqual(['limit', 51]);
  expect(fixture.queries[0].calls).toContainEqual(['order', 'created_at', { ascending: false, nullsFirst: false }]);
  expect(fixture.queries[0].calls).toContainEqual(['order', 'id', { ascending: false }]);
  await click('Next page');
  expect(fixture.queries[1].calls).toContainEqual(['or', `created_at.lt.${first[49].created_at},and(created_at.eq.${first[49].created_at},id.lt.${first[49].id}),created_at.is.null`]);
  expect(host.textContent).toContain('Page 2 · 1 receipt shown');
  expect(host.textContent).not.toContain('Synthetic receipt 151');
  expect(button('Next page').disabled).toBe(true);
  await click('Refresh list');
  expect(host.textContent).toContain('Synthetic receipt 999');
  expect(host.textContent).toContain('Page 1');
  expect(fixture.queries[2].calls.some(call => call[0] === 'or' || call[0] === 'lt')).toBe(false);
});

it('pages through unknown upload dates and can return to an earlier page', async () => {
  const first = Array.from({ length: 51 }, (_, i) => row(200 - i, { created_at: null }));
  fixture.read.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: first, error: null });
  await render(); await click('Next page');
  expect(fixture.queries[1].calls).toContainEqual(['is', 'created_at', null]);
  expect(fixture.queries[1].calls).toContainEqual(['lt', 'id', first[49].id]);
  expect(host.textContent).toContain('No receipts remain on this page');
  await click('Previous page');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
  expect(host.textContent).toContain('Date unknown');
});

it('shows a failed read distinctly and retries the same page', async () => {
  fixture.read.mockRejectedValueOnce(new Error('Synthetic network failure')).mockResolvedValueOnce({ data: [], error: null });
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Receipts could not load');
  expect(host.textContent).not.toContain('No receipt uploads');
  await click('Retry page');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('No receipt uploads without image tags were found');
});

it('keeps source receipts visible when the vehicle lookup fails', async () => {
  fixture.read.mockResolvedValue({ data: [row(1, { vehicle_id: 'synthetic-vehicle' })], error: null });
  fixture.vehicles.mockResolvedValue({ data: null, error: { message: 'Synthetic failure' } });
  await render();
  expect(host.textContent).toContain('Synthetic receipt 1');
  expect(host.textContent).toContain('Vehicle details could not load');
  expect(host.textContent).toContain('Vehicle details unavailable');
  expect(host.querySelector('a[href="/vehicle/synthetic-vehicle"]')).not.toBeNull();
});

it('ignores an earlier account response after auth changes', async () => {
  let finish!: (value: unknown) => void;
  fixture.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: [row(2)], error: null });
  await render(); expect(host.textContent).toContain('Loading receipts');
  fixture.getUser.mockResolvedValue({ data: { user: { id: 'second-owner' } }, error: null });
  await act(async () => fixture.authChanged('SIGNED_IN'));
  await act(async () => finish({ data: [row(1)], error: null }));
  expect(host.textContent).toContain('Synthetic receipt 2');
  expect(host.textContent).not.toContain('Synthetic receipt 1');
  expect(fixture.queries[1].calls).toContainEqual(['eq', 'uploaded_by', 'second-owner']);
});

it('keeps the signed-out return path and never queries receipts without an account', async () => {
  fixture.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await render();
  expect(host.textContent).toContain('Sign in ?returnUrl=%2Freceipts%2Funlinked');
  expect(fixture.read).not.toHaveBeenCalled();
});

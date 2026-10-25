// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ read: vi.fn(), auth: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getUser: fixture.auth }, from: (table: string) => {
  if (table !== 'listing_exports') throw new Error(`Unexpected table ${table}`);
  const query = { select: () => query, eq: (...args: unknown[]) => { fixture.eq(...args); return query; }, order: fixture.read }; return query;
} } }));
vi.mock('../services/listingExportService', () => ({ ListingExportService: { updateExportStatus: fixture.update } }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));
import SellDashboard from './SellDashboard';

const listing = (status = 'prepared') => ({ id: 'synthetic-export', vehicle_id: 'synthetic-vehicle', user_id: 'synthetic-owner', platform: 'ebay', status, asking_price_cents: 125050, created_at: '2026-10-24T12:00:00Z', image_count: 2, metadata: {}, vehicle: { year: 2004, make: 'Synthetic', model: 'Truck', primary_image_url: null } });
const reply = (rows: unknown[] = [listing()]) => ({ data: rows, error: null });
let host: HTMLDivElement, root: Root;
const render = async () => { await act(async () => root.render(<SellDashboard />)); };
const text = () => host.textContent || '';
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.auth.mockReset().mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  fixture.read.mockReset().mockResolvedValue(reply()); fixture.eq.mockReset();
  fixture.update.mockReset().mockResolvedValue({ success: false, error: 'Synthetic refusal' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('reports a failed initial read without pretending there are no listings, then retries', async () => {
  fixture.read.mockResolvedValueOnce({ data: null, error: { message: 'Synthetic reader failure' } });
  await render(); expect(text()).toContain('Synthetic reader failure'); expect(text()).toContain('listing count is unknown');
  expect(text()).not.toContain('No listing exports yet'); expect(text()).not.toContain('REVENUE');
  await click('Refresh data'); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(text()).toContain('2004 Synthetic Truck'); expect(fixture.eq).toHaveBeenCalledWith('user_id', 'synthetic-owner');
});

it('does not read listings when authentication fails', async () => {
  fixture.auth.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Synthetic session failure' } });
  await render(); expect(text()).toContain('Synthetic session failure'); expect(fixture.read).not.toHaveBeenCalled();
  expect(text()).not.toContain('No listing exports yet');
});

it('keeps the last successful list after refresh failure and disables stale status changes', async () => {
  await render(); fixture.read.mockRejectedValueOnce(new Error('Synthetic connection failure'));
  await click('Refresh data'); expect(text()).toContain('2004 Synthetic Truck'); expect(text()).toContain('Showing the last successful list');
  expect(button('Mark submitted').disabled).toBe(true); await click('Mark submitted'); expect(fixture.update).not.toHaveBeenCalled();
});

it('distinguishes an empty successful list from a filter with no matches', async () => {
  await render();
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Listing status"]')!;
  await act(async () => { select.value = 'sold'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(text()).toContain('No listings match these filters'); expect(text()).not.toContain('No listing exports yet');
  fixture.read.mockResolvedValueOnce(reply([])); await click('Refresh data');
  expect(text()).toContain('No listing exports yet');
});

it.each(['returned', 'rejected'])('shows %s writer refusal and preserves the existing status', async kind => {
  if (kind === 'rejected') fixture.update.mockRejectedValueOnce(new Error('Synthetic refusal'));
  await render(); await click('Mark submitted');
  expect(text()).toContain('Synthetic refusal'); expect(button('Mark submitted')).toBeDefined();
  expect(button('Mark active')).toBeUndefined(); expect(fixture.read).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain('Listing status updated');
});

it('blocks duplicate status submissions and confirms success only after the reader returns it', async () => {
  let finish!: (value: unknown) => void;
  fixture.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { const submit = button('Mark submitted'); submit.click(); submit.click(); });
  expect(fixture.update).toHaveBeenCalledTimes(1); expect(button('Saving…').disabled).toBe(true); expect(button('Refresh data').disabled).toBe(true);
  fixture.read.mockResolvedValueOnce(reply([listing('submitted')]));
  await act(async () => finish({ success: true }));
  expect(fixture.update).toHaveBeenCalledWith('synthetic-export', 'submitted', { submitted_at: expect.any(String) });
  expect(text()).toContain('Listing status updated'); expect(button('Mark active')).toBeDefined();
});

it('does not claim a successful status change when the reader still returns the old status', async () => {
  fixture.update.mockResolvedValueOnce({ success: true }); await render(); await click('Mark submitted');
  expect(text()).toContain('updated status could not be confirmed');
  expect(text()).not.toContain('Listing status updated'); expect(button('Mark submitted')).toBeDefined();
});

it('does not follow an old writer response with reads after the page is unmounted', async () => {
  let finish!: (value: unknown) => void;
  fixture.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); await click('Mark submitted'); await act(async () => root.render(<div>Another page</div>));
  await act(async () => finish({ success: true }));
  expect(fixture.read).toHaveBeenCalledTimes(1); expect(text()).toBe('Another page');
});

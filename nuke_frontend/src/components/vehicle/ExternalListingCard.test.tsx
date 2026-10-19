// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], from: vi.fn(), eq: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from } }));
import ExternalListingCard from './ExternalListingCard';

const vehicleId = '00000000-0000-4000-8000-000000000001';
const url = 'https://www.goodingco.com/lot/fixture';
const listing = (changes: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000002', source_platform: 'gooding', source_url: url,
  event_status: 'pending', ended_at: '2026-11-08T00:00:00Z', sold_at: null,
  current_price: null, final_price: null, created_at: '2026-10-10T04:10:34Z',
  metadata: { currency: 'CHF', auction_session_days: ['2026-11-08'] }, ...changes,
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rows = [listing()]; fixture.eq.mockClear();
  const query: any = {
    select: () => query, eq: (...args: unknown[]) => { fixture.eq(...args); return query; },
    order: () => query, limit: () => Promise.resolve({ data: fixture.rows, error: null }),
  };
  fixture.from.mockReset().mockReturnValue(query);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<ExternalListingCard vehicleId={vehicleId} />)); }

it.each(['pending', 'upcoming', 'scheduled'])('shows a %s lot on its source run day, without a completed or invented time', async event_status => {
  fixture.rows = [listing({ event_status })];
  await render();
  expect(container.textContent).toContain('Scheduled: Nov 8, 2026');
  expect(container.textContent).not.toMatch(/Ended:|Nov 7|4:00 PM/);
  expect(container.querySelector('a')?.getAttribute('href')).toBe(url);
  expect(fixture.from).toHaveBeenCalledWith('vehicle_events');
  expect(fixture.eq).toHaveBeenCalledWith('vehicle_id', vehicleId);
});

it('keeps the calendar day fallback when a scheduled lot has no session-day metadata', async () => {
  fixture.rows = [listing({ metadata: {} })];
  await render();
  expect(container.textContent).toContain('Scheduled: Nov 8, 2026');
  expect(container.textContent).not.toMatch(/Ended:|4:00 PM/);
});

it('can show the source run day without borrowing an ingestion timestamp', async () => {
  fixture.rows = [listing({ ended_at: null })];
  await render();
  expect(container.textContent).toContain('Scheduled: Nov 8, 2026');
  expect(container.textContent).not.toContain('Oct 10');
});

it('does not invent a day when scheduled date evidence is missing or invalid', async () => {
  fixture.rows = [listing({ ended_at: null, metadata: { auction_session_days: ['2026-02-30'] } })];
  await render();
  expect(container.textContent).toContain('PENDING');
  expect(container.textContent).not.toMatch(/Scheduled:|Ended:|Invalid Date|Oct 10|Mar 2/);
});

it.each([null, '', 'not a currency', 'ZZZ'])('does not invent dollars for an unqualified recorded amount (currency: %s)', async currency => {
  fixture.rows = [listing({ event_status: 'sold', ended_at: null, final_price: '250000', metadata: { currency } })];
  await render();
  expect(container.textContent).toContain('Recorded amount');
  expect(container.textContent).toContain('250,000 (currency unrecorded)');
  expect(container.textContent).not.toContain('$');
  expect(container.textContent).not.toContain('Sold For');
  expect(container.textContent).not.toContain('Oct 10');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(url);
});

it('preserves explicit CHF amounts and an active auction timestamp', async () => {
  fixture.rows = [listing({ event_status: 'active', current_price: 125000, ended_at: '2026-11-08T20:30:00Z',
    metadata: { currency: 'CHF' } })];
  await render();
  expect(container.textContent).toContain('CHF');
  expect(container.textContent).toContain('125,000');
  expect(container.textContent).toContain('Current Bid');
  expect(container.textContent).toContain('Ends:');
  expect(container.textContent).not.toContain('Scheduled:');
  expect(container.textContent).not.toContain('currency unrecorded');
  expect(container.textContent).not.toContain('$');
});

it('preserves an explicitly denominated completed sale', async () => {
  fixture.rows = [listing({ event_status: 'sold', final_price: 50000, sold_at: '2026-10-01T20:00:00Z',
    metadata: { currency: 'USD' } })];
  await render();
  expect(container.textContent).toContain('$50,000');
  expect(container.textContent).toContain('Sold For');
  expect(container.textContent).toContain('Sold: Oct 1, 2026');
  expect(container.textContent).not.toContain('currency unrecorded');
});

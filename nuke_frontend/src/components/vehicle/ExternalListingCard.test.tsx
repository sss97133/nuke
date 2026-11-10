// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], history: [] as any[], historyError: false, from: vi.fn(), eq: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from, rpc: (_name: string, args: any) => ({ abortSignal: () => Promise.resolve({
  data: [{ vehicle_id: args.p_vehicle_ids[0], schema_version: 'vehicle_data_model_v1', native_listing_history: {
    reader: 'cc_native_profile_history_v1', entries: fixture.history, capture_limit: 50, has_more_captures: false } }],
  error: fixture.historyError ? { message: 'unavailable' } : null,
}) }) } }));
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
  fixture.rows = [listing()]; fixture.history = []; fixture.historyError = false; fixture.eq.mockClear();
  const query: any = {
    select: () => query, eq: (...args: unknown[]) => { fixture.eq(...args); return query; },
    order: () => query, abortSignal: () => query, limit: () => Promise.resolve({ data: fixture.rows, error: null }),
  };
  fixture.from.mockReset().mockReturnValue(query);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

const native = (changes = {}) => ({ observation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 source_url: 'https://collectingcars.com/for-sale/fixture-car', source_listing_id: '1', source: 'collecting-cars',
 qualification: 'publisher_reported_unverified', reported_outcome: 'sold', reported_amount: 67500, reported_amount_kind: 'sale_price', currency: 'GBP',
 reported_event_at: '2019-06-06T15:02:00Z', source_captured_at: '2026-01-01T00:00:00Z', ingested_at: '2026-01-01T00:00:02Z',
 mileage: 283785, mileage_unit: 'mi', bid_count: 38, ...changes });
it('shows a captured publisher result when no auction episode exists, with source and capture clocks separate', async () => {
 fixture.rows = []; fixture.history = [native()]; await render();
 expect(container.textContent).toContain('Collecting Cars reports sold');
 expect(container.textContent).toContain('£67,500');
 expect(container.textContent).toContain('2019-06-06T15:02:00.000Z');
 expect(container.textContent).toContain('2026-01-01T00:00:00.000Z');
 expect(container.textContent).toContain('283,785 miles');
 expect(container.textContent).toContain('aggregate count, not retained individual bid history');
 expect(container.textContent).toContain('not independently verified');
 expect(container.querySelector('a[href$="/observation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]')).not.toBeNull();
});
it('keeps sold-with-undisclosed-price distinct from unsold', async () => {
 fixture.rows = []; fixture.history = [native({ reported_amount: null })]; await render();
 expect(container.textContent).toContain('reports sold'); expect(container.textContent).toContain('Sale amount not stated');
 expect(container.textContent).not.toContain('£');
});
it('renders the sanitized native kilometer reading, not the extractor normalized miles scalar', async () => {
 fixture.rows = []; fixture.history = [native({ mileage: 157, mileage_unit: 'km' })]; await render();
 expect(container.textContent).toContain('Source odometer: 157 km');
 expect(container.textContent).not.toContain('98 km');
});
it('keeps an old different-lot episode separate from the source result', async () => {
 fixture.rows = [listing({ event_status: 'sold', final_price: 11000, metadata: { currency: 'USD' } })];
 fixture.history = [native()]; await render();
 expect(container.textContent).toContain('$11,000'); expect(container.textContent).toContain('£67,500');
});
it('exposes an unsold high bid without calling it a sale price', async () => {
 fixture.rows = []; fixture.history = [native({ reported_outcome: 'unsold', reported_amount_kind: 'high_bid' })]; await render();
 expect(container.textContent).toContain('Reported high bid: £67,500');
 expect(container.textContent).toContain('no sale reported'); expect(container.textContent).not.toContain('reports sold');
});
it('shows classified termination with unknown outcome, original actual end and no asking-price promotion', async () => {
 fixture.rows = []; fixture.history = [native({ reported_outcome: 'unknown', reported_listing_stage: 'ended', sale_format: 'classified',
  reported_amount: null, reported_amount_kind: null, reported_event_at: '2023-12-07T00:00:04Z', bid_count: null })]; await render();
 expect(container.textContent).toContain('Collecting Cars reports listing ended');
 expect(container.textContent).toContain('Sale outcome unknown');
 expect(container.textContent).toContain('2023-12-07T00:00:04.000Z');
 expect(container.textContent).toContain('2026-01-01T00:00:00.000Z');
 expect(container.textContent).not.toContain('reports unsold');
 expect(container.textContent).not.toContain('Reported high bid');
 expect(container.textContent).not.toContain('£10,995');
});
it('shows failure rather than treating unreadable source history as an empty auction history', async () => {
 fixture.rows = []; fixture.historyError = true; await render();
 expect(container.querySelector('[role=status]')?.textContent).toContain('could not be read');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<ExternalListingCard vehicleId={vehicleId} />)); }

it('shows the retained source-read clock and observation without claiming an individual bid time', async () => {
  fixture.rows = [listing({ event_status: 'active', current_price: 15000, currency_code: 'AUD', bid_count: 31,
    watcher_count: 0, view_count: 0, metadata: { capture_kind: 'auction_bid_snapshot',
      source_observed_at: '2026-11-09T01:06:03.523Z', auction_observation_id: '1d32679c-e1e5-46a0-a397-b10c3cf42340' } })];
  await render();
  expect(container.textContent).toContain('A$15,000');
  expect(container.textContent).toContain('Source read: 2026-11-09T01:06:03.523Z');
  expect(container.textContent).toContain('Auction snapshot, not an individual bid time');
  expect(container.textContent).toContain('WatchersUnrecorded');
  expect(container.textContent).toContain('ViewsUnrecorded');
  expect(container.querySelector('a[href$="/observation/1d32679c-e1e5-46a0-a397-b10c3cf42340"]')).not.toBeNull();
});

it.each(['invalid', '2999-01-01T00:00:00Z', undefined])('never replaces unknown source time with row or end clocks (%s)', async source_observed_at => {
  fixture.rows = [listing({ event_status: 'active', updated_at: '2026-11-09T02:00:00Z', metadata: { source_observed_at } })];
  await render();
  expect(container.textContent).toContain('Source read: Unrecorded');
  expect(container.textContent).not.toContain('2026-11-09T02:00:00');
});
it('shows an active source snapshot deadline without claiming terminal time', async () => {
  fixture.rows = [listing({ source_platform: 'purplewave', event_status: 'active', ended_at: null,
    metadata: { auction_end_date: '2026-11-12T20:00:00Z', capture_kind: 'auction_state_snapshot' } })];
  await render();
  expect(container.textContent).toContain('Ends: Nov 12, 2026');
  expect(container.textContent).toContain('Auction snapshot, not an individual bid time');
  expect(container.textContent).not.toContain('Ended:');
});
it('never substitutes a scheduled source deadline for a terminal sale clock', async () => {
  fixture.rows = [listing({ event_status: 'sold', ended_at: null, sold_at: null,
    metadata: { auction_end_date: '2026-11-12T20:00:00Z', capture_kind: 'auction_state_snapshot' } })];
  await render();
  expect(container.textContent).not.toMatch(/Nov 12|Ended:|Sold:/);
});

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


it('reads a source-cited canonical currency without replacing an older unknown-currency episode', async () => {
  fixture.rows = [listing({ source_platform: 'bat', event_status: 'active', current_price: 75000,
    currency_code: 'USD', currency_source: 'Native BaT inventory item.currency=USD', metadata: {} }),
    listing({ id: 'prior', source_platform: 'barrettjackson', source_url: 'https://www.barrett-jackson.com/fixture',
      event_status: 'sold', final_price: 121000, sold_at: '2026-01-15T00:00:00Z', metadata: {} })];
  await render();
  expect(container.textContent).toContain('$75,000');
  expect(container.textContent).toContain('Current Bid');
  expect(container.textContent).toContain('121,000 (currency unrecorded)');
  expect(container.querySelectorAll('a')).toHaveLength(2);
});

it('prefers the canonical price currency and preserves the explicit legacy currency-code fallback', async () => {
  fixture.rows = [listing({ event_status: 'active', current_price: 75000, currency_code: 'CHF',
    metadata: { currency: 'USD' } })];
  await render();
  expect(container.textContent).toContain('CHF');
  expect(container.textContent).not.toContain('$');
  fixture.rows = [listing({ event_status: 'active', current_price: 75000, currency_code: null,
    metadata: { currency_code: ' eur ' } })];
  await act(async () => root.render(<ExternalListingCard vehicleId="other" />));
  expect(container.textContent).toContain('€75,000');
  expect(container.textContent).not.toContain('currency unrecorded');
});

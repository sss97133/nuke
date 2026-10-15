// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { daysUntil, houseLink, runTimer, saleTimer, updatedAgo } from './useAuctionCalendar';

const fixture = vi.hoisted(() => ({ calendar: {} as any, roster: {} as any, rosterFor: vi.fn(), more: vi.fn() }));
vi.mock('./useAuctionCalendar', async original => ({
  ...await original<typeof import('./useAuctionCalendar')>(),
  useAuctionCalendar: () => fixture.calendar,
  useSaleRoster: (sale: any) => { fixture.rosterFor(sale); return fixture.roster; },
}));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import AuctionCalendar from './AuctionCalendar';

it('exercises every full calendar reader replacement in the database source-clock contract', () => {
  const migrations = resolve(__dirname, '../../../../supabase/migrations');
  const contract = readFileSync(resolve(migrations, '../sql/test_calendar_prior_source_clock.sql'), 'utf8');
  const replacements = readdirSync(migrations).filter(name => name.endsWith('.sql') &&
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.auction_calendar_read\s*\(/i.test(readFileSync(resolve(migrations, name), 'utf8')));
  expect(replacements.length).toBeGreaterThanOrEqual(3);
  for (const name of replacements) expect(contract).toContain(`\\ir ../migrations/${name}`);
});

// Synthetic sales and lots. Local noon on 2026-10-15, so day arithmetic is the same in every time zone.
const NOW = new Date(2026, 9, 15, 12, 0, 0);
const SALES = [
  { house: 'mecum', sale_key: 'fixture-fall-2026', sale_name: 'Fixture Fall 2026', location: 'Fixture City, TX', starts_on: '2026-10-21', ends_on: '2026-10-24',
    lots: 612, seen_before: 212, no_reserve: 300, first_seen_at: '2026-08-01T00:00:00Z', first_seen_7d: 40, updated_at: new Date(2026, 9, 15, 11, 48).toISOString(),
    lots_listed: 1037, listed_at: new Date(2026, 9, 15, 10, 0).toISOString(),
    run_days: [{ day: '2026-10-21', lots: 200 }, { day: '2026-10-22', lots: 280 }, { day: '2026-10-23', lots: 300 }, { day: '2026-10-24', lots: 257 }] },
  { house: 'gooding', sale_key: 'fixture-winter-2027', sale_name: 'Fixture Winter Auction', location: null, starts_on: '2027-01-08', ends_on: '2027-01-08',
    lots: 2, seen_before: 1, no_reserve: 1, first_seen_at: '2026-10-07T00:00:00Z', first_seen_7d: 2, updated_at: new Date(2026, 9, 14, 9, 0).toISOString(),
    lots_listed: null, listed_at: null, run_days: [{ day: '2027-01-08', lots: 2 }] },
];
const ROWS = [
  { event_id: 'e1', vehicle_id: 'v1', source_url: 'https://www.goodingco.com/lot/fixture-one', lot_number: '12', run_on: '2027-01-08',
    year: 1967, make: 'Fixturemake', model: 'Alpha', image: null, vin_present: true, has_reserve: false, estimate_low: 100000, estimate_high: 140000,
    currency: 'CHF', first_seen_at: '2026-10-13T20:00:00Z',
    prior: [
      { house: 'bat', on: '2023-03-04', outcome: 'sold', amount: 48500, currency: null, basis: 'source', url: 'https://bringatrailer.com/listing/fixture-one/' },
      { house: 'mecum', on: '2024-01-12', outcome: 'sold', amount: 41000, currency: null, basis: 'unconfirmed', url: 'https://www.mecum.com/lots/1/fixture-one/' },
      { house: 'mecum', on: '2022-05-20', outcome: 'not_sold', amount: 39000, currency: null, basis: 'source', url: 'https://evil.example/phish' },
    ] },
  { event_id: 'e2', vehicle_id: 'v2', source_url: 'https://www.goodingco.com/lot/fixture-two', lot_number: null, run_on: '2027-01-08',
    year: 2024, make: 'Fixturemake', model: 'Beta', image: null, vin_present: false, has_reserve: true, estimate_low: null, estimate_high: null,
    currency: 'CHF', first_seen_at: '2026-10-13T20:00:00Z', prior: [] },
];

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  fixture.rosterFor.mockClear(); fixture.more.mockClear();
  fixture.calendar = { isPending: false, isError: false, data: { as_of: '2026-10-15T01:00:00Z', horizon_days: 200,
    population: { lots: 614, listed: 1039, sales: 2, houses: 2, seen_before: 213, no_reserve: 301, first_seen_7d: 42, updated_at: new Date(2026, 9, 15, 11, 48).toISOString() }, sales: SALES,
    unplaced: [{ house: 'mecum', sale_key: 'fixture-winter-2027', sale_name: 'Fixture Winter 2027', lots_listed: 855, listed_at: '2026-10-15T10:00:00Z' }], roster: null } };
  fixture.roster = { isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage: fixture.more,
    data: { pages: [{ as_of: '2026-10-15T01:00:00Z', roster: { house: 'gooding', sale_key: 'fixture-winter-2027', lots: 2, offset: 0, rows: ROWS } }] } };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(query = 'tab=market&collection=calendar') {
  window.history.replaceState({}, '', '/?' + query);
  await act(async () => root.render(<BrowserRouter><AuctionCalendar /></BrowserRouter>));
}

describe('day-precision timers', () => {
  it('counts calendar days, runs a multi-day sale by day, and never shows a clock below a day', () => {
    const now = NOW.getTime();
    expect(daysUntil('2026-10-21', now)).toBe(6);
    expect(saleTimer('2026-10-21', '2026-10-24', now)).toBe('in 6 days');
    expect(saleTimer('2026-10-16', '2026-10-16', now)).toBe('tomorrow');
    expect(saleTimer('2026-10-14', '2026-10-17', now)).toBe('running · day 2 of 4');
    expect(saleTimer('2026-10-15', '2026-10-15', now)).toBe('running today');
    expect(saleTimer('2026-10-10', '2026-10-12', now)).toBe('ended');
    expect(runTimer('2026-10-15', now)).toBe('runs today');
    expect(runTimer('2027-01-08', now)).toBe('runs in 85 days');
  });
  it('says how long ago the data was written, never a full timestamp', () => {
    const now = NOW.getTime();
    expect(updatedAgo(new Date(now - 20_000).toISOString(), now)).toBe('updated just now');
    expect(updatedAgo(new Date(now - 12 * 60_000).toISOString(), now)).toBe('updated 12 min ago');
    expect(updatedAgo(new Date(now - 27 * 3_600_000).toISOString(), now)).toBe('updated 27 h ago');
    expect(updatedAgo(new Date(now - 5 * 86_400_000).toISOString(), now)).toBe('updated 5 days ago');
    expect(updatedAgo(null, now)).toBe('update time unrecorded');
  });
  it('links a house page only on that house host over https', () => {
    expect(houseLink('mecum', 'https://www.mecum.com/lots/1/x/')).toBe('https://www.mecum.com/lots/1/x/');
    expect(houseLink('mecum', 'https://evil.example/lots/1/x/')).toBeNull();
    expect(houseLink('mecum', 'http://www.mecum.com/lots/1/x/')).toBeNull();
    expect(houseLink('unknown-house', 'https://www.mecum.com/lots/1/x/')).toBeNull();
  });
});

it('states the lots with their population and lists each sale with its timer and roster counts', async () => {
  await render();
  expect(container.querySelector('h1')?.textContent).toBe('Auction calendar');
  expect(container.textContent).toContain('614 of 1,039 lots');
  expect(container.textContent).toContain('landed of the lots the houses list, on 2 scheduled sales from 2 houses in the next 200 days · 213 with an earlier record on Nuke · updated 12 min ago');
  expect(container.querySelector('.auction-unplaced')?.textContent).toBe('Also listed, days and lots not landed yet: Mecum Fixture Winter 2027, 855 lots');
  expect(container.textContent).not.toMatch(/as of|\d{1,2}:\d{2}:\d{2}/);
  const rows = [...container.querySelectorAll('tr.auction-sale')];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('in 6 days');
  expect(rows[0].textContent).toContain('Mecum');
  expect(rows[0].textContent).toContain('612 of 1,037 lots');
  expect(rows[0].textContent).toContain('Mecum lists 1,037, read 2 h ago');
  expect(rows[0].textContent).toContain('212 with an earlier record · 300 no reserve');
  expect(rows[0].textContent).toContain('40 first seen in the last 7 days · updated 12 min ago');
  expect(rows[1].textContent).toContain('in 85 days');
  expect(rows[1].textContent).toContain('updated 27 h ago');
  expect(rows[1].textContent).toContain('2 lots');
  expect(rows[1].textContent).not.toContain(' of ');
  expect(rows[1].textContent).toContain('Gooding & Co');
  expect(rows[0].querySelectorAll('rect.auction-track__day')).toHaveLength(4);
  expect(fixture.rosterFor).not.toHaveBeenCalled();
});

it('opens a roster in place by run day, with earlier records in the source terms, and closes it again', async () => {
  await render();
  const open = [...container.querySelectorAll('button.auction-sale__open')].find(b => b.textContent?.includes('Fixture Winter Auction'))!;
  await act(async () => (open as HTMLButtonElement).click());
  expect(new URLSearchParams(window.location.search).get('sale')).toBe('gooding:fixture-winter-2027');
  expect(fixture.rosterFor).toHaveBeenLastCalledWith({ house: 'gooding', key: 'fixture-winter-2027' });
  const roster = container.querySelector('.auction-roster')!;
  expect(roster.textContent).toContain('2 lots · runs in 85 days');
  expect(roster.textContent).toContain('Lot 12 · no reserve · est. CHF 100,000 to CHF 140,000');
  expect(roster.textContent).toContain('Bring a Trailer · Mar 4, 2023 · sold $48,500');
  expect(roster.textContent).toContain('Mecum · Jan 12, 2024 · $41,000 recorded, result unconfirmed');
  expect(roster.textContent).toContain('Mecum · May 20, 2022 · not sold, high bid $39,000');
  expect(roster.querySelector('a[href="https://evil.example/phish"]')).toBeNull();
  expect(roster.textContent).toContain('No earlier record of this vehicle on Nuke');
  expect(roster.querySelector('a[href="/vehicle/v1"]')).not.toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'More lots')!.click());
  expect(fixture.more).toHaveBeenCalledOnce();
  await act(async () => (open as HTMLButtonElement).click());
  expect(new URLSearchParams(window.location.search).get('sale')).toBeNull();
  expect(container.querySelector('.auction-roster')).toBeNull();
});

it('shows only the house count for a listed sale with no lot landed', async () => {
  fixture.calendar.data = { ...fixture.calendar.data, sales: [...SALES, { house: 'mecum', sale_key: 'fixture-empty-2027', sale_name: 'Fixture Empty 2027',
    location: null, starts_on: '2027-01-05', ends_on: '2027-01-17', lots: 0, seen_before: 0, no_reserve: 0, first_seen_at: null,
    first_seen_7d: 0, updated_at: null, lots_listed: 855, listed_at: new Date(2026, 9, 15, 11, 0).toISOString(), run_days: [] }] };
  await render();
  const row = [...container.querySelectorAll('tr.auction-sale')].find(r => r.textContent?.includes('Fixture Empty 2027'))!;
  expect(row.textContent).toContain('0 of 855 lots');
  expect(row.textContent).toContain('Mecum lists 855, read 1 h ago');
  expect(row.textContent).not.toContain('first seen');
  expect(row.textContent).not.toContain('update time unrecorded');
  expect(row.textContent).not.toContain('no reserve');
});
it('says when a listed sale has no lot landed yet', async () => {
  fixture.roster = { ...fixture.roster, hasNextPage: false, data: { pages: [{ as_of: '2026-10-15T01:00:00Z', roster: { house: 'gooding', sale_key: 'fixture-winter-2027', lots: 0, offset: 0, rows: [] } }] } };
  await render();
  const open = [...container.querySelectorAll('button.auction-sale__open')].find(b => b.textContent?.includes('Fixture Winter Auction'))!;
  await act(async () => (open as HTMLButtonElement).click());
  expect(container.textContent).toContain('No lot of this sale has landed yet.');
});
it('says so when no scheduled sale has a lot landed', async () => {
  fixture.calendar.data = { ...fixture.calendar.data, population: { lots: 0, listed: 0, sales: 0, houses: 0, seen_before: 0, no_reserve: 0, first_seen_7d: 0 }, sales: [], unplaced: [] };
  await render();
  expect(container.textContent).toContain('No scheduled sale has a lot landed for the next 200 days.');
  expect(container.querySelector('table')).toBeNull();
});

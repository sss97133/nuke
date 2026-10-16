// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import SourcesBoard, { heldShare, landingState, monthBars, money, parseSources } from './SourcesBoard';

// market_sources_read (20261018030000), shaped as production answers: columns, then one array per source by held lots.
const columns = ['source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14'];
const days = (today: number) => [...Array(13).fill(0), today];
const value = {
  as_of: '2026-10-16T10:47:00Z', day: '2026-10-16', columns,
  rows: [
    ['bat', 'Bring a Trailer', 'auction', 'Bring a Trailer', 252399, '2026-10-16T10:27:00Z', 264746, 'enumerated', 0.9,
      '2026-09-27T00:00:00Z', 183455, 8488000000, 39173, 2000000000, 34829, 1700000000,
      [['2025-11', 3000, 150000000], ['2026-10', 1500, 80000000]], 1265, '2026-10-16T10:46:00Z', 251000, '2026-10-09',
      2055, 3321, '2026-10-16T10:00:00Z', days(2055)],
    ['mecum', 'Mecum Auctions', 'auction', 'Mecum', 62314, '2026-10-16T10:27:00Z', 268979, 'enumerated', 0.85,
      '2026-10-15T00:00:00Z', 51151, 2900000000, 6034, 400000000, 5891, 380000000, [['2026-01', 2000, 90000000]], 0, null,
      48934, '2026-10-09', 151435, 151435, '2026-10-16T10:00:00Z', days(151435)],
    ['cars-and-bids', 'Cars & Bids', 'auction', 'Cars & Bids', 18659, '2026-10-16T10:27:00Z', null, 'unknown', null, null,
      null, null, null, null, null, null, null, 0, null, null, null, 0, 0, '2026-10-03T14:00:00Z', days(0)],
    ['craigslist', 'Craigslist', 'marketplace', null, 8411, '2026-10-16T10:27:00Z', null, null, null, null,
      null, null, null, null, null, null, null, 0, null, null, null, 1257, 2232, '2026-10-16T09:00:00Z', days(1257)],
  ],
  not_ranked: { 'capture channels': 2, aggregator: 2, dealer: 2, shop: 1 },
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.rpc.mockReset(); });

it('decodes the reader by column name and refuses anything else', () => {
  const d = parseSources(value)!;
  expect(d.rows.map((r) => r.source)).toEqual(['bat', 'mecum', 'cars-and-bids', 'craigslist']);
  expect(d.rows[0]).toMatchObject({ held: 252399, population: 264746, live: 1265, heldBefore: 251000, sales12: 39173 });
  expect(d.rows[2]).toMatchObject({ population: null, months: [], live: 0, landed24: 0 });
  expect(d.rows[1]).toMatchObject({ landed24: 151435, landed7: 151435 });
  expect(d.rows[1].days14).toHaveLength(14);
  expect(d.notRanked).toEqual({ 'capture channels': 2, aggregator: 2, dealer: 2, shop: 1 });
  // a reordered payload decodes the same
  const order = [...columns].reverse();
  const reordered = { ...value, columns: order, rows: value.rows.map((r) => order.map((c) => r[columns.indexOf(c)])) };
  expect(parseSources(reordered)!.rows.map((r) => [r.source, r.held])).toEqual(d.rows.map((r) => [r.source, r.held]));
  expect(parseSources(null)).toBeNull();
  expect(parseSources([value])).toBeNull();
  expect(parseSources({ ...value, columns: ['name'] })).toBeNull();
});

it('says how much of its own total we hold, in the total\'s terms', () => {
  expect(heldShare({ held: 252399, population: 264746, populationMethod: 'enumerated' })).toEqual({ share: 252399 / 264746, text: '95% of 264,746' });
  expect(heldShare({ held: 6081, population: 27166, populationMethod: 'bounded' }).text).toBe('22% of about 27,166');
  expect(heldShare({ held: 18659, population: null, populationMethod: 'unknown' })).toEqual({ share: null, text: 'their total unknown' });
  expect(heldShare({ held: 445, population: 56004, populationMethod: 'bounded' }).text).toBe('<1% of about 56,004');
  expect(money(8488000000)).toBe('$8.5B');
  expect(money(575000000)).toBe('$575M');
  expect(money(null)).toBe('');
});

it('says whether a source is landing data now, or since when it has been idle', () => {
  expect(landingState({ landed24: 151435, lastLanded: '2026-10-16T10:00:00Z' })).toEqual({ active: true, text: '+151,435 today' });
  expect(landingState({ landed24: 0, lastLanded: '2026-10-03T14:00:00Z' })).toEqual({ active: false, text: 'idle since Oct 3' });
  expect(landingState({ landed24: 0, lastLanded: null })).toEqual({ active: false, text: 'nothing landed yet' });
});

it('draws 24 months ending at the board\'s month, empty months as zero', () => {
  const bars = monthBars([['2025-11', 3000, 0], ['2026-10', 1500, 0], ['2024-01', 9, 0]], '2026-10-16');
  expect(bars).toHaveLength(24);
  expect(bars[23]).toBe(1500);
  expect(bars[12]).toBe(3000);
  expect(bars.reduce((a, b) => a + b, 0)).toBe(4500);
});

it('ranks auction houses and marketplaces apart, same row for each, as the reader orders them', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard />));
  expect(fixture.rpc).toHaveBeenCalledWith('market_sources_read');
  const groups = [...container.querySelectorAll('.market-sources__group')];
  expect(groups.map((g) => g.querySelector('.market-sources__group-title')?.textContent)).toEqual(['Auction houses', 'Marketplaces']);
  expect(groups.map((g) => [...g.querySelectorAll('.market-sources__name')].map((n) => n.textContent))).toEqual(
    [['Bring a Trailer', 'Mecum Auctions', 'Cars & Bids'], ['Craigslist']]);
  expect(groups[1].querySelector('.market-sources__rank')?.textContent).toBe('1');
  expect(groups[1].querySelector('.market-sources__cols .n')?.textContent).toBe('listings held');
  const rows = [...container.querySelectorAll('li.market-sources__row')];
  expect(rows.every((r) => r.children.length === 7)).toBe(true);
  expect(rows[0].querySelector('.market-sources__held')?.textContent).toBe('252,399 +1,399 since Oct 9');
  expect(rows[0].querySelector('.market-sources__sharetext')?.textContent).toBe('95% of 264,746');
  expect(rows[0].querySelector('.market-sources__live')?.textContent).toBe('1,265 live');
  expect(rows[0].querySelectorAll('.market-sources__spark rect')).toHaveLength(24);
  expect(rows[1].querySelector('.market-sources__live')?.textContent).toBe('—');
  expect(rows[2].querySelector('.market-sources__track--unknown')).not.toBeNull();
  expect(rows[2].querySelector('.market-sources__sharetext')?.textContent).toBe('their total unknown');
  expect(rows[1].querySelector('.market-sources__landtext')?.textContent).toBe('+151,435 today');
  expect(rows[1].querySelectorAll('.market-sources__days rect')).toHaveLength(14);
  expect(rows[2].querySelector('.market-sources__landtext')?.textContent).toBe('idle since Oct 3');
  expect(rows[2].querySelector('.market-sources__landing i.off')).not.toBeNull();
  expect(container.querySelector('.market-sources__foot .market-sources__note')?.textContent)
    .toBe('not ranked: 2 capture channels, 2 aggregators, 2 dealers, 1 shop');
  expect(container.querySelector('.market-sources__note')?.textContent).toContain('held counts as of Oct 16, 10:27 UTC');
});

it('shows nothing when the reader fails or holds no rows', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
  await act(async () => root.render(<SourcesBoard />));
  expect(container.querySelector('.market-sources')).toBeNull();
});

it('stays off the page when the client itself throws', async () => {
  fixture.rpc.mockImplementation(() => { throw new Error('no client'); });
  await act(async () => root.render(<SourcesBoard />));
  expect(container.querySelector('.market-sources')).toBeNull();
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import SourcesBoard, { heldShare, landingState, monthBars, money, parseSourceLanding, parseSources, shortName } from './SourcesBoard';

// market_sources_read (20261018034000), shaped as production answers: columns, then one array per source by held lots, plus landing.
const columns = ['source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14', 'logo_url', 'business_type'];
const days = (today: number) => [...Array(13).fill(0), today];
const hours = (lastHour: number) => [...Array(22).fill(2), 14, lastHour];
const mins = (last5m: number) => [...Array(10).fill(0), 4, last5m];
const value = {
  as_of: '2026-10-16T10:47:00Z', day: '2026-10-16', columns,
  rows: [
    ['bat', 'Bring a Trailer', 'auction', 'Bring a Trailer', 252399, '2026-10-16T10:27:00Z', 264746, 'enumerated', 0.9,
      '2026-09-27T00:00:00Z', 183455, 8488000000, 39173, 2000000000, 34829, 1700000000,
      [['2025-11', 3000, 150000000], ['2026-10', 1500, 80000000]], 1265, '2026-10-16T10:46:00Z', 251000, '2026-10-09',
      2055, 3321, '2026-10-16T10:00:00Z', days(2055), 'https://example.test/bat.png', 'auction_house'],
    ['mecum', 'Mecum Auctions', 'auction', 'Mecum', 62314, '2026-10-16T10:27:00Z', 268979, 'enumerated', 0.85,
      '2026-10-15T00:00:00Z', 51151, 2900000000, 6034, 400000000, 5891, 380000000, [['2026-01', 2000, 90000000]], 0, null,
      48934, '2026-10-09', 151435, 151435, '2026-10-16T10:00:00Z', days(151435), null, 'auction_house'],
    ['cars-and-bids', 'Cars & Bids', 'auction', 'Cars & Bids', 18659, '2026-10-16T10:27:00Z', null, 'unknown', null, null,
      null, null, null, null, null, null, null, 0, null, null, null, 0, 0, '2026-10-03T14:00:00Z', days(0), null, null],
    ['craigslist', 'Craigslist', 'marketplace', null, 8411, '2026-10-16T10:27:00Z', null, null, null, null,
      null, null, null, null, null, null, null, 0, null, null, null, 1257, 2232, '2026-10-16T09:00:00Z', days(1257), null, null],
  ],
  not_ranked: { 'capture channels': 2, aggregator: 2, dealer: 2, shop: 1 },
  landing: {
    hour: '2026-10-16T10:00:00Z',
    bucket_5m: '2026-10-16T10:45:00Z',
    totals: { landed_15m: 18, landed_1h: 64, landed_24h: 154747, landed_7d: 156988, hours24: hours(64), mins60: mins(9) },
    sources: {
      bat: { landed_15m: 6, landed_1h: 18, landed_24h: 2055, landed_7d: 3321, last_at: '2026-10-16T10:46:12Z', hours24: hours(18), mins60: mins(6) },
      mecum: { landed_15m: 12, landed_1h: 46, landed_24h: 151435, landed_7d: 151435, last_at: '2026-10-16T10:45:50Z', hours24: hours(46), mins60: mins(3) },
    },
  },
};

const batLandingDetail = {
  as_of: '2026-10-16T10:47:05Z',
  source: 'bat',
  hour: '2026-10-16T10:00:00Z',
  selected_hour: null,
  bucket_5m: '2026-10-16T10:45:00Z',
  landed_15m: 6,
  landed_1h: 18,
  landed_24h: 2055,
  landed_7d: 3321,
  last_landed: '2026-10-16T10:46:12Z',
  hours24: hours(18),
  mins60: mins(6),
  days14: days(2055),
  recent: [
    {
      id: 'ev-1',
      source: 'bat',
      event_type: 'auction',
      event_status: 'active',
      price: 42500,
      title: '1991 Acura NSX 5-Speed',
      lot: 'bringatrailer.com/listing/1991-acura-nsx',
      vehicle_id: 'veh-nsx',
      source_url: 'https://bringatrailer.com/listing/1991-acura-nsx',
      created_at: '2026-10-16T10:46:12Z',
    },
  ],
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
  expect(d.rows[0]).toMatchObject({ held: 252399, population: 264746, live: 1265, heldBefore: 251000, sales12: 39173, landed15m: 6, landed1h: 18 });
  expect(d.rows[0].hours24).toHaveLength(24);
  expect(d.rows[0].mins60).toHaveLength(12);
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
  expect(parseSourceLanding(batLandingDetail)?.recent[0]).toMatchObject({ title: '1991 Acura NSX 5-Speed', price: 42500 });
});

it('says how much of its own total we hold, in the total\'s terms, and estimates pool depth with confidence when uncounted', () => {
  expect(heldShare({ held: 252399, population: 264746, populationMethod: 'enumerated' })).toEqual({
    share: 252399 / 264746,
    text: '95% of 264,746',
    estimated: false,
  });
  expect(heldShare({ held: 6081, population: 27166, populationMethod: 'bounded' }).text).toBe('22% of about 27,166');
  expect(heldShare({
    held: 19305,
    population: 37783,
    populationMethod: 'window_extrapolated',
    populationConfidence: 0.56,
  })).toEqual({
    share: 19305 / 37783,
    text: '51% of ~37,783 · 56% conf',
    estimated: true,
  });
  const fallback = heldShare({ held: 18659, population: null, populationMethod: 'unknown' });
  expect(fallback.estimated).toBe(true);
  expect(fallback.share).toBeCloseTo(18659 / 26037, 4);
  expect(fallback.text).toBe('72% of ~26,037 · 39% conf');
  expect(heldShare({ held: 445, population: 56004, populationMethod: 'bounded' }).text).toBe('<1% of about 56,004');
  expect(money(8488000000)).toBe('$8.5B');
  expect(money(575000000)).toBe('$575M');
  expect(money(null)).toBe('');
});

it('says whether a source is landing data now, or since when it has been idle, across 14d / 24h / 1h horizons', () => {
  expect(landingState({ landed24: 151435, lastLanded: '2026-10-16T10:00:00Z' })).toEqual({ active: true, text: '+151,435 today' });
  expect(landingState({ landed24: 2055, landed1h: 18, lastLanded: '2026-10-16T10:46:00Z' }, '24h')).toEqual({ active: true, text: '+18/hr · 2,055 24h' });
  expect(landingState({ landed24: 2055, landed1h: 18, landed15m: 6, lastLanded: '2026-10-16T10:46:00Z' }, '1h')).toEqual({ active: true, text: '+6/15m · 18 1h' });
  expect(landingState({ landed24: 0, lastLanded: '2026-10-03T14:00:00Z' })).toEqual({ active: false, text: 'idle since Oct 3' });
  expect(landingState({ landed24: 0, lastLanded: null })).toEqual({ active: false, text: 'idle 14+ days' });
  expect(shortName('eBay Motors (Browse API)')).toBe('eBay Motors');
  expect(shortName('Bring a Trailer')).toBe('Bring a Trailer');
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
  expect(groups[0].querySelector('.market-sources__name img')?.getAttribute('src')).toBe('https://example.test/bat.png');
  expect(groups[0].querySelectorAll('.market-sources__name')[1].querySelector('img')).toBeNull();   // no recorded logo: the type icon
  expect(groups[0].querySelectorAll('.market-sources__name')[1].querySelector('svg')).not.toBeNull();
  expect(groups[1].querySelector('.market-sources__cols .n')?.textContent).toBe('listings held');
  const rows = [...container.querySelectorAll('li.market-sources__row')];
  expect(rows.every((r) => r.children.length === 7)).toBe(true);
  expect(rows[0].querySelector('.market-sources__held')?.textContent).toBe('252,399 +1,399 since Oct 9');
  expect(rows[0].querySelector('.market-sources__sharetext')?.textContent).toBe('95% of 264,746');
  expect(rows[0].querySelector('.market-sources__live')?.textContent).toBe('1,265 live');
  expect(rows[0].querySelectorAll('.market-sources__spark rect')).toHaveLength(24);
  expect(rows[1].querySelector('.market-sources__live')?.textContent).toBe('—');
  expect(rows[2].querySelector('.market-sources__fill--est')).not.toBeNull();
  expect(rows[2].querySelector('.market-sources__sharetext')?.textContent).toBe('72% of ~26,037 · 39% conf');
  expect(rows[1].querySelector('.market-sources__landtext')?.textContent).toBe('+151,435 today');
  expect(rows[1].querySelectorAll('.market-sources__days rect')).toHaveLength(14);
  expect(rows[2].querySelector('.market-sources__landtext')?.textContent).toBe('idle since Oct 3');
  expect(rows[2].querySelector('.market-sources__landing i.off')).not.toBeNull();
  expect(container.querySelector('.market-sources__foot .market-sources__note')?.textContent)
    .toBe('not ranked: 2 capture channels, 2 aggregators, 2 dealers, 1 shop');
  expect(container.querySelector('.market-sources__note')?.textContent).toContain('held counts as of Oct 16, 10:27 UTC');
});

it('switches the landing column to 24h hourly bars and 1h live bars when clicked, and opens the live hourly inspector on row click', async () => {
  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: value, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: batLandingDetail, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });
  await act(async () => root.render(<SourcesBoard />));

  // Click the "landing, last 14 days" column header toggle -> switches to 24h (hourly)
  const colToggle = container.querySelector('.market-sources__col-toggle') as HTMLButtonElement;
  expect(colToggle.textContent).toBe('landing, last 14 days');
  await act(async () => { colToggle.click(); });
  expect(colToggle.textContent).toBe('landing, last 24 hours');
  const firstRow = container.querySelector('li.market-sources__row')!;
  expect(firstRow.querySelector('.market-sources__landtext')?.textContent).toBe('+18/hr · 2,055 24h');
  expect(firstRow.querySelectorAll('.market-sources__days rect')).toHaveLength(24);

  // Click again -> switches to 1h live (12 x 5-min bars)
  await act(async () => { colToggle.click(); });
  expect(colToggle.textContent).toBe('landing, live 60m');
  expect(firstRow.querySelector('.market-sources__landtext')?.textContent).toBe('+6/15m · 18 1h');
  expect(firstRow.querySelectorAll('.market-sources__days rect')).toHaveLength(12);

  // Click a row's landing button -> opens the inline live & hourly ingestion inspector
  const landBtn = firstRow.querySelector('button.market-sources__landing') as HTMLButtonElement;
  await act(async () => { landBtn.click(); });
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', { p_source: 'bat' });
  const drill = container.querySelector('.market-sources__drill')!;
  expect(drill).not.toBeNull();
  expect(drill.textContent).toContain('Bring a Trailer');
  expect(drill.textContent).toContain('1991 Acura NSX 5-Speed');
  expect(drill.textContent).toContain('$42,500');
  expect(drill.querySelectorAll('.market-sources__hour-col')).toHaveLength(24);
  expect(drill.querySelectorAll('.market-sources__min-col')).toHaveLength(12);

  // Click one of the 24 hourly bars to inspect a specific hour
  const hourButtons = drill.querySelectorAll('.market-sources__hour-col');
  await act(async () => { (hourButtons[20] as HTMLButtonElement).click(); });
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', {
    p_source: 'bat',
    p_hour: '2026-10-16T07:00:00.000Z',
  });
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

it('says Sources · all makes when the market page is scoped to a make', async () => {
  fixture.rpc.mockResolvedValue({ data: value, error: null });
  await act(async () => root.render(<SourcesBoard scope="Ford" />));
  expect(container.querySelector('.market-sources__title')?.textContent).toBe('Sources · all makes');
});

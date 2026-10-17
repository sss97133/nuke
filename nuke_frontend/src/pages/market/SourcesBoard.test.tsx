// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import SourcesBoard, {
  categoryBadgeLabel,
  describeDealerConsignment,
  describeRecordDate,
  formatDealerHqBadge,
  heldShare,
  landingState,
  monthBars,
  money,
  parseSourceLanding,
  parseSources,
  resolveDealerProfileHref,
  resolveSourceCategory,
  shortName,
} from './SourcesBoard';

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
    ['avant-garde-collection', 'Avant-Garde Collection', 'dealer', null, 3246, '2026-10-16T10:27:00Z', null, null, null,
      null, 1641, 164210000, 322, 43880000, 390, 35000000, [['2026-10', 34, 3100000]], 26, '2026-10-16T10:45:00Z',
      3159, '2026-10-09', 3, 87, '2026-10-16T09:00:00Z', days(3), 'https://nuke.ag/source-logos/avant-garde-collection.png', 'dealer'],
    ['beverlyhillscarclub', 'Beverly Hills Car Club', 'dealer', null, 1968, '2026-10-16T10:27:00Z', null, null, null,
      null, 1358, 150000, 1355, null, null, null, [['2026-10', 1355, 150000]], 657, '2026-10-16T10:45:00Z',
      1968, '2026-10-09', 0, 0, null, days(0), 'https://nuke.ag/source-logos/beverlyhillscarclub.png', 'dealer'],
  ],
  not_ranked: { 'capture channels': 2, aggregator: 2, shop: 1 },
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
      reserve: 'no_reserve',
      price: 42500,
      bid_count: 14,
      year: 1991,
      make: 'Acura',
      model: 'NSX 5-Speed',
      trim: 'Base',
      vin: 'JH4NA1150MT001234',
      mileage: 38200,
      record_date: '2026-10-23T18:00:00Z',
      title: '1991 Acura NSX 5-Speed',
      raw_title: '1991 Acura NSX 5-Speed',
      lot: 'bringatrailer.com/listing/1991-acura-nsx',
      vehicle_id: 'veh-nsx',
      source_url: 'https://bringatrailer.com/listing/1991-acura-nsx',
      created_at: '2026-10-16T10:46:12Z',
    },
    {
      id: 'ev-2',
      source: 'bat',
      event_type: 'auction',
      event_status: 'sold',
      reserve: 'reserve',
      price: 18500,
      bid_count: 9,
      year: 1972,
      make: null,
      model: '500 Jolly Conversion',
      trim: null,
      vin: null,
      mileage: null,
      record_date: '2023-06-22 15:00:00+00',
      title: '1972 Fiat 500 Jolly Conversion',
      raw_title: '1972 Fiat 500 Jolly Conversion',
      lot: 'T218',
      vehicle_id: 'veh-jolly',
      source_url: 'https://bringatrailer.com/listing/1972-fiat-500-jolly',
      created_at: '2026-10-16T10:45:00Z',
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
  expect(d.rows.map((r) => r.source)).toEqual(['bat', 'mecum', 'cars-and-bids', 'craigslist', 'avant-garde-collection', 'beverlyhillscarclub']);
  expect(d.rows[0]).toMatchObject({ held: 252399, population: 264746, live: 1265, heldBefore: 251000, sales12: 39173, landed15m: 6, landed1h: 18 });
  expect(d.rows[0].hours24).toHaveLength(24);
  expect(d.rows[0].mins60).toHaveLength(12);
  expect(d.rows[2]).toMatchObject({ population: null, months: [], live: 0, landed24: 0 });
  expect(d.rows[1]).toMatchObject({ landed24: 151435, landed7: 151435 });
  expect(d.rows[1].days14).toHaveLength(14);
  expect(d.rows[4]).toMatchObject({ category: 'dealer', held: 3246, live: 26, logoUrl: '/source-logos/avant-garde-collection.png', businessType: 'dealer' });
  expect(d.rows[5]).toMatchObject({ category: 'dealer', held: 1968, live: 657, logoUrl: '/source-logos/beverlyhillscarclub.png', businessType: 'dealer' });
  expect(d.notRanked).toEqual({ 'capture channels': 2, aggregator: 2, shop: 1 });
  // a reordered payload decodes the same
  const order = [...columns].reverse();
  const reordered = { ...value, columns: order, rows: value.rows.map((r) => order.map((c) => r[columns.indexOf(c)])) };
  expect(parseSources(reordered)!.rows.map((r) => [r.source, r.held])).toEqual(d.rows.map((r) => [r.source, r.held]));
  expect(parseSources(null)).toBeNull();
  expect(parseSources([value])).toBeNull();
  expect(parseSources({ ...value, columns: ['name'] })).toBeNull();
  expect(parseSourceLanding(batLandingDetail)?.recent[0]).toMatchObject({
    year: 1991,
    make: 'Acura',
    model: 'NSX 5-Speed',
    vin: 'JH4NA1150MT001234',
    mileage: 38200,
    recordDate: '2026-10-23T18:00:00Z',
    price: 42500,
  });
  const nowRef = Date.parse('2026-10-17T21:00:00Z');
  expect(describeRecordDate('2026-10-24T21:00:00Z', nowRef)).toMatchObject({ dateText: 'Oct 24, 2026', ageText: 'ends +7d', kind: 'live' });
  expect(describeRecordDate('2026-10-17T20:00:00Z', nowRef)).toMatchObject({ dateText: 'Oct 17, 2026', ageText: 'today', kind: 'fresh' });
  expect(describeRecordDate('2023-06-22 15:00:00+00', nowRef)).toMatchObject({ dateText: 'Jun 22, 2023', ageText: '3.3y old', kind: 'backfill' });
  expect(describeRecordDate(null, nowRef)).toMatchObject({ dateText: 'no date', ageText: 'missing', kind: 'missing' });
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

it('ranks auction houses, marketplaces, and dealers apart, same row for each, as the reader orders them', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard />));
  expect(fixture.rpc).toHaveBeenCalledWith('market_sources_read');
  const groups = [...container.querySelectorAll('.market-sources__group')];
  expect(groups.map((g) => g.querySelector('.market-sources__group-title')?.textContent)).toEqual(['Auction houses', 'Marketplaces', 'Dealers']);
  expect(groups.map((g) => [...g.querySelectorAll('.market-sources__name-text')].map((n) => n.textContent))).toEqual(
    [['Bring a Trailer', 'Mecum Auctions', 'Cars & Bids'], ['Craigslist'], ['Avant-Garde Collection', 'Beverly Hills Car Club']]);
  expect(groups.map((g) => [...g.querySelectorAll('.market-sources__badge')].map((b) => b.textContent))).toEqual([
    ['AUCTION HOUSE', 'AUCTION HOUSE', 'AUCTION HOUSE'],
    ['MARKETPLACE'],
    ['DEALER / CONSIGNOR', 'DEALER / CONSIGNOR'],
  ]);
  expect(groups[1].querySelector('.market-sources__rank')?.textContent).toBe('1');
  expect(groups[2].querySelector('.market-sources__rank')?.textContent).toBe('1');
  expect(groups[0].querySelector('.market-sources__name img')?.getAttribute('src')).toBe('https://example.test/bat.png');
  expect(groups[2].querySelector('.market-sources__name img')?.getAttribute('src')).toBe('/source-logos/avant-garde-collection.png');
  expect(groups[2].querySelectorAll('.market-sources__name')[1].querySelector('img')?.getAttribute('src')).toBe('/source-logos/beverlyhillscarclub.png');
  expect(groups[0].querySelectorAll('.market-sources__name')[1].querySelector('img')).toBeNull();   // no recorded logo: the type icon
  expect(groups[0].querySelectorAll('.market-sources__name')[1].querySelector('svg')).not.toBeNull();
  expect(groups[1].querySelector('.market-sources__cols .n')?.textContent).toBe('listings held');
  expect(groups[2].querySelector('.market-sources__cols .n')?.textContent).toBe('vehicles held');
  const rows = [...container.querySelectorAll('li.market-sources__row')];
  expect(rows.every((r) => r.children.length === 7)).toBe(true);
  expect(rows[0].querySelector('.market-sources__held')?.textContent).toBe('252,399 +1,399 since Oct 9');
  expect(rows[0].querySelector('.market-sources__sharetext')?.textContent).toBe('95% of 264,746');
  expect(rows[0].querySelector('.market-sources__live')?.textContent).toBe('1,265 live');
  expect(rows[4].querySelector('.market-sources__live')?.textContent).toBe('26 live');
  expect(rows[0].querySelectorAll('.market-sources__spark rect')).toHaveLength(24);
  expect(rows[1].querySelector('.market-sources__live')?.textContent).toBe('—');
  expect(rows[2].querySelector('.market-sources__unknown')).not.toBeNull();
  expect(rows[2].querySelector('.market-sources__sharetext')?.textContent).toBe('their total unknown');
  expect(rows[1].querySelector('.market-sources__landtext')?.textContent).toBe('+151,435 today');
  expect(rows[1].querySelectorAll('.market-sources__days rect')).toHaveLength(14);
  expect(rows[2].querySelector('.market-sources__landtext')?.textContent).toBe('idle since Oct 3');
  expect(rows[2].querySelector('.market-sources__landing i.off')).not.toBeNull();
  expect(container.querySelector('.market-sources__foot .market-sources__note')?.textContent)
    .toBe('not ranked: 2 capture channels, 2 aggregators, 1 shop');
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
  expect(drill.textContent).toContain('Y·M·M 1/2');
  expect(drill.textContent).toContain('1991');
  expect(drill.textContent).toContain('Acura');
  expect(drill.textContent).toContain('NSX 5-Speed');
  expect(drill.textContent).toContain('JH4NA1150MT001234');
  expect(drill.textContent).toContain('$42,500');
  expect(drill.textContent).toContain('Jun 22, 2023');
  expect(drill.querySelector('.market-sources__event-make.is-missing')?.textContent).toBe('missing');
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

it('renders DEALER / CONSIGNOR category badges for category="dealer" or business_type="dealer" and filters/inspects by category', async () => {
  expect(resolveSourceCategory({ category: 'dealer', businessType: null })).toBe('dealer');
  expect(resolveSourceCategory({ category: null, businessType: 'dealer' })).toBe('dealer');
  expect(resolveSourceCategory({ category: 'auction', businessType: null })).toBe('auction');
  expect(resolveSourceCategory({ category: 'marketplace', businessType: null })).toBe('marketplace');
  expect(categoryBadgeLabel({ category: 'dealer', businessType: null })).toBe('DEALER / CONSIGNOR');
  expect(categoryBadgeLabel({ category: null, businessType: 'dealer' })).toBe('DEALER / CONSIGNOR');
  expect(categoryBadgeLabel({ category: 'auction', businessType: 'auction_house' })).toBe('AUCTION HOUSE');
  expect(categoryBadgeLabel({ category: 'marketplace', businessType: null })).toBe('MARKETPLACE');

  // Include a dealer row where category is null and business_type is 'dealer'
  const withBusinessTypeDealer = {
    ...value,
    rows: [
      ...value.rows.slice(0, 5),
      ['beverlyhillscarclub', 'Beverly Hills Car Club', null, null, 1968, '2026-10-16T10:27:00Z', null, null, null,
        null, 1358, 150000, 1355, null, null, null, [['2026-10', 1355, 150000]], 657, '2026-10-16T10:45:00Z',
        1968, '2026-10-09', 0, 0, null, days(0), 'https://nuke.ag/source-logos/beverlyhillscarclub.png', 'dealer'],
    ],
  };

  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: withBusinessTypeDealer, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: { ...batLandingDetail, source: 'avant-garde-collection' }, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });

  await act(async () => root.render(<SourcesBoard />));

  const filterButtons = [...container.querySelectorAll('.market-sources__cat-pill')] as HTMLButtonElement[];
  expect(filterButtons.map((b) => b.textContent)).toEqual(['ALL', 'AUCTION HOUSE', 'MARKETPLACE', 'DEALER / CONSIGNOR']);

  // Click DEALER / CONSIGNOR filter pill
  const dealerFilterBtn = filterButtons.find((b) => b.textContent === 'DEALER / CONSIGNOR')!;
  await act(async () => { dealerFilterBtn.click(); });

  const visibleGroups = [...container.querySelectorAll('.market-sources__group')];
  expect(visibleGroups).toHaveLength(1);
  expect(visibleGroups[0].querySelector('.market-sources__group-title')?.textContent).toBe('Dealers');
  const visibleRows = [...visibleGroups[0].querySelectorAll('li.market-sources__row')];
  expect(visibleRows).toHaveLength(2);
  expect(visibleRows.map((r) => r.querySelector('.market-sources__name-text')?.textContent)).toEqual([
    'Avant-Garde Collection',
    'Beverly Hills Car Club',
  ]);
  expect(visibleRows.map((r) => r.querySelector('.market-sources__badge')?.textContent)).toEqual([
    'DEALER / CONSIGNOR',
    'DEALER / CONSIGNOR',
  ]);

  // Open the ingestion inspector on a dealer row and verify the DEALER / CONSIGNOR badge, Organization Profile link, and consignment breakdown in the inspector
  expect(visibleRows.map((r) => r.querySelector('.market-sources__org-link')?.getAttribute('href'))).toEqual([
    '/organization/avant-garde-collection',
    '/organization/beverlyhillscarclub',
  ]);
  expect(visibleRows.map((r) => r.querySelector('.market-sources__org-link')?.textContent)).toEqual([
    'Organization Profile →',
    'Organization Profile →',
  ]);
  const dealerLandBtn = visibleRows[0].querySelector('button.market-sources__landing') as HTMLButtonElement;
  await act(async () => { dealerLandBtn.click(); });
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', { p_source: 'avant-garde-collection' });
  const drill = container.querySelector('.market-sources__drill')!;
  expect(drill.querySelector('.market-sources__badge--dealer')?.textContent).toBe('DEALER / CONSIGNOR');
  expect(drill.querySelector('.market-sources__org-link')?.getAttribute('href')).toBe('/organization/avant-garde-collection');
  expect(drill.querySelector('.market-sources__org-link')?.textContent).toBe('Organization Profile →');
  const dealerCtx = drill.querySelector('.market-sources__dealer-context')!;
  expect(dealerCtx).not.toBeNull();
  expect(dealerCtx.querySelector('.market-sources__dealer-context-label')?.textContent).toBe('INVENTORY & CONSIGNMENT BREAKDOWN');
  expect(dealerCtx.querySelector('.market-sources__dealer-context-mode')?.textContent).toBe('Auction consignment (2/2 recent lots)');
  expect(dealerCtx.querySelector('.market-sources__dealer-context-summary')?.textContent)
    .toBe('3,246 vehicles held · 26 live · 322 sales (12m) · $43.9M · 2 consigned · 0 direct in stream');
  expect(dealerCtx.querySelector('.market-sources__dealer-split-text')?.textContent)
    .toBe('2 consigned (100%) · 0 direct (0%)');
});

it('renders Organization Profile link and headquarters city/state badge in dealer-context when present in row metadata', async () => {
  expect(resolveDealerProfileHref({ source: 'avant-garde-collection', category: 'dealer', businessType: 'dealer' }))
    .toBe('/organization/avant-garde-collection');
  expect(resolveDealerProfileHref({
    source: 'avant-garde-collection',
    category: 'dealer',
    businessType: 'dealer',
    organizationId: '25937788-215a-4d3a-aca7-ea13fdfd9876',
  })).toBe('/organization/25937788-215a-4d3a-aca7-ea13fdfd9876');
  expect(resolveDealerProfileHref({ source: 'bat', category: 'auction', businessType: 'auction_house' })).toBeNull();
  expect(formatDealerHqBadge({ hqCity: 'Portland', hqState: 'OR' })).toBe('Portland, OR');
  expect(formatDealerHqBadge({ hqLocation: 'Beverly Hills, CA' })).toBe('Beverly Hills, CA');
  expect(formatDealerHqBadge({})).toBeNull();

  const colsWithMeta = [...columns, 'organization_id', 'hq_city', 'hq_state'];
  const dealerMetaPayload = {
    ...value,
    columns: colsWithMeta,
    rows: [
      ['avant-garde-collection', 'Avant-Garde Collection', 'dealer', null, 3246, '2026-10-16T10:27:00Z', null, null, null,
        null, 1641, 164210000, 322, 43880000, 390, 35000000, [['2026-10', 34, 3100000]], 26, '2026-10-16T10:45:00Z',
        3159, '2026-10-09', 3, 87, '2026-10-16T09:00:00Z', days(3), 'https://nuke.ag/source-logos/avant-garde-collection.png', 'dealer',
        '25937788-215a-4d3a-aca7-ea13fdfd9876', 'Portland', 'OR'],
    ],
  };

  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: dealerMetaPayload, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: { ...batLandingDetail, source: 'avant-garde-collection' }, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });

  await act(async () => root.render(<SourcesBoard />));

  const dealerRow = container.querySelector('li.market-sources__row')!;
  const rowOrgLink = dealerRow.querySelector('a.market-sources__org-link') as HTMLAnchorElement;
  expect(rowOrgLink).not.toBeNull();
  expect(rowOrgLink.textContent).toBe('Organization Profile →');
  expect(rowOrgLink.getAttribute('href')).toBe('/organization/25937788-215a-4d3a-aca7-ea13fdfd9876');

  // Clicking the row opens the drill inspector with HQ badge and Organization Profile link
  await act(async () => { (dealerRow as HTMLLIElement).click(); });
  const drill = container.querySelector('.market-sources__drill')!;
  expect(drill.querySelector('a.market-sources__org-link')?.getAttribute('href'))
    .toBe('/organization/25937788-215a-4d3a-aca7-ea13fdfd9876');
  const hqBadge = drill.querySelector('.market-sources__dealer-context .market-sources__dealer-hq');
  expect(hqBadge?.textContent).toBe('Portland, OR');
});

it('computes consigned vs. direct breakdown for mixed, direct-only, and empty-stream dealer rows', () => {
  const mixed = describeDealerConsignment(
    { held: 1200, live: 45, mapSales: 800, sales12: 210, usd12: 18500000 },
    [
      { eventType: 'auction', eventStatus: 'sold', reserve: 'no_reserve', bidCount: 22 },
      { eventType: 'listing', eventStatus: 'active', reserve: null, bidCount: null },
      { eventType: 'listing', eventStatus: 'active', reserve: null, bidCount: 0 },
      { eventType: 'consignment', eventStatus: 'active', reserve: 'reserve', bidCount: 5 },
    ],
  );
  expect(mixed).toMatchObject({
    consignedCount: 2,
    directCount: 2,
    totalRecent: 4,
    consignedPct: 50,
    directPct: 50,
    modeLabel: 'Mixed · 50% consigned / 50% direct',
    summaryText: '1,200 vehicles held · 45 live · 210 sales (12m) · $18.5M · 2 consigned · 2 direct in stream',
  });

  const directOnly = describeDealerConsignment(
    { held: 1968, live: 657, mapSales: 0, sales12: 0, usd12: null },
    [
      { eventType: 'listing', eventStatus: 'active', reserve: null, bidCount: null },
    ],
  );
  expect(directOnly).toMatchObject({
    consignedCount: 0,
    directCount: 1,
    consignedPct: 0,
    directPct: 100,
    modeLabel: 'Direct dealer listings (1/1 recent listings)',
    summaryText: '1,968 vehicles held · 657 live · 0 consigned · 1 direct in stream',
  });

  const emptyStream = describeDealerConsignment(
    { held: 500, live: 30, mapSales: 120, sales12: 0, usd12: null },
    [],
  );
  expect(emptyStream).toMatchObject({
    consignedCount: 0,
    directCount: 0,
    consignedPct: null,
    directPct: null,
    modeLabel: 'Consignment & direct showroom',
    summaryText: '500 vehicles held · 30 live · 120 confirmed sales',
  });
});

it('renders high-confidence Regime 1/2 census rows for all 7 audited sources and drills into vehicles & stats on row click', async () => {
  const auditedValue = {
    ...value,
    rows: [
      ['rm_sothebys', "RM Sotheby's", 'auction', "RM Sotheby's", 43573, '2026-10-17T10:27:00Z',
        55740, 'search_index', 0.9, '2026-10-17T22:00:00Z', 30678, 9162000000, 3294, 980000000, 3100, 890000000,
        [['2026-09', 260, 75000000], ['2026-10', 180, 52000000]], 5, '2026-10-17T06:00:00Z', 43200, '2026-10-10',
        12, 85, '2026-10-17T08:00:00Z', [0, 2, 0, 5, 0, 10, 0, 8, 12, 6, 4, 9, 17, 12],
        'https://nuke.ag/source-logos/rm-sothebys.png', 'auction_house'],
      ['bonhams', 'Bonhams', 'auction', 'Bonhams', 32292, '2026-10-17T10:27:00Z',
        34101, 'search_index', 0.88, '2026-10-17T22:00:00Z', 17325, 2930000000, 835, 145000000, 790, 132000000,
        [['2026-09', 70, 12000000], ['2026-10', 65, 11000000]], 33, '2026-10-17T06:00:00Z', 32100, '2026-10-10',
        8, 44, '2026-10-17T07:30:00Z', [1, 2, 3, 4, 2, 1, 5, 3, 2, 4, 6, 3, 0, 8],
        'https://nuke.ag/source-logos/bonhams.png', 'auction_house'],
      ['gooding', 'Gooding & Company', 'auction', 'Gooding & Company', 6611, '2026-10-17T10:27:00Z',
        9600, 'sitemap', 0.88, '2026-10-17T22:00:00Z', 5120, 2410000000, 412, 215000000, 395, 198000000,
        [['2026-08', 180, 108000000], ['2026-10', 45, 22000000]], 0, null, 6590, '2026-10-10',
        3, 21, '2026-10-17T05:00:00Z', [0, 0, 1, 2, 0, 3, 1, 4, 2, 1, 2, 2, 0, 3],
        'https://nuke.ag/source-logos/gooding.png', 'auction_house'],
      ['collecting_cars', 'Collecting Cars', 'auction', 'Collecting Cars', 8922, '2026-10-17T10:27:00Z',
        20578, 'search_index', 0.95, '2026-10-17T22:00:00Z', 8065, 608000000, 1890, 142000000, 1750, 131000000,
        [['2026-09', 155, 11800000], ['2026-10', 160, 12400000]], 183, '2026-10-17T08:00:00Z', 8840, '2026-10-10',
        19, 112, '2026-10-17T08:10:00Z', [5, 8, 6, 9, 7, 10, 8, 12, 9, 11, 8, 14, 15, 19],
        'https://nuke.ag/source-logos/collecting-cars.png', 'auction_house'],
      ['pcarmarket', 'PCarMarket', 'auction', 'PCarMarket', 4111, '2026-10-17T10:27:00Z',
        19446, 'sitemap', 0.88, '2026-10-17T22:00:00Z', 3304, 255700000, 620, 48000000, 580, 44000000,
        [['2026-09', 52, 4100000], ['2026-10', 48, 3900000]], 22, '2026-10-17T08:00:00Z', 4080, '2026-10-10',
        7, 38, '2026-10-17T07:50:00Z', [2, 3, 1, 4, 2, 3, 5, 2, 4, 3, 2, 5, 4, 7],
        'https://nuke.ag/source-logos/pcarmarket.png', 'auction_house'],
      ['hemmings', 'Hemmings', 'marketplace', 'Hemmings', 9906, '2026-10-17T10:27:00Z',
        36496, 'search_index', 0.85, '2026-10-17T22:00:00Z', 991, 42100000, 310, 14200000, 285, 12900000,
        [['2026-09', 28, 1200000], ['2026-10', 24, 1100000]], 42, '2026-10-17T08:00:00Z', 9850, '2026-10-10',
        14, 92, '2026-10-17T08:05:00Z', [4, 6, 5, 7, 8, 6, 9, 5, 7, 8, 6, 10, 11, 14],
        'https://nuke.ag/source-logos/hemmings.png', 'marketplace'],
      ['classic-com', 'Classic.com', 'marketplace', null, 110566, '2026-10-17T10:27:00Z',
        1054187, 'search_index', 0.92, '2026-10-17T22:00:00Z', 16562, 1480000000, 4120, 380000000, 3890, 355000000,
        [['2026-09', 340, 31000000], ['2026-10', 360, 33000000]], 0, null, 109800, '2026-10-10',
        64, 410, '2026-10-17T08:12:00Z', [20, 25, 30, 28, 35, 40, 32, 29, 38, 42, 36, 45, 50, 64],
        'https://nuke.ag/source-logos/classic-com.png', 'marketplace'],
    ],
  };

  fixture.rpc.mockImplementation((fn: string, params?: { p_source?: string }) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: auditedValue, error: null });
    if (fn === 'market_source_landing_read') {
      return Promise.resolve({
        data: {
          ...batLandingDetail,
          source: params?.p_source ?? 'rm_sothebys',
          stats: {
            source: params?.p_source ?? 'rm_sothebys',
            name: "RM Sotheby's",
            category: 'auction',
            house: "RM Sotheby's",
            held_lots: 43573,
            population: 55740,
            population_method: 'search_index',
            population_confidence: 0.9,
            coverage_share: 0.7817,
            map_sales: 30678,
            map_usd: 9162000000,
            sales_12m: 3294,
            usd_12m: 980000000,
          },
          recent: [
            {
              id: 'ev-rms-1',
              source: 'rm_sothebys',
              event_type: 'auction_result',
              event_status: 'sold',
              price: 1655000,
              year: 1967,
              make: 'Ferrari',
              model: '275 GTB/4',
              trim: 'by Scaglietti',
              vin: '10453',
              mileage: 14200,
              record_date: '2026-08-15T20:00:00Z',
              title: '1967 Ferrari 275 GTB/4 by Scaglietti',
              raw_title: '1967 Ferrari 275 GTB/4 by Scaglietti',
              lot: 'R0012',
              vehicle_id: 'veh-275gtb4',
              source_url: 'https://rmsothebys.com/auctions/mo26/lots/r0012-1967-ferrari-275-gtb4/',
              created_at: '2026-10-17T08:00:00Z',
            },
          ],
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });

  await act(async () => root.render(<SourcesBoard />));
  const rows = [...container.querySelectorAll('li.market-sources__row')];
  expect(rows).toHaveLength(7);
  // None of the 7 audited sources fall back to estimated low-confidence bars
  expect(container.querySelectorAll('.market-sources__fill--est')).toHaveLength(0);
  expect(container.querySelectorAll('.market-sources__fill')).toHaveLength(7);

  // Clicking directly on the RM Sotheby's row drills cleanly into its vehicles and stats
  await act(async () => { (rows[0] as HTMLLIElement).click(); });
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', { p_source: 'rm_sothebys' });
  const drill = container.querySelector('.market-sources__drill')!;
  expect(drill).not.toBeNull();
  const statsBox = drill.querySelector('.market-sources__drill-stats')!;
  expect(statsBox).not.toBeNull();
  expect(statsBox.textContent).toContain('43,573');
  expect(statsBox.textContent).toContain('78% of about 55,740');
  expect(statsBox.textContent).toContain('30,678 · $9.2B');
  expect(drill.textContent).toContain('1967');
  expect(drill.textContent).toContain('Ferrari');
  expect(drill.textContent).toContain('275 GTB/4');
  expect(drill.textContent).toContain('$1,655,000');
  expect(drill.querySelector('a[href="/browse?source=rm_sothebys"]')).not.toBeNull();
});

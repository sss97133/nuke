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
  formatCountdown,
  formatDealerHqBadge,
  type LandingRecentEvent,
  parsePulse,
  sortDrillColumn,
  gradeText,
  heldShare,
  landingState,
  monthBars,
  money,
  parseSourceLanding,
  parseSources,
  resolveDealerProfileHref,
  resolveSourceCategory,
  scopeSourceSales,
  shortName,
} from './SourcesBoard';
import { clearFamilySalesReads } from './FamilySalesChart';

// Times print on the viewer's clock with the zone named; pin the zone so they read the same wherever the suite runs.
process.env.TZ = 'America/Los_Angeles';

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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.rpc.mockReset(); clearFamilySalesReads(); });

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
  // a labelled reference reads as an estimate with its kind and as-of day, never as a count
  expect(heldShare({ held: 3018, population: 80000, populationMethod: 'owner_reference', populationAt: '2026-10-17T21:44:00Z' }))
    .toEqual({ share: 3018 / 80000, text: '4% of ≈ 80,000', reference: 'owner reference · Oct 17' });
  expect(heldShare({ held: 10, population: 900, populationMethod: 'catalogue_estimate', populationAt: null }).reference)
    .toBe('catalogue estimate');
  expect(gradeText({ reference: 95000, referenceMethod: 'estimate', referenceAt: '2026-01-28T01:09:27Z', census: 270391,
    censusAt: '2026-10-17T21:30:00Z', error: -0.6487 })).toBe('earlier estimate 95,000 (Jan 28) was 65% low');
  expect(gradeText(null)).toBe('');
  expect(money(8488000000)).toBe('$8.5B');
  expect(money(575000000)).toBe('$575M');
  expect(money(null)).toBe('');
});

it('reports arrivals without claiming that a collector stopped, across 14d / 24h / 1h horizons', () => {
  expect(landingState({ landed24: 151435, lastLanded: '2026-10-16T10:00:00Z' })).toEqual({ active: true, text: '+151,435 today' });
  expect(landingState({ landed24: 2055, landed1h: 18, lastLanded: '2026-10-16T10:46:00Z' }, '24h')).toEqual({ active: true, text: '+18/hr · 2,055 24h' });
  expect(landingState({ landed24: 2055, landed1h: 18, landed15m: 6, lastLanded: '2026-10-16T10:46:00Z' }, '1h')).toEqual({ active: true, text: '+6/15m · 18 1h' });
  expect(landingState({ landed24: 0, lastLanded: '2026-10-03T14:00:00Z' })).toEqual({ active: false, text: 'last new record Oct 3' });
  expect(landingState({ landed24: 0, lastLanded: null })).toEqual({ active: false, text: 'no new records in 14d' });
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

it('keeps collection telemetry on demand while preserving source inventory, sales and live lots', async () => {
  fixture.rpc.mockResolvedValue({ data: value, error: null });
  await act(async () => root.render(<SourcesBoard />));
  expect(container.querySelector('.market-sources__landing')).toBeNull();
  expect(container.querySelector('.market-sources__live-summary')).toBeNull();
  expect(container.querySelector('.market-sources__held')?.textContent).toBe('252,399');
  expect(container.querySelector('.market-sources__recent')?.textContent).toContain('39,173');
  expect(container.querySelector('.market-sources__sharetext')?.textContent).toBe('95% of 264,746');
  const toggle = container.querySelector<HTMLButtonElement>('.market-sources__collection-toggle')!;
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.market-sources__held')?.textContent).toContain('+1,399 since Oct 9');
  expect(container.textContent).toContain('last new record Oct 3');
  expect(container.textContent).toContain('New records do not establish source-check freshness');
  await act(async () => toggle.click());
  expect(container.querySelector('.market-sources__landing')).toBeNull();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});

it('ranks auction houses, marketplaces, and dealers apart, same row for each, as the reader orders them', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard />));
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());
  expect(fixture.rpc).toHaveBeenCalledWith('market_sources_read');
  const groups = [...container.querySelectorAll('.market-sources__group')];
  expect(groups.map((g) => g.querySelector('.market-sources__group-title')?.textContent)).toEqual(['Auction houses', 'Marketplaces', 'Dealers']);
  expect(groups.map((g) => [...g.querySelectorAll('.market-sources__name-text')].map((n) => n.textContent))).toEqual(
    [['Bring a Trailer', 'Mecum Auctions', 'Cars & Bids'], ['Craigslist'], ['Avant-Garde Collection', 'Beverly Hills Car Club']]);
  expect(container.querySelectorAll('.market-sources__row .market-sources__badge')).toHaveLength(0);
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
  expect(rows[2].querySelector('.market-sources__landtext')?.textContent).toBe('last new record Oct 3');
  expect(rows[2].querySelector('.market-sources__landing i.off')).not.toBeNull();
  expect(container.querySelector('.market-sources__foot .market-sources__note')?.textContent)
    .toBe('not ranked: 2 capture channels, 2 aggregators, 1 shop');
  expect(container.querySelector('.market-sources__note')?.textContent).toContain('held counts as of Oct 16, 03:27 PDT');
});

it('switches the landing column to 24h hourly bars and 1h live bars when clicked, and opens the live hourly inspector on row click', async () => {
  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: value, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: batLandingDetail, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });
  await act(async () => root.render(<SourcesBoard />));
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());

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
  expect(drill.textContent).toContain('1991');
  expect(drill.textContent).toContain('Acura');
  expect(drill.textContent).toContain('NSX 5-Speed');
  expect(drill.textContent).toContain('JH4NA1150MT001234');
  expect(drill.textContent).toContain('$42,500');
  // the heartbeat: one line per kind, and no ingestion-quality pills, make/model/facet pills or source link-outs
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_pulse_read', { p_source: 'bat' });
  expect(drill.querySelectorAll('.market-sources__pulse-row')).toHaveLength(8);
  expect(drill.querySelector('.market-sources__schema-pills')).toBeNull();
  expect(drill.querySelector('[data-testid="drill-top-makes"]')).toBeNull();
  expect(drill.querySelector('[data-testid="drill-facet-breakdown"]')).toBeNull();
  expect(drill.querySelector('.market-sources__event-link')).toBeNull();
});

it('sorts the stream by any column header, and again to reverse', async () => {
  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: value, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: batLandingDetail, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });
  await act(async () => root.render(<SourcesBoard />));
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());
  await act(async () => { (container.querySelector('button.market-sources__landing') as HTMLButtonElement).click(); });
  const drill = container.querySelector('.market-sources__drill')!;
  const years = () => [...drill.querySelectorAll('li.market-sources__event .market-sources__event-year')].map((n) => n.textContent);
  const head = drill.querySelector('[data-testid="drill-col-year"]') as HTMLButtonElement;
  await act(async () => { head.click(); });
  expect(head.getAttribute('aria-sort')).toBe('descending');
  const desc = years();
  await act(async () => { head.click(); });
  expect(head.getAttribute('aria-sort')).toBe('ascending');
  expect(years()).toEqual([...desc].reverse());
});

it('counts down a live lot to the second and sorts soonest-ending first, ended lots after, undated last', () => {
  const now = Date.parse('2026-10-20T17:00:00Z');
  expect(formatCountdown(now + (6 * 86400 + 4 * 3600 + 12 * 60 + 9) * 1000, now).text).toBe('6d 04:12:09');
  expect(formatCountdown(now + (3 * 3600 + 12 * 60 + 9) * 1000, now).text).toBe('3:12:09');
  const soon = formatCountdown(now + 125_000, now);
  expect(soon).toEqual({ text: '2:05', live: true, soon: true });
  expect(formatCountdown(now - 3 * 86400_000, now).text).toBe('ended 3d');
  const mk = (id: string, recordDate: string | null) => ({ id, recordDate } as LandingRecentEvent);
  const sorted = sortDrillColumn(
    [mk('none', null), mk('ended', '2026-10-18T00:00:00Z'), mk('later', '2026-10-27T17:00:00Z'), mk('soon', '2026-10-20T18:00:00Z')],
    { key: 'ends', dir: 'asc' },
    now,
  );
  expect(sorted.map((e) => e.id)).toEqual(['soon', 'later', 'ended', 'none']);
});

it('reads the heartbeat reader as one series per kind and refuses a malformed one', () => {
  const kinds = { bid: Array(24).fill(1), comment: Array(24).fill(2), listing: Array(24).fill(0), backfill: Array(24).fill(3) };
  const mins = { bid: Array(12).fill(1), comment: Array(12).fill(0), listing: Array(12).fill(0), backfill: Array(12).fill(0) };
  const pulse = parsePulse({ hours24: kinds, mins60: mins, last: { bid: '2026-10-20T17:00:00Z' } });
  expect(pulse?.hours24.comment).toHaveLength(24);
  expect(pulse?.last.bid).toBe('2026-10-20T17:00:00Z');
  expect(pulse?.last.listing).toBeNull();
  expect(parsePulse(null)).toBeNull();
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

it('keeps dealer category context in the inspector and filters without repeating row badges', async () => {
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
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());

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
  expect(visibleRows.every((r) => !r.querySelector('.market-sources__badge, .market-sources__org-link'))).toBe(true);
  const dealerLandBtn = visibleRows[0].querySelector('button.market-sources__landing') as HTMLButtonElement;
  await act(async () => { dealerLandBtn.click(); });
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', { p_source: 'avant-garde-collection' });
  const drill = container.querySelector('.market-sources__drill')!;
  expect(drill.querySelector('.market-sources__badge--dealer')?.textContent).toBe('DEALER / CONSIGNOR');
  expect(drill.querySelector('.market-sources__org-link')?.getAttribute('href')).toBe('/organization/avant-garde-collection');
  expect(drill.querySelector('.market-sources__org-link')?.textContent).toBe('Full profile');
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
  expect(dealerRow.querySelector('a')).toBeNull();
  await act(async () => { (dealerRow.querySelector('button.market-sources__name') as HTMLButtonElement).click(); });
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Avant-Garde Collection');
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

it('counts the window, not the rows shown: held plus what landed since, archived captures marked and dated, the viewer\'s clock', async () => {
  const archivedDetail = {
    as_of: '2026-10-20T05:33:46Z', source: 'bat', hour: '2026-10-20T05:00:00Z', selected_hour: null,
    bucket_5m: '2026-10-20T05:30:00Z', landed_15m: 252, landed_1h: 1228, landed_24h: 17800, landed_7d: 19109,
    last_landed: '2026-10-20T05:23:50Z', hours24: hours(426), mins60: mins(81), days14: days(17800),
    stats: { source: 'bat', name: 'Bring a Trailer', held_lots: 3575, held_at: '2026-10-19T10:27:00Z', held_since: 15776 },
    window: { since: '2026-10-19T05:33:46Z', events: 18090, capped: false, sold: 3634, ended: 11931, live: 2525,
      archived: 18073, sold_priced: 3634, median_sold_price: 9216 },
    recent: [
      { id: 'a1', source: 'bat', event_type: 'listing', event_status: 'active', price: 2102, year: 1973, make: 'BMW', model: '2002',
        vin: null, mileage: 105683, record_date: '2012-01-19T22:00:09Z', title: null, raw_title: null, lot: '270894613734',
        archived: true, captured_at: '2012-01-19T22:00:09Z', created_at: '2026-10-20T05:23:44Z' },
      { id: 'a2', source: 'bat', event_type: 'listing', event_status: 'sold', price: 14999, year: 1973, make: 'Pontiac', model: 'Trans Am',
        vin: '2V87Y3N112453', mileage: 11000, record_date: '2011-12-03T18:00:00Z', title: null, raw_title: null, lot: '2V87Y3N112453',
        archived: true, captured_at: '2011-12-04T10:10:10Z', created_at: '2026-10-20T05:23:50Z' },
    ],
  };
  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: value, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: archivedDetail, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });
  await act(async () => root.render(<SourcesBoard />));
  await act(async () => { (container.querySelector('li.market-sources__row') as HTMLLIElement).click(); });
  const drill = container.querySelector('.market-sources__drill')!;

  const heldKpi = drill.querySelector('.market-sources__drill-stats .market-sources__kpi strong')!;
  expect(heldKpi.textContent).toContain('19,351');
  expect(heldKpi.textContent).toContain('3,575 measured Oct 19, 03:27 PDT + 15,776 landed since');

  // sell-through is the reader's count of the whole window, not of the rows shown
  const sell = drill.querySelector('[data-testid="drill-sellthrough"]')?.textContent ?? '';
  expect(sell).toContain('23%');
  expect(sell).toContain('3,634 sold of 15,565 concluded');
  expect(drill.querySelector('[data-testid="drill-cohort-median-sold-price"]')).toBeNull();

  const rows = [...drill.querySelectorAll('li.market-sources__event')];
  const sold = rows.find((r) => r.querySelector('.market-sources__event-status')?.textContent?.includes('sold'))!;
  const seen = rows.find((r) => !r.querySelector('.market-sources__event-status')?.textContent?.includes('sold'))!;
  expect(seen.querySelector('.market-sources__event-status')?.textContent).toContain('seen live');
  expect(seen.querySelector('.market-sources__event-status')?.textContent).not.toContain('active');
  expect(seen.querySelector('.market-sources__event-status')?.getAttribute('title')).toContain('captured this page on 2012-01-19');
  expect(sold.querySelector('.market-sources__event-status')?.textContent).toContain('sold');
});

it('prints a labelled reference as an estimate, apart from a census, and grades an earlier reference against it', async () => {
  const graded = [...columns, 'population_grade'];
  const withGrade = {
    ...value,
    columns: graded,
    rows: [
      [...value.rows[0], { reference: 95000, reference_method: 'estimate', reference_at: '2026-01-28T01:09:27Z',
        census: 264746, census_method: 'enumerated', census_at: '2026-09-27T00:00:00Z', error: -0.6412 }],
      ['ksl', 'KSL Cars', 'marketplace', null, 3018, '2026-10-16T10:27:00Z', 80000, 'owner_reference', 0.4,
        '2026-10-17T21:44:00Z', null, null, null, null, null, null, null, 0, null, null, null, 0, 0, null, days(0), null, null, null],
      [...value.rows[3], null],
    ],
  };
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: withGrade, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard />));
  const rows = [...container.querySelectorAll('li.market-sources__row')];
  const ksl = rows.find((r) => r.querySelector('.market-sources__name-text')?.textContent === 'KSL Cars')!;
  expect(ksl.querySelector('.market-sources__sharetext')?.textContent).toBe('4% of ≈ 80,000owner reference · Oct 17');
  expect(ksl.querySelector('.market-sources__sharenote')?.textContent).toBe('owner reference · Oct 17');
  expect(ksl.querySelector('.market-sources__fill--est')).not.toBeNull();
  expect(ksl.querySelector('.market-sources__share')?.getAttribute('title'))
    .toBe('≈ 80,000 · owner reference · Oct 17 · confidence 0.40 · an estimate, not a count of their listings');
  const bat = rows[0];
  expect(bat.querySelector('.market-sources__sharetext')?.textContent).toBe('95% of 264,746');
  expect(bat.querySelector('.market-sources__fill--est')).toBeNull();
  expect(bat.querySelector('.market-sources__share')?.getAttribute('title')).toContain('; earlier estimate 95,000 (Jan 28) was 64% low');
  const craigslist = rows.find((r) => r.querySelector('.market-sources__name-text')?.textContent === 'Craigslist')!;
  expect(craigslist.querySelector('.market-sources__sharetext')?.textContent).toBe('their total unknown');
  expect(craigslist.querySelector('.market-sources__unknown')).not.toBeNull();
});

it('tallies a drilled family\'s sales onto the rows by house, the last 12 months apart from the 12 before', () => {
  const d = parseSources(value)!;
  const s = scopeSourceSales(d.rows, [
    { sale_date: '2026-09-01', usd: 100000, source: 'Bring a Trailer' },
    { sale_date: '2025-06-01', usd: 90000, source: 'Bring a Trailer' },
    { sale_date: '2023-06-01', usd: 80000, source: 'Bring a Trailer' },
    { sale_date: '2026-08-14', usd: 172500, source: 'Cars & Bids' },
    { sale_date: '2026-02-01', usd: 60000, source: 'Mecum' },
    { sale_date: '2026-03-01', usd: 70000, source: 'Somewhere Else' },
    { sale_date: '2027-01-01', usd: 1, source: 'Mecum' },
  ], d.day, 'Lexus LC', 'LC');
  expect(s).toMatchObject({ label: 'Lexus LC', short: 'LC', total: 6, unattributed: 1 });
  expect(s.bySource.get('bat')).toMatchObject({ total: 3, sales12: 1, salesPrior12: 1, usd: 270000 });
  expect(s.bySource.get('cars-and-bids')).toMatchObject({ total: 1, sales12: 1, months: [['2026-08', 1, 172500]] });
  expect(s.bySource.get('mecum')).toMatchObject({ total: 1, sales12: 1 });
  expect(s.bySource.has('craigslist')).toBe(false);
});

it('scopes the board to a drilled family: ranked by its sales, the rest behind a toggle', async () => {
  const lc = [
    ['v1', '2026-09-01', 100000, 'Bring a Trailer', 2021, 'LC500'],
    ['v2', '2026-08-01', 95000, 'Bring a Trailer', 2020, 'LC500'],
    ['v3', '2026-08-14', 172500, 'Cars & Bids', 2026, 'LC 500 Convertible'],
    ['v4', '2026-07-14', 160000, 'Cars & Bids', 2025, 'LC 500 Convertible'],
    ['v5', '2026-06-14', 150000, 'Cars & Bids', 2024, 'LC 500h'],
  ];
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read' ? { data: value, error: null }
    : fn === 'treemap_family_sales' ? { data: lc, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard scope={{ make: 'Lexus', family: 'fam-lc', familyName: 'LC' }} />));
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_sales', { p_brand: 'Lexus', p_family_key: 'fam-lc', p_limit: 15000 });
  expect(container.querySelector('.market-sources__title')?.textContent).toBe('Sources · Lexus LC');
  expect(container.querySelector('.market-sources__note')?.textContent).toContain('ranked by 5 Lexus LC sales with a date, last 5 years');
  expect(container.textContent).toContain('LC sales, last 12 months');
  const names = [...container.querySelectorAll('.market-sources__name-text')].map((n) => n.textContent);
  expect(names).toEqual(['Cars & Bids', 'Bring a Trailer']);
  const more = container.querySelector('.market-sources__more') as HTMLButtonElement;
  expect(more.textContent).toBe('Show all 6 sources');
  await act(async () => more.click());
  expect(container.querySelectorAll('.market-sources__name-text').length).toBe(6);
  expect((container.querySelector('.market-sources__more') as HTMLButtonElement).textContent).toBe('Show only sources with Lexus LC sales');
});

it('keeps the all-makes board, labeled so, for a make alone', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard scope={{ make: 'Lexus' }} />));
  expect(container.querySelector('.market-sources__title')?.textContent).toBe('Sources · all makes');
  expect(fixture.rpc).not.toHaveBeenCalledWith('treemap_family_sales', expect.anything());
});

// market_sources_read (20261019050000): the same rows with species, label, counts_as_held and evidence appended, plus the
// reader's species groups in the doc's order.
const speciesOf: Record<string, [string, string, boolean]> = {
  bat: ['timed_auction', 'Timed with soft close', true],
  mecum: ['block_house', 'Block houses', true],
  'cars-and-bids': ['timed_auction', 'Timed with soft close', true],
  craigslist: ['classifieds', 'Classifieds', true],
  'avant-garde-collection': ['dealer', 'Dealer sites', true],
  beverlyhillscarclub: ['dealer', 'Dealer sites', true],
};
const craigslistEvidence = {
  examined_at: '2026-10-18',
  examined: ['listing_page_snapshots craigslist https://www.craigslist.org/view/d/spokane-1989-volkswagen-cabriolet/x'],
  seen: "Post page: 'post id: 7985432409 posted: 2026-10-17 16:14'; no bid, lot or close time.",
  doc: 'docs/ledger/theory/data-machine-cases.md §6 names it under Classifieds',
};
// 20261020201000: venue_lots, venue_slug and members appended; a dealer's BaT lots apart; private-seller cohorts and
// owner sources as two count-only groups after the aggregators.
const venueOf: Record<string, [number | null, string | null, number | null]> = {
  'avant-garde-collection': [2744, 'bat', null],
};
const speciesValue = {
  ...value,
  columns: [...columns, 'species', 'species_label', 'counts_as_held', 'species_evidence', 'venue_lots', 'venue_slug', 'members'],
  rows: [
    ...value.rows.map((r) => [...r, ...speciesOf[r[0] as string], r[0] === 'craigslist' ? craigslistEvidence : null,
      ...(venueOf[r[0] as string] ?? [null, null, null])]),
    ['barnfinds', 'Barn Finds', 'aggregator', null, 13451, '2026-10-16T10:27:00Z', null, null, null, null, null, null, null,
      null, null, null, null, 0, null, null, null, 300, 2100, '2026-10-16T09:00:00Z', days(300), null, null,
      'aggregator', 'Aggregators', false, { examined_at: '2026-10-18', examined: ['barnfinds posts'], seen: "190 of 200 posts say 'here on' another site." },
      null, null, null],
    ['bat-sellers-50-plus', 'Sellers with 50 or more BaT lots', 'seller_cohort', null, 28487, '2026-10-19T10:47:00Z', null, null,
      null, null, null, null, null, null, null, null, null, 0, null, null, null, 0, 0, null, days(0), null, null,
      'private_seller', 'Private sellers', false, null, null, 'bat', 159],
    ['bat-sellers-none', 'BaT lots with no seller recorded', 'seller_cohort', null, 230757, '2026-10-19T10:47:00Z', null, null,
      null, null, null, null, null, null, null, null, null, 0, null, null, null, 0, 0, null, days(0), null, null,
      'private_seller', 'Private sellers', false, null, null, 'bat', 0],
    ['owner-input', 'Owner input', 'owner', null, 614, '2026-10-19T21:22:00Z', null, null, null, null, null, null, null,
      null, null, null, null, 0, null, null, null, 0, 0, null, days(0), null, null,
      'owner_private', "Owner's private data", false, { examined_at: '2026-10-18', examined: ['vehicle_observations owner-input'], seen: "A signed-in owner's own entries." },
      null, null, null],
  ],
  not_ranked: { 'capture channels': 1, 'no species evidence': 1 },
  species_groups: [
    { species: 'timed_auction', label: 'Timed with soft close', unit: 'lots held', counts_as_held: true },
    { species: 'block_house', label: 'Block houses', unit: 'lots held', counts_as_held: true },
    { species: 'dealer', label: 'Dealer sites', unit: 'vehicles held', counts_as_held: true },
    { species: 'classifieds', label: 'Classifieds', unit: 'posts held', counts_as_held: true },
    { species: 'auth_walled_marketplace', label: 'Auth-walled marketplaces', unit: 'listings held', counts_as_held: true },
    { species: 'aggregator', label: 'Aggregators', unit: 'pages read, not listings held', counts_as_held: false },
    { species: 'private_seller', label: 'Private sellers', unit: 'BaT lots', counts_as_held: false },
    { species: 'owner_private', label: "Owner's private data", unit: 'vehicles', counts_as_held: false },
  ],
};

it('groups the board by species with the doc\'s names, aggregators apart, and shows each source\'s evidence', async () => {
  const d = parseSources(speciesValue)!;
  expect(d.speciesGroups?.map((g) => g.label)).toEqual(['Timed with soft close', 'Block houses', 'Dealer sites', 'Classifieds',
    'Auth-walled marketplaces', 'Aggregators', 'Private sellers', "Owner's private data"]);
  expect(d.rows.find((r) => r.source === 'avant-garde-collection')).toMatchObject({ venueLots: 2744, venueSlug: 'bat', members: null });
  expect(d.rows.find((r) => r.source === 'bat-sellers-50-plus')).toMatchObject({ species: 'private_seller', countsAsHeld: false,
    held: 28487, venueSlug: 'bat', members: 159 });
  expect(d.rows.find((r) => r.source === 'owner-input')).toMatchObject({ species: 'owner_private', countsAsHeld: false, held: 614 });
  expect(d.rows.find((r) => r.source === 'craigslist')).toMatchObject({ species: 'classifieds', speciesLabel: 'Classifieds',
    countsAsHeld: true, speciesEvidence: { examinedAt: '2026-10-18', seen: craigslistEvidence.seen } });
  expect(d.rows.find((r) => r.source === 'barnfinds')).toMatchObject({ species: 'aggregator', countsAsHeld: false });
  expect(parseSources(value)!.speciesGroups).toBeNull();

  fixture.rpc.mockImplementation((fn: string) => {
    if (fn === 'market_sources_read') return Promise.resolve({ data: speciesValue, error: null });
    if (fn === 'market_source_landing_read') return Promise.resolve({ data: { ...batLandingDetail, source: 'craigslist', recent: [] }, error: null });
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });
  await act(async () => root.render(<SourcesBoard />));
  await act(async () => (container.querySelector('.market-sources__collection-toggle') as HTMLButtonElement).click());
  const groups = [...container.querySelectorAll('.market-sources__group')];
  expect(groups.map((g) => g.querySelector('.market-sources__group-title')?.textContent)).toEqual(
    ['Timed with soft close', 'Block houses', 'Dealer sites', 'Classifieds', 'Aggregators', 'Private sellers', "Owner's private data"]);
  expect(groups.map((g) => [...g.querySelectorAll('.market-sources__name-text')].map((n) => n.textContent))).toEqual([
    ['Bring a Trailer', 'Cars & Bids'], ['Mecum Auctions'], ['Avant-Garde Collection', 'Beverly Hills Car Club'], ['Craigslist'],
    ['Barn Finds'], ['Sellers with 50 or more BaT lots', 'BaT lots with no seller recorded'], ['Owner input']]);
  // a dealer's BaT lots sit beside held, never in it; a cohort row says how many sellers it counts
  expect(groups[2].querySelector('.market-sources__held')?.textContent).toBe('3,246 +87 since Oct 9 +2,744 sold on BaT');
  expect(groups[5].querySelector('.market-sources__cols .n')?.textContent).toBe('BaT lots');
  expect([...groups[5].querySelectorAll('.market-sources__held')].map((h) => h.textContent)).toEqual(['28,487 159 sellers', '230,757']);
  expect(groups[6].querySelector('.market-sources__held')?.textContent).toBe('614');
  expect(groups[3].querySelector('.market-sources__badge')).toBeNull();
  expect(groups[3].querySelector('.market-sources__cols .n')?.textContent).toBe('posts held');
  expect(groups[4].querySelector('.market-sources__cols .n')?.textContent).toBe('pages read, not listings held');
  expect(groups[4].querySelector('.market-sources__badge--aggregator')).toBeNull();
  expect([...container.querySelectorAll('.market-sources__cat-pill')].map((b) => b.textContent)).toEqual(
    ['ALL', 'TIMED AUCTION', 'BLOCK HOUSE', 'DEALER SITE', 'CLASSIFIEDS', 'AGGREGATOR', 'PRIVATE SELLERS', 'OWNERS']);
  expect(container.querySelector('.market-sources__foot .market-sources__note')?.textContent)
    .toBe('not ranked: 1 capture channel, 1 source without species evidence');

  const classifiedsPill = [...container.querySelectorAll('.market-sources__cat-pill')].find((b) => b.textContent === 'CLASSIFIEDS') as HTMLButtonElement;
  await act(async () => classifiedsPill.click());
  expect([...container.querySelectorAll('.market-sources__group-title')].map((t) => t.textContent)).toEqual(['Classifieds']);
  const land = container.querySelector('li.market-sources__row button.market-sources__landing') as HTMLButtonElement;
  await act(async () => land.click());
  const ev = container.querySelector('.market-sources__species-evidence')!;
  expect(ev.querySelector('.market-sources__dealer-context-label')?.textContent).toBe('CLASSIFIEDS · FROM THE SOURCE ITSELF, 2026-10-18');
  expect(ev.querySelector('.market-sources__species-seen')?.textContent).toBe(craigslistEvidence.seen);
  expect(ev.querySelector('.market-sources__species-examined li')?.textContent).toBe(craigslistEvidence.examined[0]);
  expect(container.querySelector('.market-sources__drill .market-sources__kpi-label')?.textContent?.trim()).toBe('Posts held');
});

it('opens source details from its name and dismisses with Escape without navigating', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: value, error: null } : { data: batLandingDetail, error: null }));
  await act(async () => root.render(<SourcesBoard />));
  const name = container.querySelector('button.market-sources__name') as HTMLButtonElement;
  const location = window.location.href;
  expect(name.getAttribute('aria-haspopup')).toBe('dialog');
  await act(async () => name.click());
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Bring a Trailer');
  expect(name.getAttribute('aria-expanded')).toBe('true');
  expect(fixture.rpc).toHaveBeenCalledWith('market_source_landing_read', { p_source: 'bat' });
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { bubbles: false })));
  expect(container.querySelector('dialog')).toBeNull();
  expect(name.getAttribute('aria-expanded')).toBe('false');
  expect(window.location.href).toBe(location);
});

it('shows a dated source-reported active count without dividing historical holdings by it', async () => {
  const withCurrent = { ...value, current_inventory: {
    bat: { count: 67878, observed_at: '2026-10-18', url: 'https://example.test/search', method: 'search_result_count' },
  } };
  const parsed = parseSources(withCurrent)!;
  expect(heldShare(parsed.rows[0])).toEqual({ share: null, text: '67,878 current listings' });
  expect(heldShare({ ...parsed.rows[0], currentInventory: { count: 0, observedAt: '2026-10-18', url: null } }))
    .toEqual({ share: null, text: '0 current listings' });
  expect(parseSources({ ...value, current_inventory: { bat: { count: -1, method: 'search_result_count' } } })!.rows[0].currentInventory)
    .toBeUndefined();
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: withCurrent, error: null } : { data: batLandingDetail, error: null }));
  await act(async () => root.render(<SourcesBoard />));
  const row = container.querySelector('.market-sources__row')!;
  expect(row.querySelector('.market-sources__share')?.textContent).toBe('67,878 current listingsOct 18 · search results');
  expect(row.querySelector('.market-sources__track')).toBeNull();
  await act(async () => (row.querySelector('.market-sources__name') as HTMLButtonElement).click());
  expect(container.querySelector('dialog .market-sources__drill-stats')?.textContent).toContain('67,878 current listings');
  expect(container.querySelector('dialog .market-sources__drill-stats')?.textContent).not.toContain('95% of');
});

it('opens sales by house from the all-makes header, once on the page, and not on a drilled board', async () => {
  fixture.rpc.mockResolvedValue({ data: value, error: null });
  const houseMix = { rows: [{ house: 'Bring a Trailer', sales: 182868, amount: 8.4e9 }, { house: 'Mecum', sales: 68121, amount: 4.0e9 }], clock: '' };
  await act(async () => root.render(<SourcesBoard houseMix={houseMix} />));
  const mix = container.querySelectorAll('.market-sources__head .venue-mix');
  expect(mix.length).toBe(1);
  expect(mix[0].textContent).toContain('Sales by house');
  expect(mix[0].textContent).toContain('Bring a Trailer 73%');
  expect(container.querySelectorAll('.venue-mix').length).toBe(1);
  await act(async () => root.render(<SourcesBoard scope="Ford" houseMix={houseMix} />));
  expect(container.querySelector('.market-sources__title')?.textContent).toBe('Sources · all makes');
  expect(container.querySelectorAll('.venue-mix').length).toBe(1);
});

it('shows a long group\'s top ten with its own show-all, leaving the other groups as they are', async () => {
  const dealerRow = (i: number) => ['dealer-' + i, 'Dealer ' + i, 'dealer', null, 1000 - i, '2026-10-16T10:27:00Z', null, null, null,
    null, null, null, null, null, null, null, null, 0, null, null, null, 0, 0, null, days(0), null, 'dealer',
    'dealer', 'Dealer sites', true, null, i, 'bat', null];
  const long = { ...speciesValue, rows: [...speciesValue.rows, ...Array.from({ length: 12 }, (_, i) => dealerRow(i + 1))] };
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'market_sources_read'
    ? { data: long, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<SourcesBoard />));
  const dealers = [...container.querySelectorAll('.market-sources__group')]
    .find((g) => g.querySelector('.market-sources__group-title')?.textContent === 'Dealer sites')!;
  expect(dealers.querySelectorAll('li.market-sources__row').length).toBe(10);
  const more = dealers.querySelector('.market-sources__more--group') as HTMLButtonElement;
  expect(more.textContent).toBe('Show all 14 · vehicles held');
  expect(container.querySelector('.market-sources__foot .market-sources__more')?.textContent).toBe('Show all 22 sources');
  await act(async () => more.click());
  expect(dealers.querySelectorAll('li.market-sources__row').length).toBe(14);
  expect((dealers.querySelector('.market-sources__more--group') as HTMLButtonElement).textContent).toBe('Show the top 10');
  expect(container.querySelector('.market-sources__foot .market-sources__more')).toBeNull();
  expect([...container.querySelectorAll('.market-sources__group')].filter((g) => g.querySelector('.market-sources__more--group')).length).toBe(1);
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from } }));
import { assertPulseColumns, bidBucket, fetchBoard, fxNote, fxSourceName, houseName, fetchPulse, lotBidBucket, moneyIn, parseTape, recordedUsdBid, usdBid, PULSE_COLUMNS, readInventoryTaxonomy, useMarketPulse, withTapeBids } from './useMarketPulse';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('recorded bid pulse lifetime', () => {
  it('baselines the initial response, expires the pulse, and does not replay an unchanged read', async () => {
    vi.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const row = (bid: number) => ['fixture', 1995, 'Ford', 'Mustang', bid, '2026-10-20T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, false, 'https://bringatrailer.com/listing/fixture/'];
    let latest: ReturnType<typeof useMarketPulse>;
    function Probe() { latest = useMarketPulse(); return <span>{[...latest.risenIds].join(',')}</span>; }
    fixture.rpc.mockResolvedValue({ data: { auctions: [row(100)] }, error: null });
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('');
      fixture.rpc.mockResolvedValue({ data: { auctions: [row(200)] }, error: null });
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('fixture');
      await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
      expect(container.textContent).toBe('');
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('');
    } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
  });
});

describe('live bids from the stream', () => {
  it('reads each tape bid and drops malformed ones', () => {
    const at = '2026-10-15T19:00:00Z';
    expect(parseTape({ bids: [
      { id: '1', vehicle_id: 'v', amount: 5000, bid_at: at, end_at: '2026-10-15T19:02:00Z' },
      { id: 2, vehicle_id: 'v', amount: 6000, bid_at: at },
      { id: '3', vehicle_id: 'v', amount: 0, bid_at: at },
      { id: '4', vehicle_id: 'v', amount: 7000, bid_at: 'not a time' },
    ] })).toEqual([{ id: '1', vehicleId: 'v', amount: 5000, bidAt: Date.parse(at), endAt: Date.parse('2026-10-15T19:02:00Z') }]);
    expect(parseTape(null)).toEqual([]);
    expect(parseTape({ auctions: [] })).toEqual([]);
  });

  it('lifts a lot only while a tape bid is newer than its recorded bid', () => {
    const lot = { id: 'v', house: 'bringatrailer', currency: 'USD', listingUrl: 'https://bringatrailer.com/listing/v', currentBid: 100, endsAt: 1000, updatedAt: 10 } as any;
    const best = new Map([['v', { id: '1', vehicleId: 'v', house: 'bringatrailer', currency: 'USD', sourceUrl: 'https://bringatrailer.com/listing/v', amount: 150, bidAt: 20, endAt: 2000 }]]);
    expect(withTapeBids([lot], best)[0]).toMatchObject({ currentBid: 150, endsAt: 2000, updatedAt: 20 });
    expect(withTapeBids([{ ...lot, currentBid: 200 }], best)[0]).toMatchObject({ currentBid: 200, endsAt: 1000 });
    expect(withTapeBids([lot], new Map())[0]).toBe(lot);
    expect(withTapeBids([{ ...lot, listingUrl: 'https://bringatrailer.com/listing/other' }], best)[0].currentBid).toBe(100);
    expect(withTapeBids([{ ...lot, currency: 'EUR' }], best)[0].currentBid).toBe(100);
    expect(withTapeBids([{ ...lot, house: 'ebay-motors' }], best)[0].currentBid).toBe(100);
  });

  it('pulses a lot once when a new bid lands, and hands the bid back when the board catches up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-15T19:00:00Z'));
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const row = (bid: number) => ['fixture', 1995, 'Ford', 'Mustang', bid, '2026-10-20T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, false, 'https://bringatrailer.com/listing/fixture/'];
    let board = 100;
    let tape: any[] = [];
    fixture.rpc.mockImplementation(async (name: string) => (name === 'live_bid_tape'
      ? { data: { receipt_version: 2, bids: tape }, error: null } : { data: { auctions: [row(board)] }, error: null }));
    let latest: ReturnType<typeof useMarketPulse>;
    function Probe() {
      latest = useMarketPulse();
      return <span>{`${latest.data?.auctions[0]?.currentBid}|${[...latest.risenIds].join(',')}|${latest.newBids.length}`}</span>;
    }
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('100||0');
      tape = [{ id: 'b1', vehicle_id: 'fixture', house: 'bringatrailer', currency: 'USD', source_url: 'https://bringatrailer.com/listing/fixture/', amount: 150, bid_at: '2026-10-15T19:00:00Z', end_at: '2026-10-21T00:00:00Z' }];
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(container.textContent).toBe('150|fixture|1');
      expect(latest!.data?.auctions[0].endsAt).toBe(Date.parse('2026-10-21T00:00:00Z'));
      await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
      expect(container.textContent).toBe('150||1');
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(container.textContent).toBe('150||1');
      board = 200;
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(latest!.data?.auctions[0].currentBid).toBe(200);
    } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
  });
});

describe('tape bids display at actual arrival', () => {
  it('shows the whole received batch immediately without simulated timing, and does not flash it again', async () => {
    vi.useFakeTimers();
    const t0 = Date.parse('2026-10-18T04:00:00Z');
    vi.setSystemTime(t0);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const row = (id: string, bid: number) => [id, 1995, 'Ford', 'Mustang', bid, '2026-10-20T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, false, `https://bringatrailer.com/listing/${id}/`];
    let board = [row('a', 100), row('b', 100)];
    let tape: any[] = [];
    fixture.rpc.mockImplementation(async (name: string) => (name === 'live_bid_tape'
      ? { data: { receipt_version: 2, bids: tape }, error: null } : { data: { auctions: board }, error: null }));
    let latest: ReturnType<typeof useMarketPulse>;
    const played: string[] = [];
    function Probe() {
      latest = useMarketPulse();
      React.useEffect(() => { for (const b of latest.newBids) played.push(`${b.vehicleId}@${Math.round((Date.now() - t0) / 1000)}`); }, [latest.newBids]);
      return <span>{[...latest.risenIds].sort().join(',')}</span>;
    }
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      // Two recent source events arrive in the same read at +75 s; both display immediately.
      tape = [{ id: 'x', vehicle_id: 'a', house: 'bringatrailer', currency: 'USD', source_url: 'https://bringatrailer.com/listing/a/', amount: 150, bid_at: at(62) }, { id: 'y', vehicle_id: 'b', house: 'bringatrailer', currency: 'USD', source_url: 'https://bringatrailer.com/listing/b/', amount: 160, bid_at: at(68) }];
      await act(async () => { await vi.advanceTimersByTimeAsync(74_999); });
      for (let s = 0; s < 10; s++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(played).toEqual(['a@75', 'b@75']);
      board = [row('a', 150), row('b', 160)];
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('');
    } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
  });
});

describe('bounded public taxonomy reader', () => {
  it('repeats public eligibility for every bounded batch and refuses partial failures', async () => {
    const queries: any[] = [];
    fixture.from.mockImplementation(() => {
      const query: any = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), is: vi.fn(), or: vi.fn(), limit: vi.fn() };
      for (const fn of Object.values(query) as any[]) fn.mockReturnValue(query);
      query.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
      queries.push(query); return query;
    });
    await readInventoryTaxonomy(Array.from({ length: 205 }, (_, i) => String(i)));
    expect(queries).toHaveLength(3);
    expect(queries.map(q => q.in.mock.calls[0][1].length)).toEqual([100, 100, 5]);
    for (const q of queries) {
      expect(q.eq).toHaveBeenCalledWith('is_public', true);
      expect(q.is).toHaveBeenCalledWith('deleted_at', null);
      expect(q.or).toHaveBeenCalledWith('listing_kind.is.null,listing_kind.neq.non_vehicle_item');
      expect(q.limit).toHaveBeenCalledWith(100);
    }
    fixture.from.mockImplementationOnce(() => {
      const query = queries[0]; query.then = (resolve: any) => Promise.resolve({ data: null, error: new Error('reader unavailable') }).then(resolve); return query;
    });
    await expect(readInventoryTaxonomy(['a'])).rejects.toThrow('reader unavailable');
  });
});

describe('a v3 payload carries the verdict and the track record', () => {
  const row = ['lot-1', 1973, 'Porsche', '911', 650000, '2026-10-14T17:05:00Z', '2026-10-13T23:00:00Z', '2026-10-07T00:00:00Z',
    null, true, 'https://bringatrailer.com/listing/lot-1/', '1973 Porsche 911', 478000, 552000, 700000, 'd', 15,
    { ratio: 1.595485, state: 'hot', typical_now: 407400.1, share: 0.738043, hours_left: 18.08 }];
  it('reads slot 17 as the verdict from the read, and the thresholds and backtest rows', async () => {
    fixture.rpc.mockResolvedValue({ data: { v: 3, auctions: [row],
      thresholds: { hot: 1.25, cold: 0.8, max_hours: 120 },
      backtest: [{ horizon_hours: 120, label: '5 days', hot_above: 0.784, cold_below: 0.781, n_hot: null, n_cold: null, run_at: '2026-09-28T00:00:00+00:00', population: '10,065 BaT lots', lots_sold: 10065, source: 'scripts/market/live-bands.sql' }] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions[0].serverHeat).toEqual({ ratio: 1.595485, state: 'hot', typicalNow: 407400.1, share: 0.738043, hoursLeft: 18.08 });
    expect(pulse.thresholds).toEqual({ hot: 1.25, cold: 0.8, maxHours: 120 });
    expect(pulse.backtest).toEqual([{ horizonHours: 120, label: '5 days', hotAbove: 0.784, coldBelow: 0.781, nHot: null, nCold: null, runAt: '2026-09-28T00:00:00+00:00', population: '10,065 BaT lots', lotsSold: 10065, source: 'scripts/market/live-bands.sql' }]);
  });
  it('reads no verdict from a null slot, an older row, or a malformed one', async () => {
    fixture.rpc.mockResolvedValue({ data: { v: 3, auctions: [[...row.slice(0, 17), null], row.slice(0, 17), [...row.slice(0, 17), { state: 'warm' }]] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions.map((a) => a.serverHeat)).toEqual([null, null, null]);
    expect(pulse.thresholds).toBeNull(); expect(pulse.backtest).toBeNull();
  });
});

describe('the payload names its slots', () => {
  const row = ['lot-1', 1973, 'Porsche', '911', 650000, '2026-10-14T17:05:00Z', '2026-10-13T23:00:00Z', '2026-10-07T00:00:00Z',
    null, true, 'https://bringatrailer.com/listing/lot-1/', '1973 Porsche 911', 478000, 552000, 700000, 'd', 15];
  it('decodes a v2 payload whose columns are the ones it reads by position', async () => {
    fixture.rpc.mockResolvedValue({ data: { v: 2, columns: [...PULSE_COLUMNS], auctions: [row] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions).toHaveLength(1);
    expect(pulse.auctions[0]).toMatchObject({ id: 'lot-1', year: 1973, currentBid: 650000, noReserve: true, band: { p50: 552000, tier: 'd', comps: 15 } });
  });
  it('refuses a payload whose slots moved, instead of reading a bid as a year', async () => {
    const moved = [...PULSE_COLUMNS]; moved.splice(4, 0, 'reserve_met'); moved.pop();
    fixture.rpc.mockResolvedValue({ data: { v: 3, columns: moved, auctions: [row] }, error: null });
    await expect(fetchPulse()).rejects.toThrow(/names its slots \[id, year, make, model, reserve_met, current_bid/);
    expect(() => assertPulseColumns(PULSE_COLUMNS.slice(0, 16))).toThrow(/this reader expects/);
    expect(() => assertPulseColumns([...PULSE_COLUMNS, 'heat'])).not.toThrow(); // appended slots are fine
  });
  it('still decodes a v1 payload that names nothing', async () => {
    fixture.rpc.mockResolvedValue({ data: { auctions: [row] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions[0].currentBid).toBe(650000);
    expect(() => assertPulseColumns(undefined)).not.toThrow();
  });
});

describe('every house on one board', () => {
  const bat = ['bat-1', 1995, 'Ford', 'Mustang', 30000, '2026-10-20T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, false, 'https://bringatrailer.com/listing/bat-1/'];
  const cc = ['cc-1', 1994, 'Porsche', '911', 44694, '2026-10-19T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, true,
    'https://collectingcars.com/for-sale/a', '1994 Porsche 911', 'collecting-cars', 'gbp'];
  const board = (houses: unknown) => fixture.rpc.mockImplementation(async (name: string) => name === 'market_pulse_live_houses'
    ? houses : { data: { auctions: [bat] }, error: null });

  it('puts the houses beside BaT in close order, each lot with its house and an upper-case currency; BaT reads USD', async () => {
    board({ data: { auctions: [cc], houses: [{ house: 'collecting-cars', lots: 1, read_at: '2026-10-10T00:00:00Z', on_board: true },
      { house: 'cars-and-bids', lots: 9, read_at: '2026-10-08T00:00:00Z', on_board: false }] }, error: null });
    const b = await fetchBoard();
    expect(b.auctions.map(a => [a.id, a.house, a.currency])).toEqual([['cc-1', 'collecting-cars', 'GBP'], ['bat-1', 'bringatrailer', 'USD']]);
    expect(b.auctions[0]).toMatchObject({ band: null, serverHeat: null, noReserve: true, title: '1994 Porsche 911', make: 'PORSCHE' });
    expect(b.houses.map(h => [h.house, h.onBoard])).toEqual([['bringatrailer', true], ['collecting-cars', true], ['cars-and-bids', false]]);
    expect(b.housesFailed).toBe(false);
  });
  it('names a house by the label its row sends, with no edit here', async () => {
    board({ data: { auctions: [], houses: [{ house: 'new-house', label: 'New House Auctions', lots: 2, read_at: null, on_board: true }] }, error: null });
    await fetchBoard();
    expect(houseName('new-house')).toBe('New House Auctions');
    expect(houseName('new-house', true)).toBe('New House Auctions');
    expect(houseName('bringatrailer', true)).toBe('BaT');
    expect(houseName('never-sent')).toBe('never-sent');
  });
  it("keeps BaT's board and says so when the other houses cannot be read", async () => {
    board({ data: null, error: new Error('boom') });
    const b = await fetchBoard();
    expect(b.auctions.map(a => a.id)).toEqual(['bat-1']);
    expect(b.housesFailed).toBe(true);
    expect(b.houses).toEqual([]);
  });
  it('adds only dollars without a rate: a foreign bid with no published rate is never a dollar amount, and is its own range', () => {
    expect(usdBid({ currentBid: 100, currency: 'USD' })).toBe(100);
    expect(usdBid({ currentBid: 100, currency: 'GBP' })).toBeNull();
    expect(usdBid({ currentBid: null, currency: 'USD' })).toBeNull();
    expect(bidBucket(44694, 'GBP')).toBe('otherCurrency');
    expect(bidBucket(null, 'GBP')).toBe('unknown');
    expect(bidBucket(44694)).toBe('25k50k');
  });
  const gbpRate = { currency: 'GBP', rate: 1.338488281, rateDate: '2026-11-06', source: 'ECB euro foreign exchange reference rates 2026-11-06',
    sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml' };
  it('converts a foreign bid at its own rate, and never at a rate for another currency', () => {
    expect(usdBid({ currentBid: 44694, currency: 'GBP', fx: gbpRate })).toBe(59822);
    expect(usdBid({ currentBid: 44694, currency: 'EUR', fx: gbpRate })).toBeNull();
    expect(usdBid({ currentBid: null, currency: 'GBP', fx: gbpRate })).toBeNull();
    expect(recordedUsdBid({ currentBid: 44694, currency: 'GBP' })).toBeNull();
    expect(lotBidBucket({ currentBid: 44694, currency: 'GBP', fx: gbpRate })).toBe('50k100k');
    expect(lotBidBucket({ currentBid: 44694, currency: 'GBP' })).toBe('otherCurrency');
    expect(fxNote({ currentBid: 44694, currency: 'GBP', fx: gbpRate })).toBe('≈ $59,822 at 1.3385 USD per GBP (ECB reference rate, 2026-11-06)');
    expect(fxNote({ currentBid: 100, currency: 'USD' })).toBeNull();
    expect(fxSourceName({ source: 'Bank of England database series XUDLUSS', sourceUrl: 'https://www.bankofengland.co.uk/x' })).toBe('Bank of England');
    expect(fxSourceName({ source: 'some table', sourceUrl: null })).toBe('some table');
  });
  it("reads one rate per foreign currency at the board's read date and attaches it to that currency's lots only", async () => {
    const asked: unknown[] = [];
    fixture.rpc.mockImplementation(async (name: string, args: { p_currency?: string; p_on?: string }) => {
      if (name === 'market_pulse_live_houses') return { data: { auctions: [cc, [...cc.slice(0, 13), 'nzd'].map((v, i) => i === 0 ? 'cc-2' : v)], houses: [] }, error: null };
      if (name === 'fx_usd_rate') {
        asked.push(args);
        return args.p_currency === 'GBP'
          ? { data: [{ rate: 1.338488281, rate_date: '2026-11-06', source: gbpRate.source, source_url: gbpRate.sourceUrl }], error: null }
          : { data: [], error: null };
      }
      return { data: { synced_at: '2026-11-08T16:00:00Z', auctions: [bat] }, error: null };
    });
    const b = await fetchBoard();
    expect(asked).toEqual([{ p_currency: 'GBP', p_on: '2026-11-08' }, { p_currency: 'NZD', p_on: '2026-11-08' }]);
    const byId = Object.fromEntries(b.auctions.map(a => [a.id, a]));
    expect(byId['cc-1'].fx).toEqual(gbpRate);
    expect(usdBid(byId['cc-1'])).toBe(59822);
    expect(byId['cc-2'].fx).toBeUndefined();
    expect(usdBid(byId['cc-2'])).toBeNull();
    expect(byId['bat-1'].fx).toBeUndefined();
  });
  it('writes a bid in its own currency', () => {
    expect(moneyIn(65000, 'USD')).toBe('$65,000');
    expect(moneyIn(44694, 'GBP')).toBe('£44,694');
    expect(moneyIn(292500, 'EUR')).toBe('€292,500');
    expect(moneyIn(50000, 'AUD')).toBe('A$50,000');
    expect(moneyIn(null, 'EUR')).toBe('—');
    expect(moneyIn(1_200_000, 'USD', true)).toBe('$1.2M');
  });
});

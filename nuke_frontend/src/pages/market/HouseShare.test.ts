import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));

import { basisNote, convertedBasis, fetchHouseShare, houseWeekChange, shareOnBasis, totalSeries, type HouseShareData } from './HouseShare';
import type { LiveAuction } from './useMarketPulse';

const DAY = 86_400_000;
const t0 = Date.parse('2026-11-08T17:00:00Z');
const gbp = { currency: 'GBP', rate: 1.338488281, rateDate: '2026-11-06', source: 'ECB', sourceUrl: 'https://www.ecb.europa.eu/x' };
const lot = (house: string, currency: string, currentBid: number, fx?: typeof gbp) => ({ house, currency, currentBid, fx }) as unknown as LiveAuction;

const share = (convertedFirstAt: number | null): HouseShareData => ({
  firstAt: t0 - 20 * DAY, convertedFirstAt, firstAtByHouse: {},
  points: [
    { at: t0 - 20 * DAY, house: 'collecting-cars', bidUsd: 400_000, lots: 200, lotsWithBid: 190, bidUsdConverted: null },
    { at: t0, house: 'collecting-cars', bidUsd: 480_000, lots: 218, lotsWithBid: 200, bidUsdConverted: 12_000_000 },
  ],
  weekAgo: { 'collecting-cars': { at: t0 - 7 * DAY, bidUsd: 450_000, lots: 210, lotsWithBid: 195, bidUsdConverted: null } },
});

describe('house history basis', () => {
  it('reads converted dollars and the first converted reading from live_board_share, and null on older payloads', async () => {
    fixture.rpc.mockResolvedValue({ data: { first_at: '2026-10-20T23:30:00Z', converted_first_at: '2026-11-08T17:15:00Z', first_at_by_house: {},
      points: [['2026-11-08T17:15:00Z', 'collecting-cars', '479750', 218, 200, '12008417'], ['2026-11-08T17:15:00Z', 'pcarmarket', 593250, 23, 17]],
      week_ago: { pcarmarket: { at: '2026-11-01T17:15:00Z', bid_usd: 500000, lots: 20, lots_with_bid: 15 } } }, error: null });
    const d = await fetchHouseShare();
    expect(d.convertedFirstAt).toBe(Date.parse('2026-11-08T17:15:00Z'));
    expect(d.points.map(p => p.bidUsdConverted)).toEqual([12_008_417, null]);
    expect(d.weekAgo.pcarmarket.bidUsdConverted).toBeNull();
  });
  it('stays on dollar-denominated bids until converted readings hold a week, and says from which day they start', () => {
    const d = share(t0);
    expect(convertedBasis(d, t0 + 6 * DAY)).toBe(false);
    const b = shareOnBasis(d, t0 + 6 * DAY);
    expect(b.converted).toBe(false);
    expect(totalSeries(b.data!.points, 'bids').map(p => p.v)).toEqual([400_000, 480_000]);
    expect(b.bidOf(lot('collecting-cars', 'GBP', 44_694, gbp))).toBe(0);
    expect(b.bidOf(lot('pcarmarket', 'USD', 10_000))).toBe(10_000);
    expect(basisNote(false, t0)).toContain('Converted readings start Nov 8, 2026; the history switches to them once they hold a week.');
    expect(basisNote(false, null)).not.toContain('Converted readings start');
  });
  it('switches to converted dollars after a week, leaving out readings without them rather than mixing units', () => {
    const d = share(t0 - 7 * DAY);
    d.weekAgo['collecting-cars'].bidUsdConverted = 9_000_000;
    const b = shareOnBasis(d, t0);
    expect(b.converted).toBe(true);
    expect(totalSeries(b.data!.points, 'bids').map(p => p.v)).toEqual([12_000_000]);
    expect(b.bidOf(lot('collecting-cars', 'GBP', 44_694, gbp))).toBe(59_822);
    expect(houseWeekChange('collecting-cars', 12_000_000, 'bids', b.data)).toBeCloseTo(33.33, 1);
    expect(basisNote(true, t0 - 7 * DAY)).toContain('converted readings start Nov 1, 2026');
  });
  it('keeps every reading for lot counts', () => {
    const b = shareOnBasis(share(t0 - 7 * DAY), t0, 'lots');
    expect(b.converted).toBe(false);
    expect(totalSeries(b.data!.points, 'lots').map(p => p.v)).toEqual([200, 218]);
  });
});

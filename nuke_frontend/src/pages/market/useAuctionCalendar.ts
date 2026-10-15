import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// auction_calendar_read (migration 20261015050000): scheduled auction sales from today to the horizon, built from the
// lots each house has listed (vehicle_events 'upcoming' or 'pending'), with their population; with a house and sale key,
// that sale's roster by run day and each lot's earlier results on any venue. Run days are days: no clock below a day.
export const HORIZON_DAYS = 200;
const ROSTER_PAGE = 100;

export type RunDay = { day: string; lots: number };
export type CalendarSale = {
  house: string; sale_key: string; sale_name: string; location: string | null;
  starts_on: string; ends_on: string; lots: number; seen_before: number; no_reserve: number;
  first_seen_at: string | null; first_seen_7d: number; updated_at: string | null; run_days: RunDay[];
};
export type PriorResult = {
  house: string; on: string | null; outcome: string; amount: number | null; currency: string | null;
  basis: 'source' | 'unconfirmed'; url: string | null;
};
export type RosterLot = {
  event_id: string; vehicle_id: string; source_url: string | null; lot_number: string | null; run_on: string;
  year: number | null; make: string | null; model: string | null; image: string | null; vin_present: boolean;
  has_reserve: boolean | null; estimate_low: number | null; estimate_high: number | null; currency: string | null;
  first_seen_at: string | null; prior: PriorResult[];
};
export type CalendarPopulation = {
  lots: number; sales: number; houses: number; seen_before: number; no_reserve: number; first_seen_7d: number;
  updated_at: string | null;
};
export type AuctionCalendar = {
  as_of: string; horizon_days: number; population: CalendarPopulation; sales: CalendarSale[];
  roster: { house: string; sale_key: string; lots: number; offset: number; rows: RosterLot[] } | null;
};

const HOUSE_NAMES: Record<string, string> = {
  mecum: 'Mecum', gooding: 'Gooding & Co', 'barrett-jackson': 'Barrett-Jackson', barrettjackson: 'Barrett-Jackson',
  'rm-sothebys': "RM Sotheby's", bonhams: 'Bonhams', broad_arrow: 'Broad Arrow', 'broad-arrow': 'Broad Arrow',
  bat: 'Bring a Trailer', cars_and_bids: 'Cars & Bids', pcarmarket: 'PCarMarket', collecting_cars: 'Collecting Cars',
};
export const houseName = (house: string) => HOUSE_NAMES[house] ?? house;

const HOUSE_HOSTS: Record<string, string> = {
  mecum: 'mecum.com', gooding: 'goodingco.com', 'barrett-jackson': 'barrett-jackson.com', barrettjackson: 'barrett-jackson.com',
  'rm-sothebys': 'rmsothebys.com', bonhams: 'bonhams.com', broad_arrow: 'broadarrowauctions.com', 'broad-arrow': 'broadarrowauctions.com',
  bat: 'bringatrailer.com', cars_and_bids: 'carsandbids.com', pcarmarket: 'pcarmarket.com', collecting_cars: 'collectingcars.com',
};
/** The house's own page for a lot, only when the URL is plain https on that house's host. */
export function houseLink(house: string, value: string | null): string | null {
  try {
    const url = new URL(value ?? ''), host = HOUSE_HOSTS[house];
    if (!host || url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url.hostname === host || url.hostname.endsWith('.' + host) ? url.href : null;
  } catch { return null; }
}

/** Whole days from the viewer's today to a calendar day (YYYY-MM-DD), by local calendar dates. */
export function daysUntil(day: string, now: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const today = new Date(now);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
}

/** A sale's timer at day precision: before, during and after its days. */
export function saleTimer(startsOn: string, endsOn: string, now: number): string {
  const toStart = daysUntil(startsOn, now), toEnd = daysUntil(endsOn, now);
  if (toEnd < 0) return 'ended';
  if (toStart <= 0) {
    const total = toEnd - toStart + 1, today = 1 - toStart;
    return total > 1 ? `running · day ${today} of ${total}` : 'running today';
  }
  return toStart === 1 ? 'tomorrow' : `in ${toStart} days`;
}

/** How long ago the data was last written: minutes, then hours, then days. Never a full timestamp. */
export function updatedAgo(at: string | null | undefined, now: number): string {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 'update time unrecorded';
  const min = Math.max(Math.floor((now - t) / 60_000), 0);
  if (min < 1) return 'updated just now';
  if (min < 60) return `updated ${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `updated ${h} h ago` : `updated ${Math.floor(h / 24)} days ago`;
}

/** A lot's timer: its run day, at day precision. */
export function runTimer(day: string, now: number): string {
  const n = daysUntil(day, now);
  return n < 0 ? 'ran' : n === 0 ? 'runs today' : n === 1 ? 'runs tomorrow' : `runs in ${n} days`;
}

export async function readAuctionCalendar(sale: { house: string; key: string } | null, offset = 0, signal?: AbortSignal): Promise<AuctionCalendar> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const { data, error } = await supabase.rpc('auction_calendar_read', {
    p_days: HORIZON_DAYS,
    p_house: sale?.house ?? null,
    p_sale_key: sale?.key ?? null,
    p_limit: ROSTER_PAGE,
    p_offset: offset,
  }).abortSignal(requestSignal);
  if (error) throw error;
  return data as AuctionCalendar;
}

export function useAuctionCalendar() {
  return useQuery({
    queryKey: ['auction-calendar'],
    queryFn: ({ signal }) => readAuctionCalendar(null, 0, signal),
    staleTime: 5 * 60_000,
  });
}

export function useSaleRoster(sale: { house: string; key: string } | null) {
  return useInfiniteQuery({
    queryKey: ['auction-calendar-roster', sale?.house, sale?.key],
    queryFn: ({ pageParam, signal }) => readAuctionCalendar(sale, pageParam, signal),
    initialPageParam: 0,
    enabled: sale != null,
    staleTime: 5 * 60_000,
    getNextPageParam: (last, pages) => {
      const read = pages.reduce((n, page) => n + (page.roster?.rows.length ?? 0), 0);
      return last.roster && last.roster.rows.length > 0 && read < last.roster.lots ? read : undefined;
    },
  });
}

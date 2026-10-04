import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// One live auction as market_pulse_live() returns it (compact array, see
// supabase/migrations/20260927193000_market_pulse_live_board.sql).
export interface LiveAuction {
  id: string;
  year: number | null;
  make: string;
  model: string | null;
  currentBid: number | null;
  endsAt: number; // epoch ms
  updatedAt: number; // epoch ms — vehicles.updated_at, the last write to the row by any process
  listedAt: number; // epoch ms — first time Nuke saw the listing
  imageUrl: string | null;
  noReserve: boolean;
  listingUrl: string | null;
  title: string | null; // the listing's own title as BaT publishes it
  // Expected-price band from comparable BaT sales on the lot's model page (hammer_predictions, model 30;
  // scripts/market/live-bands.mjs). Null when the lot isn't priced (no confident model page or < 5 comps).
  band: { p10: number; p50: number; p90: number; tier: string; comps: number } | null;
}

// Median share of the final price that sold BaT cars had been bid at each hours-left mark, per price tier.
export type BidCurve = Record<string, [number, number][]>;

// The same board, read at an earlier moment (BAT-LIVE-BIDS index, migration 20260927210000).
export interface BoardReading {
  at: number; // epoch ms
  bids: number;
  n: number;
  byMake: Record<string, [number, number]> | null; // make -> [bids, auctions with a bid]; live readings only
  source: 'live' | 'archive' | string; // archive = rebuilt from BaT bid history (96% of auctions)
}

export interface SameHourRange {
  hourUtc: string;
  weekdayUtc: string;
  low: number;
  high: number;
  weeks: number;
  firstDay: string;
  readings: { day: string; bids: number }[]; // the same weekday and hour in each earlier week
}

export interface MarketPulse {
  syncedAt: number | null;
  source: string;
  auctions: LiveAuction[];
  weekAgo: BoardReading | null;
  sameHour: SameHourRange | null;
  curve: BidCurve | null;
}

// Lots BaT lists without a parsed make (wheel sets, replicas) are grouped under this label.
export const NO_MAKE = 'NO MAKE';

// Disjoint raw numeric ranges. Source units are unverified; missing is not zero.
export const BID_BUCKETS = [
  { id: 'under10k', label: 'Under 10,000' },
  { id: '10k25k', label: '10,000–24,999' },
  { id: '25k50k', label: '25,000–49,999' },
  { id: '50k100k', label: '50,000–99,999' },
  { id: '100kplus', label: '100,000+' },
  { id: 'unknown', label: 'Unrecorded' },
] as const;
export type BidBucket = typeof BID_BUCKETS[number]['id'];

export function bidBucket(bid: number | null): BidBucket {
  if (bid == null || !Number.isFinite(bid) || bid < 0) return 'unknown';
  if (bid < 10_000) return 'under10k';
  if (bid < 25_000) return '10k25k';
  if (bid < 50_000) return '25k50k';
  if (bid < 100_000) return '50k100k';
  return '100kplus';
}

export function currentBidDistribution(auctions: LiveAuction[]) {
  const counts = Object.fromEntries(BID_BUCKETS.map(b => [b.id, 0])) as Record<BidBucket, number>;
  const bids: number[] = [];
  for (const a of auctions) {
    const bucket = bidBucket(a.currentBid);
    counts[bucket] += 1;
    if (bucket !== 'unknown') bids.push(a.currentBid as number);
  }
  bids.sort((a, b) => a - b);
  const mid = Math.floor(bids.length / 2);
  return {
    counts, recorded: bids.length, total: bids.reduce((sum, bid) => sum + bid, 0),
    median: bids.length === 0 ? null : bids.length % 2 ? bids[mid] : (bids[mid - 1] + bids[mid]) / 2,
  };
}

type Row = [
  string, number | null, string | null, string | null, number | null, string, string, string, string | null, boolean,
  string | null, (string | null)?, (number | null)?, (number | null)?, (number | null)?, (string | null)?, (number | null)?,
];

async function fetchPulse(): Promise<MarketPulse> {
  const { data, error } = await supabase.rpc('market_pulse_live');
  if (error) throw error;
  const rows = ((data?.auctions ?? []) as Row[]);
  const wk = data?.baseline?.week_ago;
  const sh = data?.baseline?.same_hour;
  return {
    syncedAt: data?.synced_at ? Date.parse(data.synced_at) : null,
    source: data?.source ?? '',
    weekAgo: wk && wk.bids != null
      ? { at: Date.parse(wk.at), bids: Number(wk.bids), n: Number(wk.n), byMake: wk.by_make ?? null, source: wk.source ?? 'live' }
      : null,
    sameHour: sh && sh.low != null && sh.high != null && Number(sh.weeks) > 0
      ? {
          hourUtc: sh.hour_utc, weekdayUtc: sh.weekday_utc, low: Number(sh.low), high: Number(sh.high), weeks: Number(sh.weeks), firstDay: sh.first_day,
          readings: Array.isArray(sh.readings) ? sh.readings.map((r: [string, number]) => ({ day: r[0], bids: Number(r[1]) })) : [],
        }
      : null,
    auctions: rows.map((r) => ({
      id: r[0],
      year: r[1],
      make: r[2] ? r[2].toUpperCase() : NO_MAKE,
      model: r[3],
      currentBid: r[4] == null ? null : Number(r[4]),
      endsAt: Date.parse(r[5]),
      updatedAt: Date.parse(r[6]),
      listedAt: Date.parse(r[7]),
      imageUrl: r[8],
      noReserve: r[9] === true,
      listingUrl: r[10],
      title: r[11] ?? null,
      band: r[13] != null && r[12] != null && r[14] != null
        ? { p10: Number(r[12]), p50: Number(r[13]), p90: Number(r[14]), tier: String(r[15] ?? ''), comps: Number(r[16] ?? 0) }
        : null,
    })),
    curve: (data?.curve as BidCurve | undefined) ?? null,
  };
}

// One BAT-LIVE-BIDS reading at an hour (market_index_values, public read): current bids and live auctions with a
// bid across the board, and, on live readings (from 2026-09-27), the same two per make.
export interface HourReading {
  day: string; // value_date, UTC
  bids: number;
  n: number | null;
  byMake: Record<string, [number, number]> | null; // make -> [bids, auctions with a bid]
  source: string; // live | archive (rebuilt from BaT bid history, 96% of auctions)
}

const WEEK_MS = 7 * 86_400_000;

// The same UTC weekday and hour in each of the 12 weeks before today: the window market_pulse_live() uses for
// same_hour, read with every field of the reading instead of the bids alone.
async function fetchSameHour(hourUtc: string, todayUtc: string): Promise<HourReading[]> {
  const days = Array.from({ length: 12 }, (_, i) => new Date(Date.parse(todayUtc) - (i + 1) * WEEK_MS).toISOString().slice(0, 10));
  const { data, error } = await supabase
    .from('market_index_values')
    .select(`value_date, h:components_snapshot->hourly->"${hourUtc}", src:calculation_metadata->sources->>"${hourUtc}", src_all:calculation_metadata->>source, market_indexes!inner(index_code)`)
    .eq('market_indexes.index_code', 'BAT-LIVE-BIDS')
    .in('value_date', days)
    .order('value_date');
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((r) => r.h && r.h.bids != null)
    .map((r) => ({
      day: String(r.value_date),
      bids: Number(r.h.bids),
      n: r.h.n == null ? null : Number(r.h.n),
      byMake: r.h.by_make ?? null,
      source: String(r.src ?? r.src_all ?? 'live'),
    }));
}

// Re-read when the UTC hour turns; within the hour the readings don't change.
export function useSameHourReadings(hourUtc: string, todayUtc: string) {
  return useQuery({
    queryKey: ['market-same-hour', todayUtc, hourUtc],
    queryFn: () => fetchSameHour(hourUtc, todayUtc),
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

// The live sync reads BaT every 15 minutes; a one-minute poll shows a new sync within a minute of it landing.
const REFETCH_MS = 60_000;

export function useMarketPulse() {
  const query = useQuery({
    queryKey: ['market-pulse-live'],
    queryFn: fetchPulse,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS / 2,
    retry: 1,
  });

  // Bids that rose since the previous fetch. Motion on the page is driven by this set only.
  const prevBids = useRef<Map<string, number | null> | null>(null);
  const [risenIds, setRisenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const auctions = query.data?.auctions;
    if (!auctions) return;
    const next = new Map(auctions.map((a) => [a.id, a.currentBid]));
    const prev = prevBids.current;
    if (prev) {
      const risen = new Set<string>();
      for (const a of auctions) {
        const before = prev.get(a.id);
        if (before != null && a.currentBid != null && a.currentBid > before) risen.add(a.id);
      }
      setRisenIds(risen);
    }
    prevBids.current = next;
  }, [query.data]);

  return { ...query, risenIds };
}

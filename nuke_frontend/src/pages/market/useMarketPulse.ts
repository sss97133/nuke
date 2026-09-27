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

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
}

export interface MarketPulse {
  syncedAt: number | null;
  source: string;
  auctions: LiveAuction[];
}

// Lots BaT lists without a parsed make (wheel sets, replicas) are grouped under this label.
export const NO_MAKE = 'NO MAKE';

type Row = [string, number | null, string | null, string | null, number | null, string, string, string, string | null, boolean, string | null, string | null?];

async function fetchPulse(): Promise<MarketPulse> {
  const { data, error } = await supabase.rpc('market_pulse_live');
  if (error) throw error;
  const rows = ((data?.auctions ?? []) as Row[]);
  return {
    syncedAt: data?.synced_at ? Date.parse(data.synced_at) : null,
    source: data?.source ?? '',
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
    })),
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

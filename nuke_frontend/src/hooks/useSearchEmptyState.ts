import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchPulse } from '../pages/market/useMarketPulse';

export interface FeaturedVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
}

export interface MakeCount {
  make: string;
  count: number;
}

export function useSearchEmptyState(enabled: boolean) {
  const [recentVehicles, setRecentVehicles] = useState<FeaturedVehicle[]>([]);
  const [notableSales, setNotableSales] = useState<FeaturedVehicle[]>([]);
  const [topMakes, setTopMakes] = useState<MakeCount[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);

    // Lots first seen on the live board in the last day, and the highest bids on it now: one reader the
    // market page already uses, instead of ordered scans over every public vehicle (which timed out).
    const DAY = 86_400_000;
    const boardQuery = fetchPulse().then((pulse) => {
      const now = Date.now();
      const live = pulse.auctions.filter((a) => a.endsAt > now && a.imageUrl);
      const toFeatured = (a: typeof live[number]): FeaturedVehicle => ({
        id: a.id, year: a.year, make: a.make === 'NO MAKE' ? null : a.make, model: a.model, primary_image_url: a.imageUrl, sale_price: a.currentBid,
      });
      return {
        recent: live.filter((a) => now - a.listedAt < DAY).sort((a, b) => b.listedAt - a.listedAt).slice(0, 12).map(toFeatured),
        notable: live.filter((a) => a.currentBid != null).sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0)).slice(0, 8).map(toFeatured),
      };
    });

    // Makes with their true counts, from the ledger's by-brand view (public vehicles with a confirmed sale), and the
    // planner's estimate of the public total: neither walks the table, so neither can time out.
    const makesQuery = supabase.rpc('treemap_by_brand');

    // One slow or failed reader must not blank the others.
    Promise.allSettled([boardQuery, makesQuery]).then(
      ([boardRes, makesRes]) => {
        if (boardRes.status === 'fulfilled') { setRecentVehicles(boardRes.value.recent); setNotableSales(boardRes.value.notable); }
        if (makesRes.status === 'fulfilled' && Array.isArray(makesRes.value.data)) {
          const rows = makesRes.value.data as { name: string; count: number }[];
          // The same total the ledger map states: vehicles with a confirmed sale, summed over makes.
          setTotalCount(rows.reduce((sum, row) => sum + (row.count > 0 ? row.count : 0), 0));
          const sorted = rows
            .filter((row) => row.name && row.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 12)
            .map((row) => ({ make: row.name, count: row.count }));
          setTopMakes(sorted);
        }
        setLoading(false);
      }
    );
  }, [enabled]);

  return { recentVehicles, notableSales, topMakes, totalCount, loading };
}

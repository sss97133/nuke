import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { applyNonAutoFilters } from '../lib/nonAutoExclusion';

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

    const fields = 'id,year,make,model,primary_image_url,sale_price';
    const baseFilter = () =>
      applyNonAutoFilters(
        supabase
          .from('vehicles')
          .select(fields)
          .eq('is_public', true)
          .not('primary_image_url', 'is', null)
          .not('year', 'is', null)
          .not('make', 'is', null)
      );

    // Recent vehicles with images
    const recentQuery = baseFilter()
      .order('created_at', { ascending: false })
      .limit(12);

    // Notable sales — vehicles with highest prices
    const notableQuery = baseFilter()
      .not('sale_price', 'is', null)
      .gt('sale_price', 10000)
      .order('sale_price', { ascending: false })
      .limit(8);

    // Top makes by count (sample 5000 for speed)
    const makesQuery = applyNonAutoFilters(
      supabase
        .from('vehicles')
        .select('make')
        .eq('is_public', true)
        .not('make', 'is', null)
        .not('primary_image_url', 'is', null)
    ).limit(5000);

    // Total count
    const countQuery = applyNonAutoFilters(
      supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('is_public', true)
    );

    Promise.all([recentQuery, notableQuery, makesQuery, countQuery]).then(
      ([recentRes, notableRes, makesRes, countRes]) => {
        if (recentRes.data) setRecentVehicles(recentRes.data as FeaturedVehicle[]);
        if (notableRes.data) setNotableSales(notableRes.data as FeaturedVehicle[]);
        if (countRes.count != null) setTotalCount(countRes.count);

        if (makesRes.data) {
          const counts = new Map<string, number>();
          for (const row of makesRes.data as { make: string }[]) {
            const m = row.make;
            if (m) counts.set(m, (counts.get(m) || 0) + 1);
          }
          const sorted = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([make, count]) => ({ make, count }));
          setTopMakes(sorted);
        }

        setLoading(false);
      }
    );
  }, [enabled]);

  return { recentVehicles, notableSales, topMakes, totalCount, loading };
}

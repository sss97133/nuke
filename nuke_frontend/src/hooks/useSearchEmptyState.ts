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

    // Makes with their true counts, from the ledger's by-brand view (vehicles with a recorded price), and the
    // planner's estimate of the public total: neither walks the table, so neither can time out.
    const makesQuery = supabase.rpc('treemap_by_brand');
    const countQuery = supabase
      .from('vehicles')
      .select('id', { count: 'planned', head: true })
      .eq('is_public', true);

    // One slow or failed reader must not blank the others.
    Promise.allSettled([recentQuery, notableQuery, makesQuery, countQuery]).then(
      ([recentRes, notableRes, makesRes, countRes]) => {
        if (recentRes.status === 'fulfilled' && recentRes.value.data) setRecentVehicles(recentRes.value.data as FeaturedVehicle[]);
        if (notableRes.status === 'fulfilled' && notableRes.value.data) setNotableSales(notableRes.value.data as FeaturedVehicle[]);
        if (countRes.status === 'fulfilled' && countRes.value.count != null) setTotalCount(countRes.value.count);
        if (makesRes.status === 'fulfilled' && Array.isArray(makesRes.value.data)) {
          const sorted = (makesRes.value.data as { name: string; count: number }[])
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

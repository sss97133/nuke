import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

type SegmentSubcategory = {
  id: string;
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
};

type SegmentIndexRow = {
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
  manager_type: 'ai' | 'human';
  status?: 'active' | 'draft' | 'archived';
  year_min: number | null;
  year_max: number | null;
  makes: string[] | null;
  model_keywords: string[] | null;
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  subcategory_count?: number;
  subcategories?: SegmentSubcategory[];
};

export function useMarketSegments() {
  return useQuery({
    queryKey: ['market-segments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_segments_index')
        .select(
          'segment_id, slug, name, description, manager_type, status, year_min, year_max, makes, model_keywords, vehicle_count, market_cap_usd, change_7d_pct, change_30d_pct, subcategory_count, subcategories'
        )
        .order('market_cap_usd', { ascending: false });

      if (error) throw error;

      return (data || []).map((r: any) => ({
        segment_id: r.segment_id,
        slug: r.slug,
        name: r.name,
        description: r.description ?? null,
        manager_type: r.manager_type,
        status: r.status ?? undefined,
        year_min: r.year_min ?? null,
        year_max: r.year_max ?? null,
        makes: r.makes ?? null,
        model_keywords: r.model_keywords ?? null,
        vehicle_count: Number(r.vehicle_count || 0),
        market_cap_usd: Number(r.market_cap_usd || 0),
        change_7d_pct: r.change_7d_pct === null ? null : Number(r.change_7d_pct),
        change_30d_pct: r.change_30d_pct === null ? null : Number(r.change_30d_pct),
        subcategory_count: r.subcategory_count === null || r.subcategory_count === undefined ? undefined : Number(r.subcategory_count),
        subcategories: Array.isArray(r.subcategories) ? (r.subcategories as SegmentSubcategory[]) : undefined
      })) as SegmentIndexRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type { SegmentIndexRow, SegmentSubcategory };

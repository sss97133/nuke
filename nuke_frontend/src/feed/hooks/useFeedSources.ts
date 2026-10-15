import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface FeedSource {
  source_platform: string;
  label: string;
  /** vehicles.discovery_source values feed-query matches for this source. */
  discovery_sources: string[];
  n_24h: number;
}

/**
 * The sources with rows in the last 24 h, written hourly by refresh_feed_rollups() from vehicle_events.
 * Empty on any error: the sidebar then shows its fixed list.
 */
export function useFeedSources() {
  return useQuery<FeedSource[]>({
    queryKey: ['feed-sources-24h'],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feed_source_rollup')
        .select('source_platform,label,discovery_sources,n_24h')
        .gt('n_24h', 0)
        .order('n_24h', { ascending: false })
        .limit(40);
      if (error || !data) return [];
      // RM Sotheby's (and other aliased platforms) can appear under two platform keys; show each label once.
      const byLabel = new Map<string, FeedSource>();
      for (const row of data as FeedSource[]) {
        const prev = byLabel.get(row.label);
        if (prev) {
          prev.n_24h += row.n_24h;
          prev.discovery_sources = [...new Set([...prev.discovery_sources, ...row.discovery_sources])];
        } else byLabel.set(row.label, { ...row });
      }
      return [...byLabel.values()].sort((a, b) => b.n_24h - a.n_24h);
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface FeedSource {
  source_platform: string;
  label: string;
  /** vehicles.discovery_source values feed-query matches for this source. */
  discovery_sources: string[];
  n_1h: number;
  last_seen_at: string;
}

/**
 * The sources seen in vehicle_events within the last 24 h (last_seen_at), written hourly by refresh_feed_rollups() from vehicle_events.
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
        .select('source_platform,label,discovery_sources,n_1h,last_seen_at')
        .gte('last_seen_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
        .order('last_seen_at', { ascending: false })
        .limit(40);
      if (error || !data) return [];
      // RM Sotheby's (and other aliased platforms) can appear under two platform keys; show each label once.
      const byLabel = new Map<string, FeedSource>();
      for (const row of data as FeedSource[]) {
        const prev = byLabel.get(row.label);
        if (prev) {
          prev.n_1h += row.n_1h;
          prev.discovery_sources = [...new Set([...prev.discovery_sources, ...row.discovery_sources])];
        } else byLabel.set(row.label, { ...row });
      }
      return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
    },
  });
}

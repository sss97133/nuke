import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useVehicleCommentsUnified(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-comments-unified', vehicleId],
    queryFn: async () => {
      const allRows: any[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('vehicle_comments_unified')
          .select('comment_id, vehicle_id, comment_text, observed_at, author_username, comment_type, bid_amount, is_seller, platform, comment_url, external_identity_id, media_urls, auction_event_id, source_category, source_slug, user_id, is_editable')
          .eq('vehicle_id', vehicleId)
          .order('observed_at', { ascending: false })
          .range(offset, offset + batchSize - 1);

        if (error) { console.warn('Error fetching comments:', error); break; }
        if (data && data.length > 0) {
          allRows.push(...data);
          offset += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      return allRows;
    },
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
}

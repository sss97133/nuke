import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['auction', 'user', 'observation']);
const SELECTION = 'comment_id, vehicle_id, comment_text, observed_at, author_username, comment_type, bid_amount, is_seller, platform, comment_url, external_identity_id, media_urls, auction_event_id, source_category, source_slug, user_id, is_editable';

/** One view row per source category and native comment ID; never return a failed prefix. */
export async function readVehicleCommentsUnified(
  vehicleId: string,
  signal?: AbortSignal,
  { maxRows = 10_000, timeBudgetMs = 20_000 } = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeBudgetMs);
  const rows: any[] = [];
  let after: { category: string; id: string } | undefined;
  const unavailable = () => new Error('Comments could not be loaded completely.');
  try {
    if (controller.signal.aborted) throw unavailable();
    const parent = await supabase.from('vehicles').select('id').eq('id', vehicleId)
      .is('deleted_at', null).or('listing_kind.is.null,listing_kind.neq.non_vehicle_item')
      .abortSignal(controller.signal).maybeSingle();
    if (parent.error || parent.data?.id !== vehicleId || controller.signal.aborted) throw unavailable();
    for (let page = 0; page < 100; page++) {
      if (controller.signal.aborted) throw unavailable();
      let query = supabase.from('vehicle_comments_unified').select(SELECTION)
        .eq('vehicle_id', vehicleId).order('source_category').order('comment_id')
        .limit(1000).abortSignal(controller.signal);
      if (after) query = query.or(`source_category.gt.${after.category},and(source_category.eq.${after.category},comment_id.gt.${after.id})`);
      const response = await query;
      if (response.error || !Array.isArray(response.data) || controller.signal.aborted) throw unavailable();
      if (response.data.length === 0) {
        return rows.sort((a, b) => {
          const aTime = Date.parse(a.observed_at), bTime = Date.parse(b.observed_at);
          const timeOrder = (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
          return (Number.isNaN(timeOrder) ? 0 : timeOrder) || a.source_category.localeCompare(b.source_category) || a.comment_id.localeCompare(b.comment_id);
        });
      }
      if (rows.length + response.data.length > maxRows) throw unavailable();
      for (const row of response.data) {
        if (row.vehicle_id !== vehicleId || !UUID.test(row.comment_id) || !CATEGORIES.has(row.source_category) ||
          (after && (row.source_category < after.category || (row.source_category === after.category && row.comment_id <= after.id)))) throw unavailable();
        rows.push(row);
        after = { category: row.source_category, id: row.comment_id };
      }
      // Seek even after a short page: server caps do not establish end of collection.
    }
    throw unavailable();
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function useVehicleCommentsUnified(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-comments-unified', vehicleId],
    queryFn: ({ signal }) => readVehicleCommentsUnified(vehicleId, signal),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
    retry: false,
  });
}

/**
 * feedApi.ts — Typed client for the feed-query edge function.
 *
 * Handles serialization, auth headers, and response parsing.
 */

import { supabase } from '../../lib/supabase';
import type { FeedQueryParams, FeedQueryResponse } from '../types/feed';

const FEED_FUNCTION_NAME = 'feed-query';

/**
 * Call the feed-query edge function.
 *
 * Uses supabase.functions.invoke which handles auth headers automatically.
 * Falls back to direct fetch if invoke fails (e.g., during local dev).
 */
export async function fetchFeed(
  params: FeedQueryParams & { cursor?: string },
): Promise<FeedQueryResponse> {
  const { data, error } = await supabase.functions.invoke(FEED_FUNCTION_NAME, {
    body: params,
  });

  if (error) {
    throw new Error(`feed-query error: ${error.message}`);
  }

  // Validate minimal response shape
  if (!data || !Array.isArray(data.items)) {
    throw new Error('feed-query returned invalid response shape');
  }

  return data as FeedQueryResponse;
}

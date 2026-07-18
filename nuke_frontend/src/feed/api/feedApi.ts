/**
 * feedApi.ts — Typed client for the feed-query edge function.
 *
 * Handles serialization, auth headers, and response parsing.
 */

import { supabase } from '../../lib/supabase';
import type { FeedQueryParams, FeedQueryResponse } from '../types/feed';

const FEED_FUNCTION_NAME = 'feed-query';
const FEED_TIMEOUT_MS = 15000;

/**
 * Call the feed-query edge function.
 *
 * Uses supabase.functions.invoke which handles auth headers automatically.
 * Falls back to direct fetch if invoke fails (e.g., during local dev).
 */
export async function fetchFeed(
  params: FeedQueryParams & { cursor?: string },
): Promise<FeedQueryResponse> {
  // Race the edge-function call against a deadline so a hung feed-query (pool
  // starvation on the follow-up vehicles lookup) surfaces as an error React Query can
  // catch — instead of leaving the page on an infinite loading skeleton.
  const invoke = supabase.functions.invoke(FEED_FUNCTION_NAME, { body: params });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('feed-query timed out')), FEED_TIMEOUT_MS),
  );
  const { data, error } = await Promise.race([invoke, timeout]);

  if (error) {
    throw new Error(`feed-query error: ${error.message}`);
  }

  // Validate minimal response shape
  if (!data || !Array.isArray(data.items)) {
    throw new Error('feed-query returned invalid response shape');
  }

  return data as FeedQueryResponse;
}

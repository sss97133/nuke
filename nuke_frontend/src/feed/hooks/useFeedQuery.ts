/**
 * useFeedQuery — React Query infinite query for the feed.
 *
 * Wraps the feed-query edge function with @tanstack/react-query's
 * useInfiniteQuery for cursor-based pagination, caching, and deduplication.
 *
 * Usage:
 *   const { data, fetchNextPage, hasNextPage, isLoading } = useFeedQuery(params);
 *   const vehicles = data?.pages.flatMap(p => p.items) ?? [];
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchFeed } from '../api/feedApi';
import type { FeedQueryParams, FeedQueryResponse, FeedSortField } from '../types/feed';
import type { FilterState, SortBy, SortDirection } from '../../types/feedTypes';

// ---------------------------------------------------------------------------
// Map frontend filter/sort state to edge function params
// ---------------------------------------------------------------------------

interface UseFeedQueryInput {
  filters: FilterState;
  sortBy: SortBy;
  sortDirection: SortDirection;
  searchText: string;
}

/** Convert frontend filter state to API params */
function toQueryParams(input: UseFeedQueryInput): FeedQueryParams {
  const { filters, sortBy, sortDirection, searchText } = input;

  // Map SortBy to FeedSortField
  const sortMap: Record<string, FeedSortField> = {
    newest: 'newest',
    oldest: 'oldest',
    updated: 'updated',
    deal_score: 'deal_score',
    heat_score: 'heat_score',
    price_high: 'price_high',
    price_low: 'price_low',
    year: 'year',
    make: 'make',
    mileage: 'mileage',
    finds: 'find_score',
    popular: 'feed_rank',
    volume: 'feed_rank',
    images: 'feed_rank',
    events: 'feed_rank',
    views: 'feed_rank',
  };

  // Collect excluded sources
  const excluded: string[] = [...(filters.hiddenSources || [])];
  if (filters.hideCraigslist) excluded.push('craigslist');
  if (filters.hideKsl) excluded.push('ksl');
  if (filters.hideBat) excluded.push('bat');
  if (filters.hideClassic) excluded.push('classic');
  if (filters.hideDealerSites) excluded.push('dealer_sites');
  if (filters.hideDealerListings) excluded.push('dealer_listings');

  // Show dealers when user explicitly wants them or is searching
  const includeDealers = filters.dealer || undefined;

  return {
    q: searchText || undefined,
    year_min: filters.yearMin ?? undefined,
    year_max: filters.yearMax ?? undefined,
    makes: filters.makes.length > 0 ? filters.makes : undefined,
    models: filters.models.length > 0 ? filters.models : undefined,
    body_styles: filters.bodyStyles.length > 0 ? filters.bodyStyles : undefined,
    price_min: filters.priceMin ?? undefined,
    price_max: filters.priceMax ?? undefined,
    is_4x4: filters.is4x4 || undefined,
    for_sale: filters.forSale || undefined,
    sold_only: filters.showSoldOnly || undefined,
    hide_sold: filters.hideSold || undefined,
    has_images: filters.hasImages ? true : false,
    excluded_sources: excluded.length > 0 ? excluded : undefined,
    include_dealers: includeDealers,
    added_today: filters.addedTodayOnly || undefined,
    sort: sortMap[sortBy] || 'newest',
    direction: sortDirection,
    zip: filters.zipCode || undefined,
    radius_miles: filters.zipCode ? filters.radiusMiles : undefined,
    limit: 50,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFeedQuery(input: UseFeedQueryInput) {
  const params = toQueryParams(input);

  return useInfiniteQuery<FeedQueryResponse>({
    queryKey: ['feed', params],
    queryFn: ({ pageParam }) =>
      fetchFeed({ ...params, cursor: pageParam as string | undefined }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 60_000,           // 1 minute
    gcTime: 5 * 60_000,         // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

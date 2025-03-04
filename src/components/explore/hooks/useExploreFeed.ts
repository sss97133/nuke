
import { useInfiniteQuery } from '@tanstack/react-query';
import { useContentInteractions } from './feed/useContentInteractions';
import { fetchFeedContent } from './feed/contentFetcher';
import { ContentItem, FeedOptions, UseExploreFeedReturnType } from './feed/types';

export { ContentItem } from './feed/types';

export function useExploreFeed(options: FeedOptions = {}): UseExploreFeedReturnType {
  const { filter = 'all', limit = 10, includeStreams = false, searchTerm = '' } = options;
  
  // Get interaction handlers
  const { trackContentView, likeContent, shareContent, saveContent } = useContentInteractions();

  // Fetch content with infinite pagination
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error
  } = useInfiniteQuery({
    // Add searchTerm to query key to refresh on search
    queryKey: ['explore-feed', filter, includeStreams, searchTerm],
    queryFn: async ({ pageParam = 0 }) => {
      return await fetchFeedContent(pageParam, { filter, limit, includeStreams, searchTerm });
    },
    getNextPageParam: (lastPage, allPages) => {
      // If we have fewer items than the limit, there are no more pages
      return lastPage.length < limit ? undefined : allPages.length;
    },
    initialPageParam: 0,
  });

  // Flatten pages data for easier rendering
  const feedItems = data?.pages.flat() || [];

  return {
    feedItems,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    trackContentView,
    likeContent,
    shareContent,
    saveContent
  };
}

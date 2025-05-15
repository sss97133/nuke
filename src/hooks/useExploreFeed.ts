import { useInfiniteQuery, QueryKey, InfiniteData } from '@tanstack/react-query';
import { fetchFeedContent } from '@/components/explore/hooks/feed/contentFetcher'; 
import { useAuth } from '@/hooks/use-auth'; // Import useAuth with correct path
// Import the new interaction hook
import { useContentInteractions } from '@/components/explore/hooks/feed/useContentInteractions';

interface UseExploreFeedProps {
  filter: string;
  limit?: number;
  includeStreams?: boolean;
  searchTerm?: string;
}

// Define the return type for the hook
interface UseExploreFeedResult {
  feedItems: any[]; // Use any[] temporarily
  fetchNextPage: () => void;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  // Re-add the interaction handler to the interface
  handleInteraction: (contentId: string, contentType: string, interactionType: 'view' | 'like' | 'share' | 'save' | 'comment') => void;
}

export const useExploreFeed = ({ 
  filter, 
  limit = 10, 
  includeStreams = true, 
  searchTerm = ''
}: UseExploreFeedProps): UseExploreFeedResult => {
  const { user, isLoading: authLoading } = useAuth(); // Get auth state with correct property name
  // Use the new interaction hook
  const { trackInteraction, isPending: isTrackingInteraction } = useContentInteractions(); 

  const queryResult = useInfiniteQuery(
    {
      queryKey: ['exploreFeed', filter, searchTerm, includeStreams, user?.id] as QueryKey,
      queryFn: ({ pageParam = 0 }) => {
        return fetchFeedContent(
          pageParam, 
          { filter, limit, includeStreams, searchTerm } 
        );
      },
      getNextPageParam: (lastPage: any[], allPages: any[][]) => {
        const nextPage = lastPage && Array.isArray(lastPage) && lastPage.length === limit ? allPages.length : undefined;
        return nextPage;
      },
      initialPageParam: 0,
      enabled: !authLoading,
    }
  );
  
  const infiniteData = queryResult.data as InfiniteData<any[]> | undefined;
  const feedItems = infiniteData?.pages.flat() || [];

  // Define the interaction handler function
  const handleInteraction = (
    contentId: string, 
    contentType: string, 
    interactionType: 'view' | 'like' | 'share' | 'save' | 'comment'
  ) => {
    // Check if trackInteraction is a function before calling it
    if (typeof trackInteraction === 'function') {
      // Call the trackInteraction function from the useContentInteractions hook
      trackInteraction({ contentId, contentType, interactionType });
    } else {
      console.warn('trackInteraction is not available or not a function');
      // Fallback behavior - log the interaction for debugging
      console.log('Interaction tracked locally:', { contentId, contentType, interactionType });
    }
  };

  return {
    feedItems,
    fetchNextPage: queryResult.fetchNextPage,
    hasNextPage: queryResult.hasNextPage,
    isFetchingNextPage: queryResult.isFetchingNextPage,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error as Error | null,
    handleInteraction
  };
}; 

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';

export interface ContentItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image_url: string;
  tags: string[];
  reason: string;
  location: string;
  relevance_score: number;
  created_at: string;
}

interface FeedOptions {
  filter?: string;
  limit?: number;
}

export function useExploreFeed({ filter = 'all', limit = 10 }: FeedOptions = {}) {
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
    queryKey: ['explore-feed', filter],
    queryFn: async ({ pageParam = 0 }) => {
      // Build query based on filter and pagination
      let query = supabase
        .from('explore_content')
        .select('*');
      
      // Apply type filter if not 'all'
      if (filter !== 'all') {
        query = query.eq('type', filter);
      }
      
      // Apply pagination
      query = query
        .order('relevance_score', { ascending: false })
        .order('created_at', { ascending: false })
        .range(pageParam * limit, (pageParam + 1) * limit - 1);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      // Return empty array if no data found
      return data || [];
    },
    getNextPageParam: (lastPage, allPages) => {
      // If we have fewer items than the limit, there are no more pages
      return lastPage.length < limit ? undefined : allPages.length;
    },
    initialPageParam: 0,
  });

  // Track content interaction
  const { mutate: trackInteraction } = useMutation({
    mutationFn: async ({ contentId, interactionType }: { contentId: string, interactionType: 'view' | 'like' | 'share' | 'save' | 'comment' }) => {
      const { data, error } = await supabase.functions.invoke('track-content-interaction', {
        body: {
          content_id: contentId,
          interaction_type: interactionType,
        },
      });
      
      if (error) throw error;
      return data;
    },
  });

  // Flatten pages data for easier rendering
  const feedItems = data?.pages.flat() || [];

  // Method to track content view
  const trackContentView = useCallback((contentId: string) => {
    trackInteraction({ contentId, interactionType: 'view' });
  }, [trackInteraction]);

  // Method to track content like
  const likeContent = useCallback((contentId: string) => {
    trackInteraction({ contentId, interactionType: 'like' });
  }, [trackInteraction]);

  // Method to track content share
  const shareContent = useCallback((contentId: string) => {
    trackInteraction({ contentId, interactionType: 'share' });
  }, [trackInteraction]);

  // Method to track content save
  const saveContent = useCallback((contentId: string) => {
    trackInteraction({ contentId, interactionType: 'save' });
  }, [trackInteraction]);

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

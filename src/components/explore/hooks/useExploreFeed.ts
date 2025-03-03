
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';

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
  creator_id?: string;
  creator_name?: string;
  creator_avatar?: string;
  view_count?: number;
  like_count?: number;
  share_count?: number;
  save_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
}

interface FeedOptions {
  filter?: string;
  limit?: number;
}

export function useExploreFeed({ filter = 'all', limit = 10 }: FeedOptions = {}) {
  const queryClient = useQueryClient();

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
      console.log('Fetching explore feed:', { filter, pageParam, limit });
      
      try {
        // Each content type has its own table, so we need to fetch from multiple sources
        // and combine the results based on the filter
        let allContent: ContentItem[] = [];
        
        // Get current user for personalization
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        
        // Determine which tables to query based on filter
        const contentSources = filter === 'all' ? 
          ['posts', 'vehicles', 'auctions', 'streams'] : 
          filter === 'vehicle' ? ['vehicles'] :
          filter === 'auction' ? ['auctions'] :
          filter === 'event' ? ['events'] :
          filter === 'garage' ? ['garages'] :
          filter === 'article' ? ['posts'] : 
          ['posts']; // Default to posts
          
        // Query each content source
        for (const source of contentSources) {
          const { data: sourceData, error: sourceError } = await fetchContentByType(
            source,
            pageParam,
            limit,
            userId
          );
          
          if (sourceError) {
            console.error(`Error fetching ${source}:`, sourceError);
            continue; // Skip this source but continue with others
          }
          
          if (sourceData && sourceData.length > 0) {
            allContent = [...allContent, ...sourceData];
          }
        }
        
        // Sort combined content by relevance_score and created_at
        allContent.sort((a, b) => {
          // First by relevance score (descending)
          if (b.relevance_score !== a.relevance_score) {
            return b.relevance_score - a.relevance_score;
          }
          // Then by date (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        
        console.log('Combined feed data:', allContent.length);
        return allContent;
      } catch (err) {
        console.error('Error in content fetching:', err);
        throw err;
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      // If we have fewer items than the limit, there are no more pages
      return lastPage.length < limit ? undefined : allPages.length;
    },
    initialPageParam: 0,
  });

  // Helper function to fetch content by type
  const fetchContentByType = async (
    contentType: string, 
    pageParam: number, 
    limit: number,
    userId?: string
  ) => {
    const from = pageParam * limit;
    const to = from + limit - 1;
    
    // Different queries for different content types
    switch (contentType) {
      case 'posts':
        return await supabase
          .from('user_posts')
          .select(`
            id,
            title,
            subtitle,
            content,
            image_url,
            tags,
            location,
            created_at,
            creator_id:user_id,
            profiles:creator_id(full_name, avatar_url),
            content_metrics:id(view_count, like_count, share_count, save_count)
          `)
          .order('created_at', { ascending: false })
          .range(from, to);
          
      case 'vehicles':
        return await supabase
          .from('vehicles')
          .select(`
            id,
            make,
            model,
            year,
            image_url:vin_image_url,
            location,
            created_at,
            user_id,
            profiles:user_id(full_name, avatar_url),
            content_metrics:id(view_count, like_count, share_count, save_count)
          `)
          .order('created_at', { ascending: false })
          .range(from, to);
          
      case 'auctions':
        return await supabase
          .from('auctions')
          .select(`
            id,
            vehicle_id,
            starting_price,
            current_price,
            end_time,
            created_at,
            seller_id,
            profiles:seller_id(full_name, avatar_url),
            vehicles!vehicle_id(make, model, year, vin_image_url),
            content_metrics:id(view_count, like_count, share_count, save_count)
          `)
          .eq('status', 'active')
          .order('end_time', { ascending: true })
          .range(from, to);
          
      case 'streams':
        return await supabase
          .from('live_streams')
          .select(`
            id,
            title,
            description,
            stream_url,
            viewer_count,
            created_at,
            user_id,
            profiles:user_id(full_name, avatar_url),
            content_metrics:id(view_count, like_count, share_count, save_count)
          `)
          .eq('status', 'live')
          .order('viewer_count', { ascending: false })
          .range(from, to);
          
      // Add more content types as needed
          
      default:
        return { data: [], error: null };
    }
  };

  // Function to transform specific content types to the ContentItem interface
  const transformContentToFeedItem = (item: any, type: string): ContentItem => {
    switch (type) {
      case 'posts':
        return {
          id: item.id,
          type: 'article',
          title: item.title,
          subtitle: item.subtitle || '',
          image_url: item.image_url,
          tags: item.tags || [],
          reason: 'Based on your interests',
          location: item.location || 'Unknown',
          relevance_score: item.content_metrics?.relevance_score || 50,
          created_at: item.created_at,
          creator_id: item.creator_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: item.content_metrics?.view_count || 0,
          like_count: item.content_metrics?.like_count || 0,
          share_count: item.content_metrics?.share_count || 0,
          save_count: item.content_metrics?.save_count || 0
        };
        
      case 'vehicles':
        return {
          id: item.id,
          type: 'vehicle',
          title: `${item.year} ${item.make} ${item.model}`,
          subtitle: item.vin || '',
          image_url: item.image_url,
          tags: ['Vehicle', item.make, item.model],
          reason: 'Vehicle in your network',
          location: item.location || 'Unknown',
          relevance_score: item.content_metrics?.relevance_score || 50,
          created_at: item.created_at,
          creator_id: item.user_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: item.content_metrics?.view_count || 0,
          like_count: item.content_metrics?.like_count || 0,
          share_count: item.content_metrics?.share_count || 0,
          save_count: item.content_metrics?.save_count || 0
        };
        
      case 'auctions':
        return {
          id: item.id,
          type: 'auction',
          title: `${item.vehicles?.year} ${item.vehicles?.make} ${item.vehicles?.model}`,
          subtitle: `Starting at $${item.starting_price}`,
          image_url: item.vehicles?.vin_image_url,
          tags: ['Auction', item.vehicles?.make, item.vehicles?.model],
          reason: 'Active auction ending soon',
          location: 'Online Auction',
          relevance_score: item.content_metrics?.relevance_score || 70, // Auctions get higher relevance
          created_at: item.created_at,
          creator_id: item.seller_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: item.content_metrics?.view_count || 0,
          like_count: item.content_metrics?.like_count || 0,
          share_count: item.content_metrics?.share_count || 0,
          save_count: item.content_metrics?.save_count || 0
        };
        
      case 'streams':
        return {
          id: item.id,
          type: 'event',
          title: item.title,
          subtitle: `Live now with ${item.viewer_count} viewers`,
          image_url: item.thumbnail_url || 'https://via.placeholder.com/600x400?text=Live+Stream',
          tags: ['Live', 'Stream', 'Event'],
          reason: 'Live now',
          location: 'Live Stream',
          relevance_score: item.content_metrics?.relevance_score || 90, // Live streams get highest relevance
          created_at: item.created_at,
          creator_id: item.user_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: item.viewer_count || 0,
          like_count: item.content_metrics?.like_count || 0,
          share_count: item.content_metrics?.share_count || 0,
          save_count: item.content_metrics?.save_count || 0
        };
        
      default:
        return {
          id: item.id,
          type: 'article',
          title: item.title || 'Unknown content',
          subtitle: item.subtitle || '',
          image_url: item.image_url || 'https://via.placeholder.com/600x400?text=Content',
          tags: item.tags || [],
          reason: 'Recommended content',
          location: item.location || 'Unknown',
          relevance_score: item.relevance_score || 50,
          created_at: item.created_at
        };
    }
  };

  // Track content interaction with improved analytics
  const { mutate: trackInteraction } = useMutation({
    mutationFn: async ({ 
      contentId, 
      contentType,
      interactionType 
    }: { 
      contentId: string, 
      contentType: string,
      interactionType: 'view' | 'like' | 'share' | 'save' | 'comment' 
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      
      if (!userId) {
        console.warn('User not authenticated, skipping interaction tracking');
        return { success: false };
      }
      
      // Insert interaction
      const { error: interactionError } = await supabase
        .from('content_interactions')
        .insert({
          content_id: contentId,
          content_type: contentType,
          interaction_type: interactionType,
          user_id: userId
        });
      
      if (interactionError) {
        console.error('Error tracking interaction:', interactionError);
        throw interactionError;
      }
      
      // Update content metrics (aggregate counts)
      const metricsColumn = `${interactionType}_count`;
      
      const { error: metricsError } = await supabase
        .from('content_metrics')
        .upsert({
          content_id: contentId,
          content_type: contentType,
          [metricsColumn]: supabase.rpc('increment_counter', { row_id: contentId, counter_name: metricsColumn })
        })
        .select();
      
      if (metricsError) {
        console.error('Error updating metrics:', metricsError);
      }
      
      // For likes and saves, we need to track the user's specific action
      if (interactionType === 'like' || interactionType === 'save') {
        const tableName = interactionType === 'like' ? 'user_likes' : 'user_saves';
        
        const { error: userActionError } = await supabase
          .from(tableName)
          .upsert({
            user_id: userId,
            content_id: contentId,
            content_type: contentType
          });
        
        if (userActionError) {
          console.error(`Error recording user ${interactionType}:`, userActionError);
        }
      }
      
      return { success: true };
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries to update UI
      if (variables.interactionType === 'like' || variables.interactionType === 'save') {
        queryClient.invalidateQueries({ queryKey: ['explore-feed'] });
        
        // Show toast for likes and saves
        toast({
          title: variables.interactionType === 'like' ? 'Content liked!' : 'Content saved!',
          description: variables.interactionType === 'like' 
            ? 'This content has been added to your likes'
            : 'This content has been saved to your collection',
          duration: 2000
        });
      }
    }
  });

  // Flatten pages data for easier rendering
  const feedItems = data?.pages.flat() || [];

  // Method to track content view
  const trackContentView = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'view' });
  }, [trackInteraction]);

  // Method to track content like
  const likeContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'like' });
  }, [trackInteraction]);

  // Method to track content share
  const shareContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'share' });
  }, [trackInteraction]);

  // Method to track content save
  const saveContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'save' });
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

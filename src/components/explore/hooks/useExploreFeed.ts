import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';
import { twitchService } from '@/components/streaming/services/TwitchService';

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
  stream_url?: string;
}

interface FeedOptions {
  filter?: string;
  limit?: number;
  includeStreams?: boolean;
  searchTerm?: string;
}

export function useExploreFeed({ filter = 'all', limit = 10, includeStreams = false, searchTerm = '' }: FeedOptions = {}) {
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
    // Add searchTerm to query key to refresh on search
    queryKey: ['explore-feed', filter, includeStreams, searchTerm],
    queryFn: async ({ pageParam = 0 }) => {
      console.log('Fetching explore feed:', { filter, pageParam, limit, includeStreams, searchTerm });
      
      try {
        // Each content type has its own table, so we need to fetch from multiple sources
        // and combine the results based on the filter
        let allContent: ContentItem[] = [];
        
        // Get current user for personalization
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        
        // Determine which tables to query based on filter
        let contentSources = filter === 'all' ? 
          ['explore_content', 'vehicles', 'auctions', 'live_streams'] : 
          filter === 'vehicle' ? ['vehicles'] :
          filter === 'auction' ? ['auctions'] :
          filter === 'event' ? ['live_streams'] :
          filter === 'garage' ? ['garages'] :
          filter === 'article' ? ['explore_content'] : 
          ['explore_content']; // Default to posts
          
        // If including streams specifically, ensure live_streams is in the sources
        if (includeStreams && !contentSources.includes('live_streams')) {
          contentSources.push('live_streams');
        }
          
        // Query each content source
        for (const source of contentSources) {
          const { data: sourceData, error: sourceError } = await fetchContentByType(
            source,
            pageParam,
            limit,
            userId,
            searchTerm
          );
          
          if (sourceError) {
            console.error(`Error fetching ${source}:`, sourceError);
            continue; // Skip this source but continue with others
          }
          
          if (sourceData && sourceData.length > 0) {
            allContent = [...allContent, ...sourceData];
          }
        }
        
        // If including streams is enabled, fetch live Twitch streams
        if (includeStreams) {
          try {
            const twitchStreams = await fetchLiveTwitchStreams(searchTerm);
            if (twitchStreams && twitchStreams.length > 0) {
              allContent = [...allContent, ...twitchStreams];
            }
          } catch (err) {
            console.error('Error fetching Twitch streams:', err);
            // Continue with other content even if Twitch fails
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

  // New function to fetch live Twitch streams
  const fetchLiveTwitchStreams = async (searchTerm = '') => {
    try {
      // If not authenticated with Twitch, we can't fetch streams
      if (!twitchService.isAuthenticated()) {
        console.log('Not authenticated with Twitch, skipping stream fetch');
        return [];
      }
      
      // Get live streams from Twitch API
      const streams = await twitchService.getLiveStreams(searchTerm);
      
      if (!streams || streams.length === 0) {
        return [];
      }
      
      // Transform Twitch streams to ContentItem format
      return streams.map(stream => ({
        id: stream.id,
        type: 'stream',
        title: stream.title || 'Live Stream',
        subtitle: `${stream.user_name} - ${stream.viewer_count} viewers`,
        image_url: stream.thumbnail_url?.replace('{width}', '440').replace('{height}', '248') || 
                 'https://via.placeholder.com/440x248?text=Live+Stream',
        tags: ['Live', 'Stream', stream.game_name || 'Gaming'].filter(Boolean),
        reason: 'Live now',
        location: 'Twitch',
        relevance_score: 95, // High relevance for live content
        created_at: stream.started_at || new Date().toISOString(),
        creator_id: stream.user_id,
        creator_name: stream.user_name,
        creator_avatar: '', // Twitch API doesn't provide this directly
        view_count: stream.viewer_count,
        like_count: 0,
        share_count: 0,
        save_count: 0,
        stream_url: `https://twitch.tv/${stream.user_login}`
      }));
    } catch (error) {
      console.error('Error fetching Twitch streams:', error);
      return [];
    }
  };

  // Helper function to fetch content by type
  const fetchContentByType = async (
    contentType: string, 
    pageParam: number, 
    limit: number,
    userId?: string,
    searchTerm: string = ''
  ) => {
    const from = pageParam * limit;
    const to = from + limit - 1;
    
    // For search functionality
    const searchFilter = searchTerm ? 
      contentType === 'explore_content' ? `title.ilike.%${searchTerm}%,subtitle.ilike.%${searchTerm}%` : 
      contentType === 'vehicles' ? `make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%` :
      contentType === 'auctions' ? `title.ilike.%${searchTerm}%` :
      contentType === 'live_streams' ? `title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%` :
      contentType === 'garages' ? `name.ilike.%${searchTerm}%` : 
      '' : '';
    
    // Different queries for different content types
    switch (contentType) {
      case 'explore_content':
        let query = supabase
          .from('explore_content')
          .select(`
            id,
            title,
            subtitle,
            content,
            image_url,
            tags,
            location,
            created_at,
            user_id,
            profiles(full_name, avatar_url)
          `)
          .order('created_at', { ascending: false });
          
        // Apply search if provided
        if (searchTerm) {
          query = query.or(searchFilter);
        }
        
        return await query.range(from, to);
          
      case 'vehicles':
        let vehiclesQuery = supabase
          .from('vehicles')
          .select(`
            id,
            make,
            model,
            year,
            vin_image_url,
            location,
            created_at,
            user_id,
            profiles(full_name, avatar_url)
          `)
          .order('created_at', { ascending: false });
          
        // Apply search if provided
        if (searchTerm) {
          vehiclesQuery = vehiclesQuery.or(searchFilter);
        }
        
        return await vehiclesQuery.range(from, to);
          
      case 'auctions':
        let auctionsQuery = supabase
          .from('auctions')
          .select(`
            id,
            vehicle_id,
            starting_price,
            current_price,
            end_time,
            created_at,
            seller_id,
            profiles!seller_id(full_name, avatar_url),
            vehicles!vehicle_id(make, model, year, vin_image_url)
          `)
          .eq('status', 'active')
          .order('end_time', { ascending: true });
          
        // Apply search if provided
        if (searchTerm) {
          auctionsQuery = auctionsQuery.or(searchFilter);
        }
        
        return await auctionsQuery.range(from, to);
          
      case 'live_streams':
        let streamsQuery = supabase
          .from('live_streams')
          .select(`
            id,
            title,
            description,
            stream_url,
            thumbnail_url,
            viewer_count,
            created_at,
            user_id,
            profiles(full_name, avatar_url)
          `)
          .eq('status', 'live')
          .order('viewer_count', { ascending: false });
          
        // Apply search if provided
        if (searchTerm) {
          streamsQuery = streamsQuery.or(searchFilter);
        }
        
        return await streamsQuery.range(from, to);
          
      case 'garages':
        let garagesQuery = supabase
          .from('garages')
          .select(`
            id,
            name,
            address,
            contact_info,
            rating,
            created_at
          `)
          .order('rating', { ascending: false });
          
        // Apply search if provided
        if (searchTerm) {
          garagesQuery = garagesQuery.or(searchFilter);
        }
        
        return await garagesQuery.range(from, to);
          
      // Add more content types as needed
          
      default:
        return { data: [], error: null };
    }
  };

  // Function to transform specific content types to the ContentItem interface
  const transformContentToFeedItem = (item: any, type: string): ContentItem => {
    switch (type) {
      case 'explore_content':
        return {
          id: item.id,
          type: 'article',
          title: item.title,
          subtitle: item.subtitle || '',
          image_url: item.image_url,
          tags: item.tags || [],
          reason: 'Based on your interests',
          location: item.location || 'Unknown',
          relevance_score: item.relevance_score || 50,
          created_at: item.created_at,
          creator_id: item.user_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: 0,
          like_count: 0,
          share_count: 0,
          save_count: 0
        };
        
      case 'vehicles':
        return {
          id: item.id,
          type: 'vehicle',
          title: `${item.year} ${item.make} ${item.model}`,
          subtitle: item.vin || '',
          image_url: item.vin_image_url,
          tags: ['Vehicle', item.make, item.model],
          reason: 'Vehicle in your network',
          location: item.location ? JSON.stringify(item.location) : 'Unknown',
          relevance_score: 50,
          created_at: item.created_at,
          creator_id: item.user_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: 0,
          like_count: 0,
          share_count: 0,
          save_count: 0
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
          relevance_score: 70, // Auctions get higher relevance
          created_at: item.created_at,
          creator_id: item.seller_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: 0,
          like_count: 0,
          share_count: 0,
          save_count: 0
        };
        
      case 'live_streams':
        return {
          id: item.id,
          type: 'event',
          title: item.title,
          subtitle: `Live now with ${item.viewer_count} viewers`,
          image_url: item.thumbnail_url || 'https://via.placeholder.com/600x400?text=Live+Stream',
          tags: ['Live', 'Stream', 'Event'],
          reason: 'Live now',
          location: 'Live Stream',
          relevance_score: 90, // Live streams get highest relevance
          created_at: item.created_at,
          creator_id: item.user_id,
          creator_name: item.profiles?.full_name,
          creator_avatar: item.profiles?.avatar_url,
          view_count: item.viewer_count || 0,
          like_count: 0,
          share_count: 0,
          save_count: 0
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
      
      // For likes and saves, we need to track the user's specific action separately
      if (interactionType === 'like') {
        // Check if already liked
        const { data: existingLike } = await supabase
          .from('content_interactions')
          .select('id')
          .eq('content_id', contentId)
          .eq('user_id', userId)
          .eq('interaction_type', 'like')
          .single();
          
        if (!existingLike) {
          console.log('Adding new like');
        }
      }
      
      if (interactionType === 'save') {
        // Check if already saved
        const { data: existingSave } = await supabase
          .from('content_interactions')
          .select('id')
          .eq('content_id', contentId)
          .eq('user_id', userId)
          .eq('interaction_type', 'save')
          .single();
          
        if (!existingSave) {
          console.log('Adding new save');
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

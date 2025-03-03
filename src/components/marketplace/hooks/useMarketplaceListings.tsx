
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';

export interface MarketplaceListing {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  condition: string | null;
  vehicle_id: string;
  user_id: string;
  is_featured: boolean;
  views_count: number;
  location: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  metadata: any;
  imageUrl: string;
  commentCount: number;
}

interface FetchListingsOptions {
  isFeatured?: boolean;
  watchedOnly?: boolean;
  nearLocation?: { lat: number; lng: number } | null;
  radius?: number;
  searchQuery?: string;
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
}

export function useMarketplaceListings(options: FetchListingsOptions = {}) {
  const { user } = useAuth();
  
  const fetchListings = async ({ pageParam = 0 }) => {
    const limit = 12;
    const from = pageParam * limit;
    const to = from + limit - 1;
    
    try {
      // Start with the base query
      let query = supabase
        .from('marketplace_listings')
        .select(`
          *,
          vehicles:vehicle_id(vin_image_url)
        `)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false });
      
      // Apply filters
      if (options.isFeatured) {
        query = query.eq('is_featured', true);
      }
      
      if (options.searchQuery) {
        query = query.or(`title.ilike.%${options.searchQuery}%,description.ilike.%${options.searchQuery}%`);
      }
      
      if (options.condition) {
        query = query.eq('condition', options.condition);
      }
      
      if (options.minPrice !== undefined) {
        query = query.gte('price', options.minPrice);
      }
      
      if (options.maxPrice !== undefined) {
        query = query.lte('price', options.maxPrice);
      }
      
      if (options.watchedOnly && user) {
        // Get listings that the user has saved
        const { data: savedListings } = await supabase
          .from('marketplace_saved_listings')
          .select('listing_id')
          .eq('user_id', user.id);
        
        if (savedListings && savedListings.length > 0) {
          const savedIds = savedListings.map(item => item.listing_id);
          query = query.in('id', savedIds);
        } else {
          // If no saved listings, return empty array early
          return { data: [], count: 0 };
        }
      }
      
      // Apply pagination
      query = query.range(from, to);
      
      // Execute the query
      const { data: listings, error, count } = await query;
      
      if (error) {
        throw error;
      }
      
      // Get comment counts for each listing
      if (listings && listings.length > 0) {
        const listingIds = listings.map(listing => listing.id);
        
        const { data: commentCounts, error: commentsError } = await supabase
          .from('marketplace_comments')
          .select('listing_id, count')
          .in('listing_id', listingIds)
          .groupBy('listing_id');
        
        if (!commentsError && commentCounts) {
          // Create a lookup table for comment counts
          const commentCountMap = commentCounts.reduce((acc, item) => {
            acc[item.listing_id] = parseInt(item.count);
            return acc;
          }, {});
          
          // Augment the listings with comment counts and image URLs
          listings.forEach(listing => {
            listing.commentCount = commentCountMap[listing.id] || 0;
            listing.imageUrl = listing.vehicles?.vin_image_url || '/placeholder.svg';
            
            // Format location data
            if (typeof listing.location === 'object' && listing.location !== null) {
              listing.location = listing.location.name || 
                `${listing.location.city || ''}, ${listing.location.state || ''}`.trim();
            } else if (!listing.location) {
              listing.location = 'Unknown location';
            }
          });
        }
      }
      
      return { data: listings || [], count: count || 0 };
    } catch (error) {
      console.error('Error fetching marketplace listings:', error);
      throw error;
    }
  };
  
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    refetch
  } = useInfiniteQuery({
    queryKey: ['marketplace-listings', options],
    queryFn: fetchListings,
    getNextPageParam: (lastPage, allPages) => {
      const hasMore = lastPage.data.length === 12;
      return hasMore ? allPages.length : undefined;
    },
    initialPageParam: 0
  });
  
  // Listen for realtime updates to the marketplace listings
  useEffect(() => {
    const marketplaceChannel = supabase
      .channel('marketplace-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_listings' },
        (payload) => {
          console.log('Marketplace listing change:', payload);
          refetch();
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(marketplaceChannel);
    };
  }, [refetch]);
  
  const flattenedListings = data?.pages.flatMap(page => page.data) || [];
  
  return {
    listings: flattenedListings,
    error,
    isLoading: status === 'pending',
    isError: status === 'error',
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch
  };
}

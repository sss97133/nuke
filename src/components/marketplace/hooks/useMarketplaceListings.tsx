import type { Database } from '../types';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/integrations/supabase/client';

// Helper function to adapt DB results to the expected format
function adaptMarketplaceListings(dbListings: any[]) {
  return dbListings.map(listing => {
    // Parse the location field if it exists
    let locationObj = { city: '', state: '' };
    try {
      if (listing.location) {
        if (typeof listing.location === 'string') {
          // Try to parse a string like "City, State"
          const parts = listing.location.split(',');
          locationObj = {
            city: parts[0]?.trim() || '',
            state: parts[1]?.trim() || ''
          };
        } else if (typeof listing.location === 'object') {
          // Already an object
          locationObj = listing.location;
        }
      }
    } catch (e) {
      console.error('Error parsing location:', e);
    }

    return {
      id: listing.id || '',
      title: listing.title || '',
      price: listing.price || 0,
      condition: listing.condition || '',
      imageUrl: listing.image_url || listing.imageUrl || 'https://via.placeholder.com/400x300',
      location: locationObj,
      created_at: listing.created_at || new Date().toISOString(),
      views_count: listing.views_count || 0,
      commentCount: listing.comment_count || listing.commentCount || 0,
      is_featured: listing.is_featured || false,
      user_id: listing.user_id || ''
    };
  });
}

interface MarketplaceListingOptions {
  isFeatured?: boolean;
  limit?: number;
  isWatched?: boolean;
  isNearby?: boolean;
}

export const useMarketplaceListings = (options: MarketplaceListingOptions = {}) => {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [hasNextPage, setHasNextPage] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // Define reusable fetch function for React Query
  const fetchListings = async () => {
    try {
      // Reset error on each fetch attempt
      setFetchError(null);
      
      // When feature flag is off, use mock data
      console.log('Using mock marketplace data (feature flag off)');
      return filterMockData(mockListings, options, userId);
      
      /*
      // NOTE: The following code is commented out until proper database tables exist
      // When feature flag is on, try to get real data
      // Start building the query
      let query = supabase.from('marketplace_listings').select('*');
      
      if (options.isFeatured) {
        query = query.eq('is_featured', true);
      }
      
      if (options.isWatched && userId) {
        try {
          // Get watched listings first
          const { data: watchData, error: watchError } = await supabase
        .select('listing_id')
            .eq('user_id', userId);
            
          if (watchError) throw watchError;
          
          if (watchData && watchData.length > 0) {
            const watchedIds = watchData.map(w => w.listing_id);
            query = query.in('id', watchedIds);
          } else {
            // No watched listings found
            return [];
          }
        } catch (err) {
          console.error('Error fetching watched listings:', err);
          // Fall back to mock data filtering for watched
          console.log('Falling back to mock data for watched listings');
          return filterMockData(mockListings, options, userId);
        }
      }
      
      if (options.isNearby) {
        // Get user's location preference
        try {
          const { data: userData, error: userError } = await supabase
        .select('location')
            .eq('user_id', userId)
            .single();
            
          if (userError) throw userError;
          
          if (userData?.location) {
            // This would be where you'd implement location-based filtering
            // For now, we'll just limit results
            query = query.limit(5);
          }
        } catch (err) {
          console.error('Error fetching user location:', err);
          // Fall back to mock data for nearby
          console.log('Falling back to mock data for nearby listings');
          return filterMockData(mockListings, options, userId);
        }
      }
      
      if (options.limit) {
        query = query.limit(options.limit);
      } else {
        // Default limit
        query = query.limit(20);
      }
      
      // Execute the query
      const { data, error } = await query;
      
      if (error) throw error;
      
      // If data is empty, fall back to mock data
      if (!data || data.length === 0) {
        console.log('No data found in Supabase, falling back to mock data');
        return filterMockData(mockListings, options, userId);
      }
      
      // Adapt data to expected format
      return adaptMarketplaceListings(data);
      */
    } catch (err) {
      console.error('Error in useMarketplaceListings:', err);
      setFetchError(err.message || 'An error occurred fetching listings');
      
      // Fall back to mock data
      return filterMockData(mockListings, options, userId);
    }
  };
  
  // Helper function to filter mock data based on options
  const filterMockData = (listings: any[], options: MarketplaceListingOptions, userId?: string) => {
    let filteredListings = [...listings];
    
    if (options.isFeatured) {
      filteredListings = filteredListings.filter(listing => listing.is_featured);
    }
    
    if (options.isWatched && userId) {
      // For mock purposes, let's just take the first 3 listings
      filteredListings = filteredListings.slice(0, 3);
    }
    
    if (options.isNearby) {
      // For mock purposes, just return some of the listings
      filteredListings = filteredListings.slice(2, 5);
    }
    
    if (options.limit) {
      filteredListings = filteredListings.slice(0, options.limit);
    }
    
    return filteredListings;
  };
  
  const fetchNextPage = async () => {
    // In a real implementation, this would fetch the next page of results
    // For now, we'll just set hasNextPage to false
    setHasNextPage(false);
  };
  
  const { data = [], isLoading, error: queryError } = useQuery({
    queryKey: ['marketplace-listings', options, userId],
    queryFn: fetchListings,
  });
  
  // Combine errors
  const error = fetchError || queryError;
  
  return {
    listings: data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: false
  };
};

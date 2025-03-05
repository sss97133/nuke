import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/integrations/supabase/client';

// Feature flag for gradual migration
const USE_REAL_DATA = {
  marketplace: true
};

// Mock data for development - kept as fallback
const mockListings = [
  {
    id: '1',
    title: '2019 Tesla Model 3 Performance',
    price: 42000,
    condition: 'Excellent',
    imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2071&q=80',
    location: { city: 'San Francisco', state: 'CA' },
    created_at: '2023-08-10T15:00:00Z',
    views_count: 124,
    commentCount: 5,
    is_featured: true,
    user_id: 'user123'
  },
  {
    id: '2',
    title: '2018 BMW M4 Competition',
    price: 51000,
    condition: 'Very Good',
    imageUrl: 'https://images.unsplash.com/photo-1617814076229-8ca26f00945b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2072&q=80',
    location: { city: 'Los Angeles', state: 'CA' },
    created_at: '2023-08-05T12:30:00Z',
    views_count: 98,
    commentCount: 3,
    is_featured: true,
    user_id: 'user456'
  },
  {
    id: '3',
    title: '2020 Porsche 911 Carrera S',
    price: 120000,
    condition: 'Like New',
    imageUrl: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80',
    location: { city: 'Miami', state: 'FL' },
    created_at: '2023-08-01T09:15:00Z',
    views_count: 203,
    commentCount: 8,
    is_featured: false,
    user_id: 'user789'
  },
  {
    id: '4',
    title: '2017 Ford Mustang GT',
    price: 32000,
    condition: 'Good',
    imageUrl: 'https://images.unsplash.com/photo-1584345604476-8ec5e12e42dd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80',
    location: { city: 'Dallas', state: 'TX' },
    created_at: '2023-07-28T14:45:00Z',
    views_count: 156,
    commentCount: 4,
    is_featured: false,
    user_id: 'user101'
  },
  {
    id: '5',
    title: '2021 Chevrolet Corvette C8',
    price: 82000,
    condition: 'Excellent',
    imageUrl: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80',
    location: { city: 'Chicago', state: 'IL' },
    created_at: '2023-07-25T11:20:00Z',
    views_count: 178,
    commentCount: 6,
    is_featured: true,
    user_id: 'user202'
  },
  {
    id: '6',
    title: '2019 Audi RS5 Sportback',
    price: 68000,
    condition: 'Very Good',
    imageUrl: 'https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2069&q=80',
    location: { city: 'Seattle', state: 'WA' },
    created_at: '2023-07-20T16:30:00Z',
    views_count: 135,
    commentCount: 3,
    is_featured: false,
    user_id: 'user303'
  }
];

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
      
      if (!USE_REAL_DATA.marketplace) {
        // When feature flag is off, use mock data
        console.log('Using mock marketplace data (feature flag off)');
        return filterMockData(mockListings, options, userId);
      }
      
      // For now, always use mock data to avoid database reference issues
      console.log('Using mock marketplace data until database tables are created');
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
            .from('user_watched_listings')
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
            .from('user_preferences')
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

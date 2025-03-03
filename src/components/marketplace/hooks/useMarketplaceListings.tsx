
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';

// Mock data for development
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
  
  const fetchListings = async () => {
    // In a real implementation, this would be replaced with Supabase calls
    // For now we'll use mock data
    
    let filteredListings = [...mockListings];
    
    if (options.isFeatured) {
      filteredListings = filteredListings.filter(listing => listing.is_featured);
    }
    
    if (options.isWatched && userId) {
      // In a real implementation, this would filter by the user's watched listings
      // For mock purposes, let's just take 2-3 random listings
      filteredListings = filteredListings.slice(0, 3);
    }
    
    if (options.isNearby) {
      // In a real implementation, this would filter by proximity to user's location
      // For mock purposes, just return some of the listings
      filteredListings = filteredListings.slice(2, 5);
    }
    
    if (options.limit) {
      filteredListings = filteredListings.slice(0, options.limit);
    }
    
    // Return mock data for now
    return filteredListings;
  };
  
  const fetchNextPage = async () => {
    // In a real implementation, this would fetch the next page of results
    // For mock purposes, we'll just set hasNextPage to false
    setHasNextPage(false);
  };
  
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['marketplace-listings', options],
    queryFn: fetchListings,
  });
  
  return {
    listings: data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: false
  };
};

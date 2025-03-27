import type { Database } from '../types';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export interface MarketplaceListing {
  id: string;
  title: string;
  price: number;
  description: string;
  condition: string;
  created_at: string;
  updated_at: string;
  seller: {
    id: string;
    name: string;
    avatar: string;
    rating: number;
    listings_count: number;
    joinedDate: string;
  };
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    trim: string;
    type: string;
    vin: string;
    mileage: number;
    fuel_type: string;
    transmission: string;
    engine: string;
    exterior_color: string;
    interior_color: string;
  };
  location: {
    city: string;
    state: string;
    country: string;
    postal_code: string;
  };
  features: string[];
  specifications: Record<string, string | number>;
  images?: string[];
  views_count: number;
  is_featured: boolean;
  is_watched: boolean;
}

function adaptListingFromDB(data: any, userId?: string): MarketplaceListing {
  try {
    return {
      id: data.id || '',
      title: data.title || 'Untitled Listing',
      price: data.price || 0,
      description: data.description || 'No description provided',
      condition: data.condition || 'Unknown',
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || data.created_at || new Date().toISOString(),
      
      seller: {
        id: data.seller_id || data.user_id || 'unknown',
        name: data.seller_name || 'Unknown Seller',
        avatar: data.seller_avatar || 'https://via.placeholder.com/150',
        rating: data.seller_rating || 0,
        listings_count: data.seller_listings_count || 0,
        joinedDate: data.seller_joined_date || new Date().toISOString()
      },
      
      vehicle: {
        id: data.vehicle_id || data.id || '',
        make: data.make || data.vehicle_make || 'Unknown',
        model: data.model || data.vehicle_model || 'Unknown',
        year: data.year || data.vehicle_year || 0,
        trim: data.trim || data.vehicle_trim || '',
        type: data.type || data.vehicle_type || '',
        vin: data.vin || '',
        mileage: data.mileage || 0,
        fuel_type: data.fuel_type || '',
        transmission: data.transmission || '',
        engine: data.engine || '',
        exterior_color: data.exterior_color || '',
        interior_color: data.interior_color || ''
      },
      
      location: {
        city: data.city || (data.location && data.location.city) || '',
        state: data.state || (data.location && data.location.state) || '',
        country: data.country || (data.location && data.location.country) || 'USA',
        postal_code: data.postal_code || (data.location && data.location.postal_code) || ''
      },
      
      features: Array.isArray(data.features) 
        ? data.features 
        : (typeof data.features === 'string' 
          ? data.features.split(',').map((f: string) => f.trim()) 
          : []),
      
      specifications: data.specifications || {},
      
      images: Array.isArray(data.images) 
        ? data.images 
        : (data.image_url ? [data.image_url] : []),
      
      views_count: data.views_count || 0,
      is_featured: !!data.is_featured,
      is_watched: !!data.is_watched
    };
  } catch (err) {
    console.error('Error adapting DB data:', err);
    throw new Error('Failed to adapt listing data from database');
  }
}

export const useMarketplaceListing = (id: string) => {
  const { session } = useAuth();
  const userId = session?.user?.id;
  
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchListing = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch listing data from Supabase
      const { data, error: fetchError } = await supabase
        .from('marketplace_listings')
        .select(`
          *,
          seller:user_id (
            id,
            name,
            avatar_url,
            rating,
            listings_count,
            created_at
          ),
          vehicle:vehicle_id (
            id,
            make,
            model,
            year,
            trim,
            type,
            vin,
            mileage,
            fuel_type,
            transmission,
            engine,
            exterior_color,
            interior_color
          )
        `)
        .eq('id', id)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      if (!data) {
        throw new Error('Listing not found');
      }

      // Adapt the data to our interface
      const adaptedListing = adaptListingFromDB(data, userId);
      setListing(adaptedListing);
    } catch (err) {
      console.error('Error fetching listing:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch listing'));
    } finally {
      setIsLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    fetchListing();
  }, [fetchListing]);

  const toggleWatchListing = async () => {
    if (!userId || !listing) return;

    try {
      const { error: watchError } = await supabase
        .from('watched_listings')
        .upsert({
          user_id: userId,
          listing_id: listing.id,
          is_watched: !listing.is_watched
        });

      if (watchError) {
        throw watchError;
      }

      // Update local state
      setListing(prev => prev ? { ...prev, is_watched: !prev.is_watched } : null);
    } catch (err) {
      console.error('Error toggling watch status:', err);
      // You might want to show a toast notification here
    }
  };

  return {
    listing,
    isLoading,
    error,
    refresh: fetchListing,
    toggleWatchListing
  };
}

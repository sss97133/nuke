import { useState, useEffect } from 'react';
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

const USE_REAL_DATA = {
  marketplaceDetail: true
};

const getMockListing = (id: string): MarketplaceListing => ({
  id,
  title: "2019 Porsche 911 Carrera S",
  price: 124900,
  description: "This beautiful Porsche 911 Carrera S is in excellent condition with low mileage. It features a twin-turbocharged 3.0L flat-six engine producing 443 horsepower, paired with a PDK transmission. The car comes with sport chrono package, sport exhaust, and PASM sport suspension.",
  condition: "Excellent",
  created_at: "2023-08-15T14:30:00Z",
  updated_at: "2023-09-01T10:15:00Z",
  seller: {
    id: "seller123",
    name: "Premium Auto Sales",
    avatar: "https://images.unsplash.com/photo-1568602471122-7832951cc4c5?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=facearea&facepad=2&w=300&h=300&q=80",
    rating: 4.8,
    listings_count: 27,
    joinedDate: "2020-03-15T00:00:00Z"
  },
  vehicle: {
    id: "veh789",
    make: "Porsche",
    model: "911",
    year: 2019,
    trim: "Carrera S",
    type: "Coupe",
    vin: "WP0AB2A99KS123456",
    mileage: 12450,
    fuel_type: "Gasoline",
    transmission: "Automatic",
    engine: "3.0L Twin-Turbo Flat-Six",
    exterior_color: "GT Silver Metallic",
    interior_color: "Black"
  },
  location: {
    city: "Beverly Hills",
    state: "CA",
    country: "USA",
    postal_code: "90210"
  },
  features: [
    "Sport Chrono Package",
    "Sport Exhaust System",
    "PASM Sport Suspension",
    "Panoramic Roof",
    "Premium Audio System",
    "Heated and Ventilated Seats",
    "Navigation System",
    "Bluetooth Connectivity",
    "Apple CarPlay",
    "Backup Camera"
  ],
  specifications: {
    horsepower: 443,
    torque: 390,
    acceleration: 3.5,
    top_speed: 191,
    weight: 3382,
    length: 177.9,
    width: 72.9,
    height: 51.3,
    wheelbase: 96.5,
    ground_clearance: 4.9
  },
  images: [
    "https://images.unsplash.com/photo-1584060622420-0673aad46068?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1626668893537-fc08bf57d5d7?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=1200&q=80"
  ],
  views_count: 342,
  is_featured: true,
  is_watched: false
});

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
    return getMockListing(data.id || 'unknown');
  }
}

export function useMarketplaceListing(id: string) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    console.log("useMarketplaceListing hook called with id:", id);
    if (!id) {
      console.error("No listing ID provided to useMarketplaceListing");
      if (isMounted) {
        setIsLoading(false);
        setError(new Error("No listing ID provided"));
      }
      return;
    }

    const fetchListing = async () => {
      try {
        if (isMounted) {
          setIsLoading(true);
          setError(null);
        }
        
        console.log("Fetching listing data for ID:", id);
        
        if (!USE_REAL_DATA.marketplaceDetail) {
          console.log('Using mock marketplace detail data (feature flag off)');
          if (isMounted) {
            const mockData = getMockListing(id);
            if (userId) {
              mockData.is_watched = Math.random() > 0.7;
            }
            setListing(mockData);
            setIsLoading(false);
          }
          return;
        }
        
        console.log("Using mock listing data until database tables are created");
        if (isMounted) {
          const mockData = getMockListing(id);
          if (userId) {
            mockData.is_watched = Math.random() > 0.7;
          }
          setListing(mockData);
          setIsLoading(false);
        }
        
        console.log("Simulating view count increment for listing:", id);
      } catch (err) {
        console.error("Error in useMarketplaceListing hook:", err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setListing(getMockListing(id));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchListing();
    
    return () => {
      isMounted = false;
    };
  }, [id, userId]);

  const toggleWatchListing = async () => {
    if (!listing || !userId) return;
    
    try {
      console.log(`${listing.is_watched ? 'Unwatching' : 'Watching'} listing:`, listing.id);
      
      /*
      if (listing.is_watched) {
        await supabase
          .from('user_watched_listings')
          .delete()
          .eq('user_id', userId)
          .eq('listing_id', listing.id);
      } else {
        await supabase
          .from('user_watched_listings')
          .insert({
            user_id: userId,
            listing_id: listing.id
          });
      }
      */
      
      setListing(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          is_watched: !prev.is_watched
        };
      });
    } catch (err) {
      console.error("Error toggling watch status:", err);
    }
  };

  console.log("useMarketplaceListing hook returning:", { listing, isLoading, error });
  return { 
    listing, 
    isLoading, 
    error,
    actions: {
      toggleWatchListing
    }
  };
}

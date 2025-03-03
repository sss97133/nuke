
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

export function useMarketplaceListing(id: string) {
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    console.log("useMarketplaceListing hook called with id:", id);
    if (!id) {
      console.error("No listing ID provided to useMarketplaceListing");
      setIsLoading(false);
      setError(new Error("No listing ID provided"));
      return;
    }

    const fetchListing = async () => {
      try {
        setIsLoading(true);
        console.log("Fetching listing data from API for ID:", id);
        
        // Try to get data from supabase first
        const { data, error } = await supabase
          .from('marketplace_listings')
          .select('*')
          .eq('id', id)
          .single();
        
        if (error || !data) {
          console.log("Supabase error or no data, falling back to mock:", error);
          // Use mock data for testing
          const mockListing: MarketplaceListing = {
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
          };
          
          console.log("Setting mock listing data:", mockListing);
          setListing(mockListing);
        } else {
          console.log("Successfully fetched listing data from supabase:", data);
          // Transform supabase data to match our interface if needed
          setListing(data as unknown as MarketplaceListing);
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error("Error in useMarketplaceListing hook:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    };

    fetchListing();
  }, [id]);

  console.log("useMarketplaceListing hook returning:", { listing, isLoading, error });
  return { listing, isLoading, error };
}

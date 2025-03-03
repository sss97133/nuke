
import { useState, useEffect } from 'react';
import { useToast } from "@/components/ui/use-toast";

// This is a temporary type - we'll need to create a proper type definition file
// that matches our database schema
export interface MarketplaceListing {
  id: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  imageUrl: string;
  images?: { id: number; url: string; type: string }[];
  location: {
    city: string;
    state: string;
    latitude?: number;
    longitude?: number;
  };
  created_at: string;
  updated_at?: string;
  seller: {
    id: string;
    name: string;
    avatar?: string;
    rating?: number;
    joinedDate: string;
    listings_count?: number;
  };
  vehicle: {
    make: string;
    model: string;
    year: number;
    mileage: number;
    vin?: string;
    engine?: string;
    transmission?: string;
    drivetrain?: string;
    exterior_color?: string;
    interior_color?: string;
  };
  views_count: number;
  is_featured: boolean;
  is_watched?: boolean;
  commentCount: number;
}

// Mock data for a single listing
const getMockListing = (id: string): MarketplaceListing => {
  console.log("Creating mock listing with ID:", id);
  
  return {
    id,
    title: `${new Date().getFullYear() - Math.floor(Math.random() * 20)} Honda Civic Type R - Low Miles, Excellent Condition`,
    description: "This Honda Civic Type R is in excellent condition with low miles. Recently serviced, new tires, and a clean title. No accidents and one owner from new. The Championship White exterior is pristine with no significant scratches or dents. Interior is well-maintained with minimal wear. Comes with all original documentation, two keys, and service history.",
    price: 32995,
    condition: "Excellent",
    imageUrl: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    images: [
      { id: 1, url: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", type: "Exterior Front" },
      { id: 2, url: "https://images.unsplash.com/photo-1581062123282-36e55aef7f83?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", type: "Interior Dashboard" },
      { id: 3, url: "https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", type: "Exterior Side" },
    ],
    location: {
      city: "San Francisco",
      state: "CA",
      latitude: 37.7749,
      longitude: -122.4194
    },
    created_at: "2025-02-15T14:22:10.556Z",
    seller: {
      id: "user123",
      name: "Alex Johnson",
      avatar: "https://i.pravatar.cc/150?u=alex",
      rating: 4.8,
      joinedDate: "2024-03-21T00:00:00.000Z",
      listings_count: 12
    },
    vehicle: {
      make: "Honda",
      model: "Civic Type R",
      year: 2021,
      mileage: 18500,
      vin: "1HGBH41JXMN109186",
      engine: "2.0L Turbocharged 4-Cylinder",
      transmission: "6-Speed Manual",
      drivetrain: "FWD",
      exterior_color: "Championship White",
      interior_color: "Red/Black"
    },
    views_count: 142,
    is_featured: true,
    is_watched: false,
    commentCount: 8
  };
};

export function useMarketplaceListing(id: string) {
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  useEffect(() => {
    const fetchListing = async () => {
      console.log("Fetching marketplace listing with ID:", id);
      try {
        setIsLoading(true);
        setError(null);
        
        // Simulate API request latency
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // In a real implementation, this would be a Supabase or API call
        // const { data, error } = await supabase
        //   .from('marketplace_listings')
        //   .select('*, seller:user_id(*), vehicle(*)')
        //   .eq('id', id)
        //   .single();
        
        // if (error) throw error;
        
        // For now, we'll use mock data
        const mockListing = getMockListing(id);
        console.log("Mock listing created:", mockListing);
        setListing(mockListing);
      } catch (err) {
        console.error("Error fetching marketplace listing:", err);
        setError('Failed to load listing details');
        toast({
          title: "Error",
          description: "Failed to load listing details. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
        console.log("Finished fetching marketplace listing");
      }
    };
    
    if (id) {
      fetchListing();
    } else {
      console.error("No listing ID provided to useMarketplaceListing hook");
      setError("No listing ID provided");
      setIsLoading(false);
    }
  }, [id, toast]);
  
  return { listing, isLoading, error };
}

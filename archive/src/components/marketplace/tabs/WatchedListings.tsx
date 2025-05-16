
import React, { useState, useEffect } from 'react';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/components/ui/use-toast';

// Mock data generation function - in a real app, you'd fetch from an API using the watchlist IDs
const getMockListingById = (id: string) => {
  // Generate deterministic "random" data based on the ID
  const idSum = id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  
  const makes = ['Ford', 'Toyota', 'Honda', 'Tesla', 'BMW', 'Audi', 'Mercedes'];
  const models = ['Mustang', 'Camry', 'Civic', 'Model 3', '3 Series', 'A4', 'C-Class'];
  const colors = ['Red', 'Blue', 'Black', 'White', 'Silver', 'Green'];
  const conditions = ['New', 'Like New', 'Excellent', 'Good', 'Fair'];
  const cities = ['Los Angeles', 'New York', 'Chicago', 'Miami', 'Austin', 'Seattle'];
  const states = ['CA', 'NY', 'IL', 'FL', 'TX', 'WA'];
  
  const makeIdx = idSum % makes.length;
  const modelIdx = (idSum + 1) % models.length;
  const colorIdx = (idSum + 2) % colors.length;
  const conditionIdx = (idSum + 3) % conditions.length;
  const cityIdx = (idSum + 4) % cities.length;
  const stateIdx = (idSum + 5) % states.length;
  
  const today = new Date();
  const daysAgo = (idSum % 30) + 1; // 1 to 30 days ago
  const createdDate = new Date(today);
  createdDate.setDate(today.getDate() - daysAgo);
  
  return {
    id,
    title: `${makes[makeIdx]} ${models[modelIdx]} - ${colors[colorIdx]}`,
    price: 10000 + (idSum * 100), // price between $10k and $40k
    imageUrl: 'https://placehold.co/600x400/grey/white?text=Vehicle+Image',
    location: {
      city: cities[cityIdx],
      state: states[stateIdx]
    },
    created_at: createdDate.toISOString(),
    condition: conditions[conditionIdx],
    views_count: (idSum % 100) + 5, // 5 to 105 views
    commentCount: idSum % 10, // 0 to 9 comments
    is_featured: (idSum % 5) === 0 // 20% chance of being featured
  };
};

export const WatchedListings = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { 
    watchlist, 
    isLoading: isWatchlistLoading, 
    getWatchlistByType,
    clearWatchlist
  } = useWatchlist();
  
  const [listings, setListings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load watched listings based on watchlist IDs
  useEffect(() => {
    if (!isWatchlistLoading) {
      setIsLoading(true);
      // Get listing-type items from watchlist
      const watchedListingIds = getWatchlistByType('listing').map(item => item.id);
      
      // In a real app, you would fetch these listings from your API
      // For demo purposes, we'll generate mock data based on IDs
      const fetchedListings = watchedListingIds.map(id => getMockListingById(id));
      
      setListings(fetchedListings);
      setIsLoading(false);
    }
  }, [isWatchlistLoading, watchlist, getWatchlistByType]);
  
  // Handle clearing all watched listings
  const handleClearWatchlist = () => {
    clearWatchlist();
    toast({
      title: "Watchlist cleared",
      description: "All listings have been removed from your watchlist.",
    });
  };

  if (!session) {
    return (
      <div className="text-center py-10 space-y-4">
        <p className="text-muted-foreground">Sign in to view your watched listings</p>
        <Button onClick={() => navigate('/login?redirect=/marketplace')}>Sign In</Button>
      </div>
    );
  }

  if (isLoading || isWatchlistLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-[200px] w-full rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-10 space-y-4">
        <Eye className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">You haven't watched any listings yet.</p>
        <p className="text-sm text-muted-foreground">
          When you find a listing you're interested in, click the "Watch" button to save it here.
        </p>
        <Button variant="outline" onClick={() => navigate('/marketplace')}>Browse Listings</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Your Watched Listings ({listings.length})</h3>
        {listings.length > 0 && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleClearWatchlist}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            id={listing.id}
            title={listing.title}
            price={listing.price}
            imageUrl={listing.imageUrl}
            location={`${listing.location.city}, ${listing.location.state}`}
            createdAt={listing.created_at}
            condition={listing.condition}
            viewCount={listing.views_count || 0}
            commentCount={listing.commentCount || 0}
            isFeatured={listing.is_featured}
          />
        ))}
      </div>
    </div>
  );
};

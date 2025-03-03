
import React from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const WatchedListings = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  
  const { 
    listings, 
    isLoading, 
    error 
  } = useMarketplaceListings({ isWatched: true });

  if (!session) {
    return (
      <div className="text-center py-10 space-y-4">
        <p className="text-muted-foreground">Sign in to view your watched listings</p>
        <Button onClick={() => navigate('/login?redirect=/marketplace')}>Sign In</Button>
      </div>
    );
  }

  if (isLoading) {
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

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground">Error loading your watched listings. Please try again later.</p>
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
  );
};

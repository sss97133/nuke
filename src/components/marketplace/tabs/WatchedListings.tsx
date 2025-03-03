
import React from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from '@/hooks/use-auth';
import { Link } from 'react-router-dom';

export const WatchedListings = () => {
  const { isAuthenticated } = useAuth();
  
  const { 
    listings, 
    isLoading, 
    error,
  } = useMarketplaceListings({ watchedOnly: true });

  if (!isAuthenticated) {
    return (
      <div className="text-center py-10">
        <h3 className="text-lg font-medium mb-2">Sign in to see your watched listings</h3>
        <p className="text-muted-foreground mb-4">
          Save listings to watch them for updates and price changes
        </p>
        <Button asChild>
          <Link to="/login?redirect=/marketplace?tab=watched">Sign In</Link>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(6).fill(0).map((_, i) => (
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
        <p className="text-muted-foreground">Error loading watched listings. Please try again later.</p>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-10">
        <h3 className="text-lg font-medium mb-2">No watched listings yet</h3>
        <p className="text-muted-foreground mb-4">
          Click the heart icon on any listing to add it to your watched listings
        </p>
        <Button asChild variant="outline">
          <Link to="/marketplace?tab=all">Browse Listings</Link>
        </Button>
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
          location={listing.location}
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

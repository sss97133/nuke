
import React from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";

export const FeaturedListings = () => {
  const { 
    listings, 
    isLoading, 
    error 
  } = useMarketplaceListings({ isFeatured: true });

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
        <p className="text-muted-foreground">Error loading listings. Please try again later.</p>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground">No featured listings available.</p>
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
          isFeatured={true}
        />
      ))}
    </div>
  );
};


import React from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export const AllListings = () => {
  const { 
    listings, 
    isLoading, 
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useMarketplaceListings();

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
        <p className="text-muted-foreground">No listings available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
      
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button 
            variant="outline" 
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
};

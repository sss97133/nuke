
import React, { useState, useEffect } from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapPin } from 'lucide-react';

export const NearbyListings = () => {
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState('');
  
  const { 
    listings, 
    isLoading, 
    error,
    refetch
  } = useMarketplaceListings({ 
    nearLocation: userLocation, 
    radius: 50 // 50km radius
  });

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setLocationLoading(false);
        },
        (error) => {
          console.error('Error getting location:', error);
          setLocationError('Unable to get your location. Please enable location access.');
          setLocationLoading(false);
        }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
      setLocationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userLocation) {
      refetch();
    }
  }, [userLocation, refetch]);

  if (locationLoading || isLoading) {
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

  if (locationError) {
    return (
      <Alert variant="destructive" className="mb-6">
        <MapPin className="h-4 w-4 mr-2" />
        <AlertDescription>{locationError}</AlertDescription>
      </Alert>
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
        <p className="text-muted-foreground">No listings found near your location.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-muted-foreground flex items-center">
          <MapPin className="h-4 w-4 mr-1" />
          Showing listings within 50km of your location
        </p>
      </div>
      
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
    </div>
  );
};

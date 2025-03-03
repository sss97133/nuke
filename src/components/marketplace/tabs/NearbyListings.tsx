
import React, { useState, useEffect } from 'react';
import { useMarketplaceListings } from '../hooks/useMarketplaceListings';
import { ListingCard } from '../ListingCard';
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { MapPin, Navigation } from 'lucide-react';
import { Button } from "@/components/ui/button";

export const NearbyListings = () => {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  
  const { 
    listings, 
    isLoading, 
    error
  } = useMarketplaceListings({ isNearby: true });

  const detectUserLocation = () => {
    setIsLocating(true);
    setLocationError('');
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setIsLocating(false);
        },
        (error) => {
          console.error('Error getting location:', error);
          setLocationError('Unable to get your location. Please check your browser permissions.');
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
      setIsLocating(false);
    }
  };

  // Try to get user location on first load
  useEffect(() => {
    detectUserLocation();
  }, []);

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
        <p className="text-muted-foreground">Error loading nearby listings. Please try again later.</p>
      </div>
    );
  }

  if (locationError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center"><MapPin className="mr-2 h-5 w-5" /> Location Access Required</CardTitle>
          <CardDescription>We need your location to show nearby listings</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{locationError}</p>
          <Button onClick={detectUserLocation} disabled={isLocating}>
            {isLocating ? 'Detecting Location...' : 'Allow Location Access'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground">No nearby listings found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {userLocation && (
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="flex items-center">
              <MapPin className="mr-2 h-5 w-5 text-primary" />
              <p className="text-sm">Showing listings near your location</p>
            </div>
            <Button variant="outline" size="sm" onClick={detectUserLocation} disabled={isLocating}>
              <Navigation className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      )}
      
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

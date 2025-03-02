import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Map, AlertCircle } from 'lucide-react';
import { GeoFenceFilter } from './GeoFenceFilter';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

const VehicleCard = ({ vehicle }: { vehicle: any }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-lg">{vehicle.year} {vehicle.make} {vehicle.model}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Price</span>
          <span className="font-bold">${vehicle.price.toLocaleString()}</span>
        </div>
        <div className="text-sm text-muted-foreground">{vehicle.location}</div>
        <div className="flex gap-2">
          {vehicle.tags.map((tag: string, i: number) => (
            <span key={i} className="bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">{tag}</span>
          ))}
        </div>
      </div>
    </CardContent>
  </Card>
);

interface NearbyContentProps {
  contentType?: 'vehicles' | 'auctions' | 'garages' | 'events' | 'all';
}

export const GeoFencedDiscovery = ({ contentType = 'all' }: NearbyContentProps) => {
  const [geoFilterEnabled, setGeoFilterEnabled] = useState(false);
  const [radius, setRadius] = useState(25);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  useEffect(() => {
    const fetchUserLocation = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('home_location')
            .eq('id', session.user.id)
            .single();
            
          if (profile?.home_location) {
            const locationData = typeof profile.home_location === 'string' 
              ? JSON.parse(profile.home_location) 
              : profile.home_location;
            
            if (locationData && typeof locationData.lat === 'number' && typeof locationData.lng === 'number') {
              setUserLocation({ lat: locationData.lat, lng: locationData.lng });
            }
          }
        }
      } catch (error) {
        console.error("Error fetching user location:", error);
      }
    };
    
    fetchUserLocation();
  }, []);
  
  const handleFilterChange = (newRadius: number, enabled: boolean) => {
    setRadius(newRadius);
    setGeoFilterEnabled(enabled);
  };
  
  const { data: nearbyVehicles, isLoading: vehiclesLoading, isError: vehiclesError, refetch: refetchVehicles } = 
    useQuery({
      queryKey: ['nearby-vehicles', radius, geoFilterEnabled, userLocation],
      queryFn: async () => {
        if (!geoFilterEnabled || !userLocation) return [];
        
        const { data, error } = await supabase.functions.invoke('search-local-garages', {
          body: {
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius_miles: radius,
            content_type: 'discovered_vehicles'
          }
        });
        
        if (error) throw error;
        return data || [];
      },
      enabled: geoFilterEnabled && !!userLocation
    });
  
  const { data: nearbyGarages, isLoading: garagesLoading, isError: garagesError, refetch: refetchGarages } = 
    useQuery({
      queryKey: ['nearby-garages', radius, geoFilterEnabled, userLocation],
      queryFn: async () => {
        if (!geoFilterEnabled || !userLocation) return [];
        
        const { data, error } = await supabase.functions.invoke('search-local-garages', {
          body: {
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius_miles: radius,
            content_type: 'garages'
          }
        });
        
        if (error) throw error;
        return data || [];
      },
      enabled: geoFilterEnabled && !!userLocation
    });
    
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <GeoFenceFilter 
            onFilterChange={handleFilterChange} 
          />
          
          {geoFilterEnabled && userLocation && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">What's Nearby</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Discovered Vehicles</span>
                    <span className="font-medium">{nearbyVehicles?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Garages & Shops</span>
                    <span className="font-medium">{nearbyGarages?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Auctions</span>
                    <span className="font-medium">0</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Events</span>
                    <span className="font-medium">0</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        
        <div className="md:col-span-3">
          {!geoFilterEnabled ? (
            <Card className="h-full flex items-center justify-center p-6">
              <div className="text-center">
                <Map className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-medium mb-2">Enable Geo-Fencing</h3>
                <p className="text-muted-foreground mb-4 max-w-md">
                  Turn on location filtering to discover vehicles, auctions, and events happening in your area.
                </p>
              </div>
            </Card>
          ) : !userLocation ? (
            <Card className="h-full flex items-center justify-center p-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-medium mb-2">Location Required</h3>
                <p className="text-muted-foreground mb-4 max-w-md">
                  Please enable location access to use this feature.
                </p>
              </div>
            </Card>
          ) : (
            <Tabs defaultValue="vehicles">
              <TabsList className="mb-4">
                <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
                <TabsTrigger value="garages">Garages & Shops</TabsTrigger>
                <TabsTrigger value="auctions">Auctions</TabsTrigger>
                <TabsTrigger value="events">Events</TabsTrigger>
              </TabsList>
              
              <TabsContent value="vehicles" className="m-0">
                {vehiclesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : vehiclesError ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                    <p>Error loading nearby vehicles</p>
                    <Button variant="outline" className="mt-2" onClick={() => refetchVehicles()}>
                      Retry
                    </Button>
                  </div>
                ) : nearbyVehicles && nearbyVehicles.length > 0 ? (
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {nearbyVehicles.map((vehicle) => (
                      <VehicleCard 
                        key={vehicle.id} 
                        vehicle={{
                          id: vehicle.id,
                          make: vehicle.make,
                          model: vehicle.model,
                          year: vehicle.year,
                          price: parseFloat(vehicle.price?.replace(/[^0-9.]/g, '') || '0'),
                          mileage: 0,
                          image: "/placeholder.png",
                          location: vehicle.location || "Unknown",
                          added: new Date(vehicle.created_at).toLocaleDateString(),
                          tags: vehicle.status === 'verified' ? ['Verified'] : []
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Map className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-medium mb-2">No Vehicles Found Nearby</h3>
                    <p className="text-muted-foreground max-w-md">
                      Try expanding your search radius or exploring a different area.
                    </p>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="garages" className="m-0">
                {garagesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : garagesError ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                    <p>Error loading nearby garages</p>
                    <Button variant="outline" className="mt-2" onClick={() => refetchGarages()}>
                      Retry
                    </Button>
                  </div>
                ) : nearbyGarages && nearbyGarages.length > 0 ? (
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {nearbyGarages.map((garage) => (
                      <Card key={garage.id}>
                        <CardHeader>
                          <CardTitle className="text-lg">{garage.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="text-sm">
                              {garage.address || "No address available"}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm">View Profile</Button>
                              <Button size="sm">Contact</Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Map className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-medium mb-2">No Garages Found Nearby</h3>
                    <p className="text-muted-foreground max-w-md">
                      Try expanding your search radius or exploring a different area.
                    </p>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="auctions" className="m-0">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Map className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-medium mb-2">No Auctions Found Nearby</h3>
                  <p className="text-muted-foreground max-w-md">
                    Try expanding your search radius or check back later.
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="events" className="m-0">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Map className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-medium mb-2">No Events Found Nearby</h3>
                  <p className="text-muted-foreground max-w-md">
                    Try expanding your search radius or check back later.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
};

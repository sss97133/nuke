import type { Database } from '../types';
import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, Settings } from 'lucide-react';
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface GeoFenceFilterProps {
  onFilterChange: (radius: number, enabled: boolean) => void;
  className?: string;
}

export const GeoFenceFilter = ({ onFilterChange, className }: GeoFenceFilterProps) => {
  const [radius, setRadius] = useState<number>(25); // Default radius in miles
  const [enabled, setEnabled] = useState<boolean>(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const { toast } = useToast();
  
  // Attempt to get user's location from their profile first
  useEffect(() => {
    const fetchUserLocation = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
        
        if (session?.user) {
          const { data: profile } = await supabase
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
            .from('profiles')
            .select('home_location')
            .eq('id', session.user.id)
            .single();
            
          if (profile?.home_location) {
            // Parse the home_location to ensure it's in the correct format
            const locationData = typeof profile.home_location === 'string' 
              ? JSON.parse(profile.home_location) 
              : profile.home_location;
            
            if (locationData && typeof locationData.lat === 'number' && typeof locationData.lng === 'number') {
              setUserLocation({ lat: locationData.lat, lng: locationData.lng });
              setLocationStatus('success');
              return;
            }
          }
        }
        
        // If no profile location, request browser location
        requestBrowserLocation();
      } catch (error) {
        console.error("Error fetching user location from profile:", error);
        requestBrowserLocation();
      }
    };
    
    fetchUserLocation();
  }, []);
  
  const requestBrowserLocation = () => {
    setLocationStatus('loading');
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          setLocationStatus('success');
          
          // If the user is logged in, update their profile with this location
          updateUserProfileLocation(newLocation);
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationStatus('error');
          toast({
            title: "Location access denied",
            description: "Enable location services to use geo-fencing features.",
            variant: "destructive"
          });
        }
      );
    } else {
      setLocationStatus('error');
      toast({
        title: "Location not supported",
        description: "Your browser doesn't support geolocation.",
        variant: "destructive"
      });
    }
  };
  
  const updateUserProfileLocation = async (location: { lat: number; lng: number }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
  if (error) console.error("Database query error:", error);
      
      if (session?.user) {
        await supabase
          
          .update({ home_location: location })
          .eq('id', session.user.id);
      }
    } catch (error) {
      console.error("Error updating profile location:", error);
    }
  };
  
  const handleRadiusChange = (value: number[]) => {
    const newRadius = value[0];
    setRadius(newRadius);
    onFilterChange(newRadius, enabled);
  };
  
  const handleToggleChange = (checked: boolean) => {
    setEnabled(checked);
    
    if (checked && locationStatus !== 'success') {
      requestBrowserLocation();
    } else {
      onFilterChange(radius, checked);
    }
  };
  
  const handleRefreshLocation = () => {
    requestBrowserLocation();
  };
  
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-md flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Geo-Fence Discovery
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label htmlFor="geo-fence-toggle" className="text-sm font-medium">
                Enable location filtering
              </Label>
              <span className="text-xs text-muted-foreground">
                Show content near you
              </span>
            </div>
            <Switch 
              id="geo-fence-toggle"
              checked={enabled}
              onCheckedChange={handleToggleChange}
            />
          </div>
          
          {locationStatus === 'success' && userLocation && (
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="flex gap-1 px-2 py-1">
                <Navigation className="h-3 w-3" />
                <span className="text-xs">
                  {userLocation.lat.toFixed(2)}, {userLocation.lng.toFixed(2)}
                </span>
              </Badge>
              <Button variant="ghost" size="sm" onClick={handleRefreshLocation}>
                <Navigation className="h-3 w-3 mr-1" />
                Update
              </Button>
            </div>
          )}
          
          {locationStatus === 'loading' && (
            <div className="text-sm text-muted-foreground flex items-center gap-2 justify-center py-1">
              <div className="h-3 w-3 rounded-full bg-primary animate-pulse"></div>
              Detecting location...
            </div>
          )}
          
          {locationStatus === 'error' && (
            <div className="text-sm text-destructive flex items-center gap-2 justify-center py-1">
              Location access required
            </div>
          )}
          
          <div className={`space-y-2 ${enabled ? 'opacity-100' : 'opacity-50'}`}>
            <div className="flex justify-between items-center">
              <Label htmlFor="radius-slider" className="text-sm">Distance radius</Label>
              <Badge variant="secondary">{radius} miles</Badge>
            </div>
            <Slider
              id="radius-slider"
              disabled={!enabled}
              value={[radius]}
              min={5}
              max={100}
              step={5}
              onValueChange={handleRadiusChange}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>5mi</span>
              <span>100mi</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

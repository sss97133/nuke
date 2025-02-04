import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Building, MapPin, Star } from "lucide-react";
import { ImportGarages } from "./ImportGarages";

export const GarageManagement = () => {
  const [newGarageName, setNewGarageName] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          toast({
            title: "Location Error",
            description: "Could not get your location. Using default location.",
            variant: "destructive"
          });
          // Default to a central location if geolocation fails
          setUserLocation({ lat: 40.7128, lng: -74.0060 });
        }
      );
    }
  }, []);

  // Query nearby garages when we have user location
  const { data: garages, refetch } = useQuery({
    queryKey: ['garages', userLocation],
    queryFn: async () => {
      if (!userLocation) return [];

      // First, search for nearby garages using Google Places API
      const { data: searchResult, error: searchError } = await supabase.functions.invoke('search-garages', {
        body: {
          lat: userLocation.lat,
          lng: userLocation.lng,
          radius: 5000 // 5km radius
        }
      });

      if (searchError) {
        console.error('Error searching garages:', searchError);
        toast({
          title: "Error",
          description: "Failed to search for nearby garages",
          variant: "destructive"
        });
        return [];
      }

      // Then fetch all garages from our database
      const { data: dbGarages, error: dbError } = await supabase
        .from('garages')
        .select('*')
        .order('name');
      
      if (dbError) throw dbError;
      return dbGarages;
    },
    enabled: !!userLocation
  });

  const handleCreateGarage = async () => {
    if (!newGarageName.trim()) {
      toast({
        title: "Error",
        description: "Garage name is required",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
      .from('garages')
      .insert([{ name: newGarageName.trim() }]);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to create garage",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Success",
      description: "Garage created successfully"
    });
    setNewGarageName("");
    refetch();
  };

  return (
    <div className="space-y-4 font-mono">
      <div className="border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">[TAMS]</span>
          <span className="text-xs text-foreground">GARAGE_MGMT_SYS v1.0</span>
        </div>
      </div>

      <div className="flex gap-2 items-center bg-muted p-2 border border-border">
        <span className="text-xs text-muted-foreground">CMD:</span>
        <Input
          placeholder="NEW_GARAGE_NAME"
          value={newGarageName}
          onChange={(e) => setNewGarageName(e.target.value)}
          className="h-7 text-xs font-mono bg-background"
        />
        <Button
          onClick={handleCreateGarage}
          size="sm"
          className="h-7 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          ADD
        </Button>
        <ImportGarages />
      </div>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <div
            key={garage.id}
            className="p-2 border border-border bg-background text-xs animate-fade-in"
          >
            <div className="flex items-center gap-2 border-b border-dotted border-border pb-1">
              <Building className="w-3 h-3 text-foreground" />
              <span className="text-foreground uppercase">{garage.name}</span>
            </div>
            
            {garage.address && (
              <div className="flex items-center gap-1 text-muted-foreground mt-1">
                <MapPin className="w-3 h-3" />
                <span className="truncate">{garage.address}</span>
              </div>
            )}
            
            {garage.rating && (
              <div className="flex items-center gap-1 text-muted-foreground mt-1">
                <Star className="w-3 h-3" />
                <span>{garage.rating} / 5</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>MEM:0</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => {
                  toast({
                    title: "Info",
                    description: "Member management coming soon"
                  });
                }}
              >
                MANAGE
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-4">
        <span>SYS_STATUS: {userLocation ? 'READY' : 'WAITING_FOR_LOCATION'}</span>
        <span className="ml-4">LOCATION: {userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : 'UNKNOWN'}</span>
        <span className="ml-4">LAST_UPDATE: {new Date().toISOString()}</span>
      </div>
    </div>
  );
};
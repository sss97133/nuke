
import { useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useGarageSearch = (userLocation: { lat: number; lng: number } | null) => {
  const { toast } = useToast();

  useEffect(() => {
    const searchNearbyGarages = async () => {
      if (!userLocation) {
        console.log('No user location available yet');
        return;
      }

      console.log('Searching for garages near:', userLocation);
      
      try {
        const { data, error } = await supabase.functions.invoke('search-local-garages', {
  if (error) console.error("Database query error:", error);
          body: {
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius: 5000 // 5km radius
          }
        });

        if (error) {
          console.error('Error searching garages:', error);
          toast({
            title: "Error",
            description: "Failed to find nearby automotive shops: " + error.message,
            variant: "destructive"
          });
          return;
        }

        console.log('Search response:', data);

        if (data?.success) {
          toast({
            title: "Success",
            description: `Found ${data.garages.length} nearby automotive shops`,
          });
        }
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: "Error",
          description: "Failed to search for nearby shops: " + (error as Error).message,
          variant: "destructive"
        });
      }
    };

    searchNearbyGarages();
  }, [userLocation, toast]);
};

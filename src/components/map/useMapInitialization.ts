
import { useEffect, useRef, MutableRefObject, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useMapInitialization = (
  mapContainer: MutableRefObject<HTMLDivElement | null>,
  userLocation: { lat: number; lng: number } | null
) => {
  const map = useRef<mapboxgl.Map | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const tokenFetchAttempts = useRef(0);
  const maxAttempts = 3;

  useEffect(() => {
    if (!mapContainer.current) return;

    let isMounted = true;
    
    const initializeMap = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Use exponential backoff for token fetching
        const fetchTokenWithRetry = async (): Promise<string | null> => {
          try {
            const { data, error } = await supabase.functions.invoke('get-mapbox-token');
            
            if (error || !data?.secret) {
              tokenFetchAttempts.current += 1;
              
              if (tokenFetchAttempts.current < maxAttempts) {
                console.log(`Retrying token fetch (${tokenFetchAttempts.current}/${maxAttempts})...`);
                // Wait with exponential backoff before retrying
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, tokenFetchAttempts.current)));
                return fetchTokenWithRetry();
              }
              
              throw new Error(error?.message || "Failed to get Mapbox token");
            }
            
            return data.secret;
          } catch (err) {
            console.error("Mapbox token fetch error:", err);
            return null;
          }
        };

        const mapboxToken = await fetchTokenWithRetry();
        
        if (!mapboxToken) {
          toast({
            title: "Map Error",
            description: "Failed to initialize map. Please try again later.",
            variant: "destructive"
          });
          
          if (isMounted) {
            setError("Failed to initialize map");
            setIsLoading(false);
          }
          return;
        }

        mapboxgl.accessToken = mapboxToken;
        
        const initialCenter = userLocation || { lng: -115.1398, lat: 36.1699 };
        
        if (!isMounted) return;
        
        try {
          map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [initialCenter.lng, initialCenter.lat],
            zoom: userLocation ? 12 : 9
          });
        } catch (mapError) {
          console.error("Map creation error:", mapError);
          if (isMounted) {
            setError("Could not create map");
            setIsLoading(false);
            toast({
              title: "Map Error",
              description: "Failed to create map. Please check your browser settings.",
              variant: "destructive"
            });
          }
          return;
        }

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

        if (userLocation) {
          const popup = new mapboxgl.Popup({ offset: 25 })
            .setHTML('<h3 class="font-bold">Home Base</h3>');

          new mapboxgl.Marker({ color: '#FF0000' })
            .setLngLat([userLocation.lng, userLocation.lat])
            .setPopup(popup)
            .addTo(map.current);
        }
        
        map.current.on('load', () => {
          if (isMounted) {
            setIsLoading(false);
          }
        });
        
        map.current.on('error', (e) => {
          console.error("Mapbox error:", e);
          if (isMounted) {
            setError("Map error occurred");
            toast({
              title: "Map Error",
              description: "An error occurred with the map. Some features may not work.",
              variant: "destructive"
            });
          }
        });
        
      } catch (err) {
        console.error("Map initialization error:", err);
        if (isMounted) {
          setError("Failed to initialize map");
          setIsLoading(false);
          toast({
            title: "Error",
            description: "Failed to initialize map. Please try again later.",
            variant: "destructive"
          });
        }
      }
    };

    initializeMap();

    return () => {
      isMounted = false;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [toast, userLocation]);

  return { map: map.current, isLoading, error };
};

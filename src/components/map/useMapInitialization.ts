
import { useEffect, useRef, MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useMapInitialization = (
  mapContainer: MutableRefObject<HTMLDivElement | null>,
  userLocation: { lat: number; lng: number } | null
) => {
  const map = useRef<mapboxgl.Map | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!mapContainer.current) return;

    const initializeMap = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error || !data?.secret) {
          toast({
            title: "Error",
            description: "Failed to initialize map. Please try again later.",
            variant: "destructive"
          });
          return;
        }

        mapboxgl.accessToken = data.secret;
        
        const initialCenter = userLocation || { lng: -115.1398, lat: 36.1699 };
        
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [initialCenter.lng, initialCenter.lat],
          zoom: userLocation ? 12 : 9
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

        if (userLocation) {
          const popup = new mapboxgl.Popup({ offset: 25 })
            .setHTML('<h3 class="font-bold">Home Base</h3>');

          new mapboxgl.Marker({ color: '#FF0000' })
            .setLngLat([userLocation.lng, userLocation.lat])
            .setPopup(popup)
            .addTo(map.current);
        }
      } catch (error) {
        console.error('Map initialization error:', error);
        toast({
          title: "Error",
          description: "Failed to initialize map. Please try again later.",
          variant: "destructive"
        });
      }
    };

    initializeMap();

    return () => {
      map.current?.remove();
    };
  }, [toast, userLocation]);

  return map;
};

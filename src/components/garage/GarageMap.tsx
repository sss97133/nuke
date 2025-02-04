import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from "@/integrations/supabase/client";

type Garage = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null;
  address: string | null;
};

export const GarageMap = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const [garages, setGarages] = useState<Garage[]>([]);

  useEffect(() => {
    const fetchGarages = async () => {
      const { data } = await supabase
        .from('garages')
        .select('id, name, location, address')
        .not('location', 'is', null);
      
      if (data) {
        const formattedGarages: Garage[] = data.map(garage => ({
          id: garage.id,
          name: garage.name,
          location: garage.location ? {
            lat: (garage.location as any).lat,
            lng: (garage.location as any).lng
          } : null,
          address: garage.address
        }));
        setGarages(formattedGarages);
      }
    };

    fetchGarages();

    const channel = supabase
      .channel('garage-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'garages'
        },
        (payload) => {
          console.log('Garage update:', payload);
          fetchGarages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    const initializeMap = async () => {
      const { data: { secret: mapboxToken } } = await supabase
        .functions.invoke('get-mapbox-token');

      if (!mapboxToken) {
        console.error('Mapbox token not found');
        return;
      }

      mapboxgl.accessToken = mapboxToken;
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [-74.5, 40],
        zoom: 9
      });

      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    };

    initializeMap();

    return () => {
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;

    Object.values(markersRef.current).forEach(marker => marker.remove());
    markersRef.current = {};

    garages.forEach(garage => {
      if (garage.location) {
        const popup = new mapboxgl.Popup({ offset: 25 })
          .setHTML(`
            <h3 class="font-bold">${garage.name}</h3>
            ${garage.address ? `<p>${garage.address}</p>` : ''}
          `);

        const marker = new mapboxgl.Marker()
          .setLngLat([garage.location.lng, garage.location.lat])
          .setPopup(popup)
          .addTo(map.current!);

        markersRef.current[garage.id] = marker;
      }
    });

    if (garages.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      garages.forEach(garage => {
        if (garage.location) {
          bounds.extend([garage.location.lng, garage.location.lat]);
        }
      });
      map.current.fitBounds(bounds, { padding: 50 });
    }
  }, [garages]);

  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden shadow-lg">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
};
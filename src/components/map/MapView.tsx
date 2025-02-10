import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MapFilters, MapFilter } from './MapFilters';

type Garage = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null;
  address: string | null;
};

const initialFilters: MapFilter[] = [
  { id: 'ptz_workshops', label: 'PTZ Workshops', enabled: true },
  { id: 'ptz_franchises', label: 'PTZ Franchises', enabled: false },
  { id: 'clients', label: 'Clients', enabled: false },
  { id: 'collections', label: 'Collections', enabled: false },
  { id: 'vehicles_for_sale', label: 'Vehicles for Sale', enabled: false },
  { id: 'hot_zones', label: 'Hot Zones', enabled: false },
  { id: 'collaborations', label: 'Collaborations', enabled: false },
  { id: 'events', label: 'Events', enabled: false },
  { id: 'automotive_stores', label: 'Automotive Stores', enabled: false },
  { id: 'non_connected_shops', label: 'Non-Connected Shops', enabled: false },
  { id: 'secret_finds', label: 'Secret Car Finds', enabled: false }
];

export const MapView = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const [garages, setGarages] = useState<Garage[]>([]);
  const [filters, setFilters] = useState<MapFilter[]>(initialFilters);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchUserLocation = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('home_location')
        .single();

      if (profile?.home_location) {
        setUserLocation(profile.home_location as { lat: number; lng: number });
      }
    };

    fetchUserLocation();
  }, []);

  const handleFilterChange = (id: string, enabled: boolean) => {
    setFilters(filters.map(filter => 
      filter.id === id ? { ...filter, enabled } : filter
    ));
    
    toast({
      title: `${enabled ? 'Showing' : 'Hiding'} ${id.replace(/_/g, ' ')}`,
      description: "Filter settings updated",
    });
  };

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
      if (userLocation) {
        bounds.extend([userLocation.lng, userLocation.lat]);
      }
      map.current.fitBounds(bounds, { padding: 50 });
    }
  }, [garages, userLocation]);

  return (
    <div className="space-y-4">
      <MapFilters 
        filters={filters}
        onFilterChange={handleFilterChange}
      />
      <div className="w-full h-[400px] rounded-lg overflow-hidden shadow-lg">
        <div ref={mapContainer} className="w-full h-full" />
      </div>
    </div>
  );
};

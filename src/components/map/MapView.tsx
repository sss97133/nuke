import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MapFilters, MapFilter } from './MapFilters';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Garage = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null;
  address: string | null;
};

type ProbabilityZone = {
  id: string;
  location_bounds: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  probability_score: number;
  estimated_count: number;
  vehicle_type: string;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [yearRange, setYearRange] = useState('65-69');
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchUserLocation = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.log('No authenticated user found');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('home_location')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user location:', error);
        return;
      }

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

  const handleProbabilitySearch = async () => {
    if (!map.current) return;

    setIsSearching(true);
    try {
      const bounds = map.current.getBounds();
      const boundsObj = {
        northeast: { lat: bounds.getNorthEast().lat, lng: bounds.getNorthEast().lng },
        southwest: { lat: bounds.getSouthWest().lat, lng: bounds.getSouthWest().lng }
      };

      const [startYear, endYear] = yearRange.split('-').map(Number);
      const response = await supabase.functions.invoke('analyze-vehicle-probability', {
        body: {
          searchQuery: `${searchQuery} mustang fastback`,
          bounds: boundsObj,
          yearRange: `[${startYear},${endYear}]`
        }
      });

      if (response.error) throw response.error;

      // Add probability zone to the map
      const { data } = response;
      const bounds_coordinates = [
        [data.location_bounds.southwest.lng, data.location_bounds.southwest.lat],
        [data.location_bounds.northeast.lng, data.location_bounds.northeast.lat]
      ];

      // Remove existing probability layers
      if (map.current.getLayer('probability-zone')) {
        map.current.removeLayer('probability-zone');
        map.current.removeSource('probability-zone');
      }

      map.current.addSource('probability-zone', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            probability: data.probability_score,
            count: data.estimated_count
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                bounds_coordinates[0],
                [bounds_coordinates[0][0], bounds_coordinates[1][1]],
                bounds_coordinates[1],
                [bounds_coordinates[1][0], bounds_coordinates[0][1]],
                bounds_coordinates[0]
              ]
            ]
          }
        }
      });

      map.current.addLayer({
        id: 'probability-zone',
        type: 'fill',
        source: 'probability-zone',
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'probability'],
            0, 'rgba(33, 102, 172, 0)',
            1, 'rgba(33, 102, 172, 0.6)'
          ],
          'fill-outline-color': 'rgb(33, 102, 172)'
        }
      });

      toast({
        title: "Search Complete",
        description: `Found an estimated ${data.estimated_count} vehicles matching your criteria`,
      });
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search Failed",
        description: "Unable to complete the probability search",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Input
          type="text"
          placeholder="Search for vehicles (e.g. mustang fastback)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
        />
        <Input
          type="text"
          placeholder="Year range (e.g. 65-69)"
          value={yearRange}
          onChange={(e) => setYearRange(e.target.value)}
          className="w-32"
        />
        <Button 
          onClick={handleProbabilitySearch}
          disabled={isSearching}
        >
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </div>
      
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

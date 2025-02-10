
import React, { useRef, useState, useEffect } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MapFilters, MapFilter } from './MapFilters';
import { MapSearch } from './MapSearch';
import { useMapInitialization } from './useMapInitialization';
import { useUserLocation } from './useUserLocation';
import { useGarages } from './useGarages';
import { useMapMarkers } from './useMapMarkers';

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
  const [filters, setFilters] = useState<MapFilter[]>(initialFilters);
  const [searchQuery, setSearchQuery] = useState('');
  const [yearRange, setYearRange] = useState('65-69');
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();

  const userLocation = useUserLocation();
  const garages = useGarages();
  const map = useMapInitialization(mapContainer, userLocation);
  useMapMarkers(map, garages, userLocation);

  // Effect to search for nearby garages when user location is available
  useEffect(() => {
    const searchNearbyGarages = async () => {
      if (!userLocation) return;

      try {
        const { data, error } = await supabase.functions.invoke('search-local-garages', {
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
            description: "Failed to find nearby automotive shops",
            variant: "destructive"
          });
          return;
        }

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
          description: "Failed to search for nearby shops",
          variant: "destructive"
        });
      }
    };

    searchNearbyGarages();
  }, [userLocation, toast]);

  const handleFilterChange = (id: string, enabled: boolean) => {
    setFilters(filters.map(filter => 
      filter.id === id ? { ...filter, enabled } : filter
    ));
    
    toast({
      title: `${enabled ? 'Showing' : 'Hiding'} ${id.replace(/_/g, ' ')}`,
      description: "Filter settings updated",
    });
  };

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

      const { data } = response;
      const bounds_coordinates = [
        [data.location_bounds.southwest.lng, data.location_bounds.southwest.lat],
        [data.location_bounds.northeast.lng, data.location_bounds.northeast.lat]
      ];

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
      <MapSearch
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        yearRange={yearRange}
        setYearRange={setYearRange}
        isSearching={isSearching}
        onSearch={handleProbabilitySearch}
      />
      
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

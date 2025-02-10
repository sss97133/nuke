
import { useState } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import mapboxgl from 'mapbox-gl';

export const useProbabilitySearch = (map: React.MutableRefObject<mapboxgl.Map | null>) => {
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();

  const handleProbabilitySearch = async (searchQuery: string, yearRange: string) => {
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

  return { isSearching, handleProbabilitySearch };
};

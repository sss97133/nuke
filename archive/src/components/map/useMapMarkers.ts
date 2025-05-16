
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { Garage } from './useGarages';

export const useMapMarkers = (
  map: React.MutableRefObject<mapboxgl.Map | null>,
  garages: Garage[],
  userLocation: { lat: number; lng: number } | null
) => {
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});

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

  return markersRef;
};

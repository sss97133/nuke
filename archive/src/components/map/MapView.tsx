
import React, { useRef, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapFilters, MapFilter } from './MapFilters';
import { MapSearch } from './MapSearch';
import { useMapInitialization } from './useMapInitialization';
import { useUserLocation } from './useUserLocation';
import { useGarages } from './useGarages';
import { useMapMarkers } from './useMapMarkers';
import { useGarageSearch } from './useGarageSearch';
import { useProbabilitySearch } from './useProbabilitySearch';
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

  const userLocation = useUserLocation();
  const garages = useGarages();
  const map = useMapInitialization(mapContainer, userLocation);
  useMapMarkers(map, garages, userLocation);
  useGarageSearch(userLocation);
  const { isSearching, handleProbabilitySearch } = useProbabilitySearch(map);

  const handleFilterChange = (id: string, enabled: boolean) => {
    setFilters(filters.map(filter => 
      filter.id === id ? { ...filter, enabled } : filter
    ));
    
    toast({
      title: `${enabled ? 'Showing' : 'Hiding'} ${id.replace(/_/g, ' ')}`,
      description: "Filter settings updated",
    });
  };

  const handleSearch = () => {
    handleProbabilitySearch(searchQuery, yearRange);
  };

  return (
    <div className="space-y-4">
      <MapSearch
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        yearRange={yearRange}
        setYearRange={setYearRange}
        isSearching={isSearching}
        onSearch={handleSearch}
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

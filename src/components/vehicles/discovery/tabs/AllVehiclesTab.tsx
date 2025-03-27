
import React, { useMemo } from 'react';
import VehicleTabContent from '../VehicleTabContent';
import { Vehicle, VehicleActionHandlers, SortField, SortDirection } from '../types';

interface AllVehiclesTabProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  searchTerm: string;
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const AllVehiclesTab = ({
  vehicles,
  searchTerm,
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: AllVehiclesTabProps) => {
  // Filter vehicles based on search term and sort them
  const filteredAndSortedVehicles = useMemo(() => {
    const result = vehicles.filter(vehicle => {
      const searchString = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.location}`.toLowerCase();
      return searchString.includes(searchTerm.toLowerCase());
    });
    
    return result.sort((a, b) => {
      const field = sortField;
      const direction = sortDirection === 'asc' ? 1 : -1;
      
      if (field === 'added') {
        return direction * (a[field].localeCompare(b[field]));
      }
      
      if (typeof a[field] === 'string' && typeof b[field] === 'string') {
        return direction * (a[field] as string).localeCompare(b[field] as string);
      }
      
      return direction * ((a[field] as number) - (b[field] as number));
    });
  }, [vehicles, searchTerm, sortField, sortDirection]);
  
  return (
    <VehicleTabContent 
      vehicles={vehicles}
      filteredVehicles={filteredAndSortedVehicles}
      viewMode={viewMode}
      selectedVehicles={selectedVehicles}
      toggleVehicleSelection={toggleVehicleSelection}
      onVerify={onVerify}
      onEdit={onEdit}
      onRemove={onRemove}
      sortField={sortField}
      sortDirection={sortDirection}
    />
  );
};

export default AllVehiclesTab;

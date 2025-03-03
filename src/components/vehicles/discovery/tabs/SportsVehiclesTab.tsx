
import React from 'react';
import VehicleTabContent from '../VehicleTabContent';
import { Vehicle, VehicleActionHandlers, SortField, SortDirection } from '../types';

interface SportsVehiclesTabProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const SportsVehiclesTab = ({
  vehicles,
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: SportsVehiclesTabProps) => {
  // Filter vehicles with Sports Car tag
  const filteredVehicles = vehicles.filter(v => v.tags.includes("Sports Car"));
  
  return (
    <VehicleTabContent 
      vehicles={vehicles}
      filteredVehicles={filteredVehicles}
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

export default SportsVehiclesTab;


import React from 'react';
import VehicleTabContent from '../VehicleTabContent';
import { Vehicle, VehicleActionHandlers, SortField, SortDirection } from '../types';

interface ModifiedVehiclesTabProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const ModifiedVehiclesTab = ({
  vehicles,
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: ModifiedVehiclesTabProps) => {
  // Filter vehicles with Modified tag
  const filteredVehicles = vehicles.filter(v => v.tags.includes("Modified"));
  
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

export default ModifiedVehiclesTab;

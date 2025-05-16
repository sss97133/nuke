
import React from 'react';
import VehicleTabContent from '../VehicleTabContent';
import { Vehicle, VehicleActionHandlers, SortField, SortDirection } from '../types';

interface RareVehiclesTabProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const RareVehiclesTab = ({
  vehicles,
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: RareVehiclesTabProps) => {
  // Filter vehicles with Rare tag
  const filteredVehicles = vehicles.filter(v => v.tags.includes("Rare"));
  
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

export default RareVehiclesTab;

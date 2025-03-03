
import React from 'react';
import VehicleTabContent from '../VehicleTabContent';
import { Vehicle, VehicleActionHandlers, SortField, SortDirection } from '../types';

interface ClassicVehiclesTabProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const ClassicVehiclesTab = ({
  vehicles,
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: ClassicVehiclesTabProps) => {
  // Filter vehicles from before 1990
  const filteredVehicles = vehicles.filter(v => v.year < 1990);
  
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

export default ClassicVehiclesTab;

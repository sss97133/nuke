
import React from 'react';
import { Button } from "@/components/ui/button";
import VehicleCard from './VehicleCard';
import VehicleTable from './VehicleTable';
import VehicleStats from './VehicleStats';
import VehicleListView from './VehicleListView';
import { Vehicle, VehicleActionHandlers } from './types';

interface VehicleTabContentProps extends VehicleActionHandlers {
  vehicles: Vehicle[];
  filteredVehicles: Vehicle[];
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

const VehicleTabContent = ({ 
  vehicles, 
  filteredVehicles, 
  viewMode,
  selectedVehicles,
  toggleVehicleSelection,
  onVerify,
  onEdit,
  onRemove,
  sortField,
  sortDirection
}: VehicleTabContentProps) => {
  return (
    <>
      <VehicleStats vehicles={vehicles} filteredCount={filteredVehicles.length} />
      
      {viewMode === "grid" && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredVehicles.map((vehicle) => (
            <VehicleCard 
              key={vehicle.id} 
              vehicle={vehicle} 
              onVerify={onVerify}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      
      {viewMode === "table" && (
        <VehicleTable 
          vehicles={filteredVehicles}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      )}
      
      {viewMode === "list" && (
        <VehicleListView 
          vehicles={filteredVehicles}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      )}
      
      <div className="mt-6 flex justify-center">
        <Button variant="outline">Load More Vehicles</Button>
      </div>
    </>
  );
};

export default VehicleTabContent;

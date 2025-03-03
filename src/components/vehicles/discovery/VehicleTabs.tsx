
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AllVehiclesTab from './tabs/AllVehiclesTab';
import ClassicVehiclesTab from './tabs/ClassicVehiclesTab';
import SportsVehiclesTab from './tabs/SportsVehiclesTab';
import ModifiedVehiclesTab from './tabs/ModifiedVehiclesTab';
import RareVehiclesTab from './tabs/RareVehiclesTab';
import { Vehicle, SortField, SortDirection } from './types';

interface VehicleTabsProps {
  vehicles: Vehicle[];
  searchTerm: string;
  viewMode: string;
  selectedVehicles: number[];
  toggleVehicleSelection: (id: number) => void;
  onVerify: (id: number) => void;
  onEdit: (id: number) => void;
  onRemove: (id: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}

const VehicleTabs = ({
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
}: VehicleTabsProps) => {
  return (
    <Tabs defaultValue="all">
      <TabsList className="mb-4">
        <TabsTrigger value="all">All Vehicles</TabsTrigger>
        <TabsTrigger value="classic">Classic</TabsTrigger>
        <TabsTrigger value="sports">Sports Cars</TabsTrigger>
        <TabsTrigger value="modified">Modified</TabsTrigger>
        <TabsTrigger value="rare">Rare Finds</TabsTrigger>
      </TabsList>
      
      <TabsContent value="all" className="m-0">
        <AllVehiclesTab 
          vehicles={vehicles}
          searchTerm={searchTerm}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </TabsContent>
      
      <TabsContent value="classic" className="m-0">
        <ClassicVehiclesTab 
          vehicles={vehicles}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </TabsContent>
      
      <TabsContent value="sports" className="m-0">
        <SportsVehiclesTab 
          vehicles={vehicles}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </TabsContent>
      
      <TabsContent value="modified" className="m-0">
        <ModifiedVehiclesTab 
          vehicles={vehicles}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </TabsContent>
      
      <TabsContent value="rare" className="m-0">
        <RareVehiclesTab 
          vehicles={vehicles}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={onVerify}
          onEdit={onEdit}
          onRemove={onRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </TabsContent>
    </Tabs>
  );
};

export default VehicleTabs;

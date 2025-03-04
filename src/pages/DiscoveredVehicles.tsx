
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import VehicleTabs from '../components/vehicles/discovery/VehicleTabs';
import { useVehiclesData } from '../hooks/useVehiclesData';

const DiscoveredVehicles = () => {
  const {
    vehicles,
    searchTerm,
    setSearchTerm,
    selectedVehicles,
    setSelectedVehicles,
    bulkActionOpen,
    setBulkActionOpen,
    viewMode,
    setViewMode,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    handleVerify,
    handleEdit,
    handleRemove,
    toggleVehicleSelection,
    handleBulkVerify,
    handleBulkAddToGarage,
    handleBulkRemove
  } = useVehiclesData();
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6 max-w-screen-xl mx-auto">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Vehicles</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Organize and manage vehicles discovered by our system and community
          </p>
        </div>
        
        <VehicleFilters 
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          viewMode={viewMode}
          setViewMode={setViewMode}
          sortField={sortField}
          setSortField={setSortField}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
        />
        
        <BulkActions 
          selectedVehicles={selectedVehicles}
          setSelectedVehicles={setSelectedVehicles}
          bulkActionOpen={bulkActionOpen}
          setBulkActionOpen={setBulkActionOpen}
          onBulkVerify={handleBulkVerify}
          onBulkAddToGarage={handleBulkAddToGarage}
          onBulkRemove={handleBulkRemove}
        />
        
        <VehicleTabs 
          vehicles={vehicles}
          searchTerm={searchTerm}
          viewMode={viewMode}
          selectedVehicles={selectedVehicles}
          toggleVehicleSelection={toggleVehicleSelection}
          onVerify={handleVerify}
          onEdit={handleEdit}
          onRemove={handleRemove}
          sortField={sortField}
          sortDirection={sortDirection}
        />
      </div>
    </ScrollArea>
  );
};

export default DiscoveredVehicles;

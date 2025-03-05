
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import VehicleTabs from '../components/vehicles/discovery/VehicleTabs';
import AddVehicleButton from '../components/vehicles/discovery/AddVehicleButton';
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
    handleBulkRemove,
    isLoading,
    error
  } = useVehiclesData();
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6 max-w-screen-xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Vehicles</h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Organize and manage vehicles discovered by our system and community
            </p>
          </div>
          
          {/* Add the "Add Vehicle" button */}
          <AddVehicleButton />
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
        
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <p className="text-red-500 mb-4">Error loading vehicles: {error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-white rounded-md"
            >
              Retry
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </ScrollArea>
  );
};

export default DiscoveredVehicles;

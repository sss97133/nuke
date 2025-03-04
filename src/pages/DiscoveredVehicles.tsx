
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import VehicleTabs from '../components/vehicles/discovery/VehicleTabs';
import { useVehiclesData } from '../hooks/useVehiclesData';

const DiscoveredVehicles = () => {
  const {
    vehicles,
    loading,
    error,
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
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading vehicles...</p>
          </div>
        ) : error ? (
          <Alert variant="destructive" className="my-4">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : vehicles.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-background">
            <h3 className="text-lg font-medium mb-2">No vehicles found</h3>
            <p className="text-muted-foreground mb-6">
              Start by adding your first vehicle or import from an existing source.
            </p>
            <div className="flex justify-center">
              {/* You can add a button here to add a new vehicle */}
            </div>
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

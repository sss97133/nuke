
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import VehicleTabs from '../components/vehicles/discovery/VehicleTabs';
import { useVehiclesData } from '../hooks/vehicles/useVehiclesData';
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Plus } from 'lucide-react';
import { Button } from "@/components/ui/button";

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
        
        {selectedVehicles.length > 0 && (
          <BulkActions 
            selectedVehicles={selectedVehicles}
            setSelectedVehicles={setSelectedVehicles}
            bulkActionOpen={bulkActionOpen}
            setBulkActionOpen={setBulkActionOpen}
            onBulkVerify={handleBulkVerify}
            onBulkAddToGarage={handleBulkAddToGarage}
            onBulkRemove={handleBulkRemove}
          />
        )}
        
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-[100px] w-full" />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-[300px] w-full" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center border border-red-200 rounded-lg bg-red-50">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <p className="mt-4 text-red-500">Error loading vehicles: {error}</p>
            <Button 
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded"
            >
              Retry
            </Button>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="p-8 text-center border border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">No vehicles found</p>
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Vehicle
            </Button>
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

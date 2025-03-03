
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import AllVehiclesTab from '../components/vehicles/discovery/tabs/AllVehiclesTab';
import ClassicVehiclesTab from '../components/vehicles/discovery/tabs/ClassicVehiclesTab';
import SportsVehiclesTab from '../components/vehicles/discovery/tabs/SportsVehiclesTab';
import ModifiedVehiclesTab from '../components/vehicles/discovery/tabs/ModifiedVehiclesTab';
import RareVehiclesTab from '../components/vehicles/discovery/tabs/RareVehiclesTab';
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
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Vehicles</h1>
          <p className="text-muted-foreground">
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
              onVerify={handleVerify}
              onEdit={handleEdit}
              onRemove={handleRemove}
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
              onVerify={handleVerify}
              onEdit={handleEdit}
              onRemove={handleRemove}
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
              onVerify={handleVerify}
              onEdit={handleEdit}
              onRemove={handleRemove}
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
              onVerify={handleVerify}
              onEdit={handleEdit}
              onRemove={handleRemove}
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
              onVerify={handleVerify}
              onEdit={handleEdit}
              onRemove={handleRemove}
              sortField={sortField}
              sortDirection={sortDirection}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default DiscoveredVehicles;

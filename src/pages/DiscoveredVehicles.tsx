
import React, { useState, useMemo } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VehicleFilters from '../components/vehicles/discovery/VehicleFilters';
import BulkActions from '../components/vehicles/discovery/BulkActions';
import VehicleTabContent from '../components/vehicles/discovery/VehicleTabContent';
import { Vehicle, SortDirection, SortField } from '../components/vehicles/discovery/types';

const DiscoveredVehicles = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  const vehicles: Vehicle[] = [
    {
      id: 1,
      make: "Toyota",
      model: "Supra",
      year: 1998,
      price: 62500,
      mileage: 42000,
      image: "/placeholder.png",
      location: "Los Angeles, CA",
      added: "2 days ago",
      tags: ["Rare", "Sports Car"]
    },
    {
      id: 2,
      make: "Ford",
      model: "Mustang",
      year: 1967,
      price: 78900,
      mileage: 89000,
      image: "/placeholder.png",
      location: "Chicago, IL",
      added: "5 days ago",
      tags: ["Classic", "American"]
    },
    {
      id: 3,
      make: "Honda",
      model: "Civic Type R",
      year: 2021,
      price: 42000,
      mileage: 12000,
      image: "/placeholder.png",
      location: "Seattle, WA",
      added: "1 week ago",
      tags: ["Hot Hatch", "Modified"]
    },
    {
      id: 4,
      make: "Porsche",
      model: "911 Carrera",
      year: 2019,
      price: 110500,
      mileage: 18000,
      image: "/placeholder.png",
      location: "Miami, FL",
      added: "2 weeks ago",
      tags: ["Luxury", "Sports Car"]
    },
    {
      id: 5,
      make: "Chevrolet",
      model: "Corvette",
      year: 2020,
      price: 86000,
      mileage: 8500,
      image: "/placeholder.png",
      location: "Austin, TX",
      added: "3 days ago",
      tags: ["American", "Sports Car"]
    },
    {
      id: 6,
      make: "Nissan",
      model: "GT-R",
      year: 2017,
      price: 92000,
      mileage: 26000,
      image: "/placeholder.png",
      location: "Denver, CO",
      added: "6 days ago",
      tags: ["Japanese", "Performance"]
    }
  ];
  
  // Handle various vehicle actions
  const handleVerify = (id: number) => {
    console.log(`Verifying vehicle ${id}`);
  };
  
  const handleEdit = (id: number) => {
    console.log(`Editing vehicle ${id}`);
  };
  
  const handleRemove = (id: number) => {
    console.log(`Removing vehicle ${id}`);
  };
  
  const toggleVehicleSelection = (id: number) => {
    if (id === -1) {
      // Special case to clear all
      setSelectedVehicles([]);
      return;
    }
    
    if (selectedVehicles.includes(id)) {
      setSelectedVehicles(selectedVehicles.filter(vehicleId => vehicleId !== id));
    } else {
      setSelectedVehicles([...selectedVehicles, id]);
    }
  };
  
  // Handle bulk actions
  const handleBulkVerify = () => {
    console.log(`Verifying vehicles: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const handleBulkAddToGarage = () => {
    console.log(`Adding vehicles to garage: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const handleBulkRemove = () => {
    console.log(`Removing vehicles: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  // Filter and sort vehicles
  const filteredAndSortedVehicles = useMemo(() => {
    // First filter
    let result = vehicles.filter(vehicle => {
      const searchString = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.location}`.toLowerCase();
      return searchString.includes(searchTerm.toLowerCase());
    });
    
    // Then sort
    return result.sort((a, b) => {
      const field = sortField;
      const direction = sortDirection === 'asc' ? 1 : -1;
      
      if (field === 'added') {
        // Simplistic comparison for the mock data
        // In a real app, we'd parse dates properly
        return direction * (a[field].localeCompare(b[field]));
      }
      
      if (typeof a[field] === 'string' && typeof b[field] === 'string') {
        return direction * (a[field] as string).localeCompare(b[field] as string);
      }
      
      return direction * ((a[field] as number) - (b[field] as number));
    });
  }, [vehicles, searchTerm, sortField, sortDirection]);
  
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
            <VehicleTabContent 
              vehicles={vehicles}
              filteredVehicles={filteredAndSortedVehicles}
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
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.year < 1990)
                .map((vehicle) => (
                  <VehicleCard 
                    key={vehicle.id} 
                    vehicle={vehicle}
                    onVerify={handleVerify}
                    onEdit={handleEdit}
                    onRemove={handleRemove}
                  />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="sports" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Sports Car"))
                .map((vehicle) => (
                  <VehicleCard 
                    key={vehicle.id} 
                    vehicle={vehicle}
                    onVerify={handleVerify}
                    onEdit={handleEdit}
                    onRemove={handleRemove}
                  />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="modified" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Modified"))
                .map((vehicle) => (
                  <VehicleCard 
                    key={vehicle.id} 
                    vehicle={vehicle}
                    onVerify={handleVerify}
                    onEdit={handleEdit}
                    onRemove={handleRemove}
                  />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="rare" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Rare"))
                .map((vehicle) => (
                  <VehicleCard 
                    key={vehicle.id} 
                    vehicle={vehicle}
                    onVerify={handleVerify}
                    onEdit={handleEdit}
                    onRemove={handleRemove}
                  />
                ))
              }
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default DiscoveredVehicles;

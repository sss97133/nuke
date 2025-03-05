
import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Car, Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import VehicleFilterDialog, { VehicleFilters } from '@/components/vehicles/VehicleFilterDialog';
import EditVehicleForm from '@/components/vehicles/EditVehicleForm';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

// Mock data for demonstration purposes
const MOCK_VEHICLES = [
  {
    id: '1',
    make: 'Ford',
    model: 'Mustang',
    year: 1967,
    color: 'blue',
    ownership_status: 'owned',
    mileage: 78500,
    image: null,
    lastUpdated: '2025-02-15T14:30:00Z'
  },
  {
    id: '2',
    make: 'Chevrolet',
    model: 'Corvette',
    year: 1963,
    color: 'red',
    ownership_status: 'claimed',
    mileage: 120300,
    image: null,
    lastUpdated: '2025-03-01T10:15:00Z'
  },
  {
    id: '3',
    make: 'Porsche',
    model: '911',
    year: 1973,
    color: 'silver',
    ownership_status: 'discovered',
    mileage: 45200,
    image: null,
    lastUpdated: '2025-02-28T16:45:00Z'
  }
];

export default function Vehicles() {
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicles, setVehicles] = useState(MOCK_VEHICLES);
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Filter dialog state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<VehicleFilters | null>(null);
  
  // Edit vehicle form state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  
  // Apply filters function
  const handleApplyFilters = (filters: VehicleFilters) => {
    setActiveFilters(Object.keys(filters).length ? filters : null);
    
    // Show toast notification about filters
    const filterCount = Object.keys(filters).length;
    if (filterCount > 0) {
      toast({
        title: "Filters Applied",
        description: `Applied ${filterCount} filter${filterCount === 1 ? '' : 's'} to your vehicles.`,
      });
    }
  };
  
  // Clear all filters
  const handleClearFilters = () => {
    setActiveFilters(null);
    setSearchQuery('');
    
    toast({
      title: "Filters Cleared",
      description: "All filters have been removed.",
    });
  };
  
  // Handle edit button click
  const handleEditVehicle = (id: string) => {
    setSelectedVehicleId(id);
    setIsEditOpen(true);
  };
  
  // Handle successful edit
  const handleEditSuccess = () => {
    // In a real app, you would refresh the vehicle data
    // For demo purposes, we'll just update the lastUpdated timestamp
    setVehicles(prev => 
      prev.map(vehicle => 
        vehicle.id === selectedVehicleId
          ? { ...vehicle, lastUpdated: new Date().toISOString() }
          : vehicle
      )
    );
    
    toast({
      title: "Vehicle Updated",
      description: "Your vehicle information has been successfully updated.",
    });
  };
  
  // Get filtered vehicles based on search query and active filters
  const filteredVehicles = useMemo(() => {
    let result = vehicles;
    
    // Apply text search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(vehicle => {
        const searchString = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.color}`.toLowerCase();
        return searchString.includes(query);
      });
    }
    
    // Apply advanced filters if any
    if (activeFilters) {
      // Filter by make
      if (activeFilters.make) {
        result = result.filter(vehicle => 
          vehicle.make.toLowerCase() === activeFilters.make!.toLowerCase()
        );
      }
      
      // Filter by model
      if (activeFilters.model) {
        result = result.filter(vehicle => 
          vehicle.model.toLowerCase().includes(activeFilters.model!.toLowerCase())
        );
      }
      
      // Filter by year range
      if (activeFilters.yearRange) {
        const [minYear, maxYear] = activeFilters.yearRange;
        result = result.filter(vehicle => 
          vehicle.year >= minYear && vehicle.year <= maxYear
        );
      }
      
      // Filter by colors
      if (activeFilters.colors && activeFilters.colors.length > 0) {
        result = result.filter(vehicle => 
          activeFilters.colors!.includes(vehicle.color.toLowerCase())
        );
      }
      
      // Filter by ownership status
      if (activeFilters.statuses && activeFilters.statuses.length > 0) {
        result = result.filter(vehicle => 
          activeFilters.statuses!.includes(vehicle.ownership_status)
        );
      }
      
      // Filter by mileage range
      if (activeFilters.mileageRange) {
        const [minMileage, maxMileage] = activeFilters.mileageRange;
        result = result.filter(vehicle => 
          vehicle.mileage >= minMileage && vehicle.mileage <= maxMileage
        );
      }
    }
    
    return result;
  }, [vehicles, searchQuery, activeFilters]);
  
  // Get filter count for the badge
  const filterCount = activeFilters ? Object.keys(activeFilters).length : 0;
  
  const getOwnershipStatusBadge = (status: string) => {
    switch (status) {
      case 'owned':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Owned</span>;
      case 'claimed':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">Claimed</span>;
      case 'discovered':
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Discovered</span>;
      default:
        return null;
    }
  };

  return (
    <div className="container py-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Vehicles</h1>
          <p className="text-muted-foreground mt-1">
            Manage and view all your vehicles
          </p>
        </div>
        <Button 
          onClick={() => navigate('/add-vehicle')}
          className="whitespace-nowrap"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Vehicle
        </Button>
      </div>
      
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicles..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {filterCount > 0 && (
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleClearFilters}
              title="Clear all filters"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button 
            variant="outline" 
            className="sm:w-auto w-full"
            onClick={() => setIsFilterOpen(true)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
            {filterCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {filterCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
      
      {filteredVehicles.length === 0 ? (
        <div className="text-center py-12">
          <Car className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
          <h3 className="mt-4 text-lg font-medium">No vehicles found</h3>
          <p className="mt-1 text-muted-foreground">
            {(searchQuery || activeFilters) 
              ? "Try adjusting your search criteria or filters" 
              : "Add your first vehicle to get started"}
          </p>
          <div className="flex gap-4 justify-center mt-6">
            {(searchQuery || activeFilters) && (
              <Button
                variant="outline"
                onClick={handleClearFilters}
              >
                Clear Filters
              </Button>
            )}
            <Button 
              onClick={() => navigate('/add-vehicle')}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Vehicle
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredVehicles.map((vehicle) => (
            <Card key={vehicle.id} className="overflow-hidden">
              <div className="aspect-video bg-muted flex items-center justify-center">
                <Car className="h-12 w-12 text-muted-foreground opacity-50" />
              </div>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </CardTitle>
                  {getOwnershipStatusBadge(vehicle.ownership_status)}
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-sm text-muted-foreground">
                  <p>Color: {vehicle.color}</p>
                  <p>Mileage: {vehicle.mileage.toLocaleString()} mi</p>
                  <p className="mt-1">
                    Last updated {new Date(vehicle.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
              <CardFooter className="pt-0 flex justify-between">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/vehicles/${vehicle.id}`}>View Details</Link>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleEditVehicle(vehicle.id)}
                >
                  Edit
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      
      {/* Filter Dialog */}
      <VehicleFilterDialog
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        onApplyFilters={handleApplyFilters}
      />
      
      {/* Edit Vehicle Form */}
      {selectedVehicleId && (
        <EditVehicleForm
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          vehicleId={selectedVehicleId}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}

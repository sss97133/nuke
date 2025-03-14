import type { Database } from '../types';
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Car, Search, Filter, X, ChevronDown, Check, UploadCloud, Circle, Gauge, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import VehicleFilterDialog, { VehicleFilters } from '@/components/vehicles/VehicleFilterDialog';
import EditVehicleForm from '@/components/vehicles/EditVehicleForm';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast/toast-context';
import { supabase, safeSelect } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  ownership_status: string;
  mileage: number;
  image_url?: string | null;
  image?: string | null;
  updated_at?: string;
  lastUpdated?: string;
  bulk_upload_batch_id?: string | null;
  user_id?: string;
  created_at?: string;
  body_type?: string | null;
  condition_description?: string | null;
  condition_rating?: number | null;
  drivetrain?: string | null;
}

// Helper function to format date
const formatDate = (dateString?: string): string => {
  if (!dateString) return 'Unknown';
  
  try {
    const date = new Date(dateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return 'Unknown';
    
    // Get time difference in milliseconds
    const diff = Date.now() - date.getTime();
    
    // Less than 24 hours ago
    if (diff < 24 * 60 * 60 * 1000) {
      return 'Today';
    }
    
    // Less than 48 hours ago
    if (diff < 48 * 60 * 60 * 1000) {
      return 'Yesterday';
    }
    
    // Format date
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    return 'Unknown';
  }
};

export default function Vehicles() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  
  // State declarations
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<VehicleFilters | null>(null);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [justImported, setJustImported] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  
  // Use this effect to check if we just added a vehicle and show a message
  useEffect(() => {
    if (location.state?.fromAdd) {
      toast({
        title: 'Vehicle Added',
        description: 'Your vehicle has been successfully added.',
        variant: 'success',
      });
      // Clear the state to avoid showing the toast multiple times
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, toast, navigate]);
  
  // Check for query params for just imported vehicles
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const batchId = params.get('batch');
    if (batchId) {
      setJustImported(batchId);
      // Clear it from URL without refreshing
      navigate('/vehicles', { replace: true });
    }
  }, [location, navigate]);

  // Fetch vehicles from Supabase
  useEffect(() => {
    const fetchVehicles = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
        
        if (!user) {
          toast({
            title: "Authentication required",
            description: "You must be logged in to view vehicles",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        
        const { data, error } = await safeSelect(
          supabase.from('vehicles'),
          '*'
        )
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        
        if (error) {
          console.error('Error fetching vehicles:', error);
          toast({
            title: "Error",
            description: "Failed to fetch vehicles. Please try again.",
            variant: "destructive",
          });
        } else {
          // Process the vehicles data
          const processedVehicles = data.map((vehicle: any) => ({
            ...vehicle,
            lastUpdated: formatDate(vehicle.updated_at),
            // Add image_url if it exists in your data structure
          })) as Vehicle[];
          
          setVehicles(processedVehicles);
        }
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: "Error",
          description: "An unexpected error occurred. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicles();
  }, [toast]);
  
  // Use useMemo to compute filtered vehicles
  const filteredVehicles = useMemo(() => {
    let result = [...vehicles];
    
    // Apply text search filter
    if (searchTerm) {
      const query = searchTerm.toLowerCase();
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
  }, [vehicles, searchTerm, activeFilters]);
  
  // Apply filters function
  const handleApplyFilters = (filters: VehicleFilters) => {
    setActiveFilters(filters);
    setIsFilterOpen(false);
  };
  
  // Clear all filters
  const handleClearFilters = () => {
    setActiveFilters(null);
    setSearchTerm('');
    setIsFilterOpen(false);
    
    toast({
      title: "Filters Cleared",
      description: "All filters have been removed.",
    });
  };
  
  // Handle edit button click
  const handleEditVehicle = (id: string) => {
    setEditingVehicleId(id);
    setIsEditOpen(true);
  };
  
  // Handle successful edit
  const handleEditSuccess = async () => {
    // Refresh the vehicles data after an edit
    setLoading(true);
    
    try {
      // For real implementation, refetch from the database
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!user) {
        toast({
          title: "Authentication required",
          description: "You must be logged in to view vehicles",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      
      const { data, error } = await safeSelect(
        supabase,
        '*'
      )
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      
      // Map the data to match our Vehicle interface
      const formattedVehicles = data.map((vehicle: any) => ({
        ...vehicle,
        image: vehicle.image_url,
        lastUpdated: formatDate(vehicle.updated_at),
      })) as Vehicle[];
      
      if (formattedVehicles.length > 0) {
        setVehicles(formattedVehicles);
      }
      
      toast({
        title: "Vehicle Updated",
        description: "Your vehicle information has been successfully updated.",
      });
    } catch (error) {
      console.error('Error refreshing vehicles:', error);
      toast({
        title: 'Error',
        description: 'Failed to refresh vehicles data.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };
  
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

  const renderVehicleCard = (vehicle: Vehicle) => {
    // Check if this is a recently imported vehicle
    const isRecentlyImported = !!vehicle.bulk_upload_batch_id;
    
    return (
      <Card key={vehicle.id} className={`overflow-hidden ${isRecentlyImported ? 'border-green-500 border-2 shadow-md' : ''}`}>
        <CardContent className="p-0">
          <div className="relative aspect-[16/9] bg-muted">
            {vehicle.image_url ? (
              <img
                src={vehicle.image_url}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="object-cover w-full h-full"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Car className="h-10 w-10 text-muted-foreground" />
                <span className="sr-only">No image available</span>
              </div>
            )}
            
            {isRecentlyImported && (
              <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                New Import
              </div>
            )}
          </div>
          
          <div className="p-4">
            <h3 className="text-lg font-semibold">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
            <div className="mt-2 space-y-1">
              {vehicle.color && (
                <p className="text-sm flex items-center gap-2">
                  <Circle className="h-3 w-3" style={{ fill: vehicle.color, stroke: vehicle.color }} />
                  <span>{vehicle.color}</span>
                </p>
              )}
              {vehicle.mileage && (
                <p className="text-sm flex items-center gap-2">
                  <Gauge className="h-3 w-3" />
                  <span>{vehicle.mileage.toLocaleString()} miles</span>
                </p>
              )}
              <p className="text-sm flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>Updated {vehicle.lastUpdated}</span>
              </p>
              <div className="mt-2">
                {getOwnershipStatusBadge(vehicle.ownership_status)}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t p-4">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full" 
            onClick={() => handleEditVehicle(vehicle.id)}
          >
            View Details
          </Button>
        </CardFooter>
      </Card>
    );
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Vehicles</h1>
            <p className="text-muted-foreground">
              View and manage all your vehicles
            </p>
          </div>
          <div className="flex gap-3">
            <Button asChild>
              <Link to="/import-vehicles" className="flex items-center gap-2">
                <UploadCloud className="h-4 w-4" /> Import
              </Link>
            </Button>
            <Button asChild>
              <Link to="/add-vehicle" className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4" /> Add Vehicle
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex gap-3 flex-col sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search vehicles..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button 
            variant="outline" 
            className="flex gap-2 items-center"
            onClick={() => setIsFilterOpen(true)}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilters && (
              <Badge variant="secondary" className="ml-1">
                Active
              </Badge>
            )}
          </Button>
          {activeFilters && (
            <Button 
              variant="ghost" 
              size="icon"
              className="hidden sm:flex"
              onClick={handleClearFilters}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Clear filters</span>
            </Button>
          )}
        </div>

        {activeFilters && (
          <div className="flex gap-2 flex-wrap text-sm">
            <div className="text-muted-foreground">Active filters:</div>
            {activeFilters.statuses && activeFilters.statuses.length > 0 && (
              <Badge variant="secondary" className="flex gap-1 items-center">
                Status: {activeFilters.statuses.join(', ')}
                <button
                  className="ml-1 rounded-full"
                  onClick={() => {
                    setActiveFilters({
                      ...activeFilters,
                      statuses: undefined
                    });
                  }}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove status filter</span>
                </button>
              </Badge>
            )}
            {(activeFilters.make || activeFilters.model) && (
              <Badge variant="secondary" className="flex gap-1 items-center">
                Make/Model: {activeFilters.make} {activeFilters.model}
                <button
                  className="ml-1 rounded-full"
                  onClick={() => {
                    setActiveFilters({
                      ...activeFilters,
                      make: undefined,
                      model: undefined
                    });
                  }}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove make/model filter</span>
                </button>
              </Badge>
            )}
            {activeFilters.yearRange && (
              <Badge variant="secondary" className="flex gap-1 items-center">
                Year: {activeFilters.yearRange[0]} - {activeFilters.yearRange[1]}
                <button
                  className="ml-1 rounded-full"
                  onClick={() => {
                    setActiveFilters({
                      ...activeFilters,
                      yearRange: undefined
                    });
                  }}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove year filter</span>
                </button>
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 px-2 sm:hidden"
              onClick={handleClearFilters}
            >
              Clear all
            </Button>
          </div>
        )}

        <VehicleFilterDialog
          open={isFilterOpen}
          onOpenChange={setIsFilterOpen}
          onApplyFilters={handleApplyFilters}
          initialFilters={activeFilters}
          onClear={handleClearFilters}
        />

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">Loading your vehicles...</p>
            </div>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="border rounded-lg p-12 flex flex-col items-center justify-center text-center">
            <Car className="h-12 w-12 mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">No vehicles found</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              {searchTerm || activeFilters
                ? "No vehicles match your search criteria. Try adjusting your filters."
                : "You haven't added any vehicles yet. Get started by adding your first vehicle."}
            </p>
            <div className="flex gap-4">
              {(searchTerm || activeFilters) && (
                <Button variant="outline" onClick={handleClearFilters}>
                  Clear Filters
                </Button>
              )}
              <Button asChild>
                <Link to="/add-vehicle" className="flex items-center gap-2">
                  <PlusCircle className="h-4 w-4" />
                  Add Vehicle
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredVehicles.map(renderVehicleCard)}
          </div>
        )}
      </div>
    </ScrollArea>
  );
} 
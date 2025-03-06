import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Car, Wrench, List, ShoppingCart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useVehicles, Vehicle } from '@/hooks/useVehicles';

// Define part compatibility type
interface PartCompatibility {
  id: string;
  name: string;
  category: string;
  compatibleWith: string[];
  price: number;
  notes: string;
}

const VehiclePartsViewer = () => {
  const { vehicles, loading: vehiclesLoading, addVehicle } = useVehicles();
  const [compatibleParts, setCompatibleParts] = useState<Record<string, PartCompatibility[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchCompatibleParts = async () => {
      try {
        if (vehiclesLoading) return;
        
        setLoading(true);
        
        if (vehicles.length > 0) {
          setSelectedVehicle(vehicles[0].id);
          
          // In a real implementation, this would fetch compatible parts from your database
          // For now, using mock data
          const mockParts: Record<string, PartCompatibility[]> = {};
          
          // Generate mock parts for each vehicle
          vehicles.forEach(vehicle => {
            const vehicleParts = getPartsForVehicle(vehicle);
            mockParts[vehicle.id] = vehicleParts;
          });
          
          setCompatibleParts(mockParts);
        }
      } catch (err) {
        console.error('Error fetching compatible parts:', err);
        toast({
          title: "Error",
          description: "Could not load compatible parts data",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchCompatibleParts();
  }, [vehicles, vehiclesLoading, toast]);

  // Helper function to generate mock parts for a vehicle
  const getPartsForVehicle = (vehicle: Vehicle): PartCompatibility[] => {
    const { make, model, year } = vehicle;
    const vehicleString = `${make} ${model} ${year}`;
    
    // Basic parts all vehicles need
    const basicParts = [
      { 
        id: `oil-${vehicle.id}`, 
        name: 'Oil Filter', 
        category: 'Filters', 
        compatibleWith: [`${make} ${model} ${year-1}-${year+3}`], 
        price: 12.99, 
        notes: 'Recommended replacement every 5,000 miles' 
      },
      { 
        id: `air-${vehicle.id}`, 
        name: 'Air Filter', 
        category: 'Filters', 
        compatibleWith: [`${make} ${model} ${year-2}-${year+2}`, `${make} various models`], 
        price: 18.50, 
        notes: 'Recommended replacement every 15,000 miles' 
      },
    ];
    
    // Add some make-specific parts
    if (make === 'Toyota') {
      basicParts.push({ 
        id: `brake-${vehicle.id}`, 
        name: 'Brake Pads (Front)', 
        category: 'Brakes', 
        compatibleWith: ['Toyota Camry 2019-2022'], 
        price: 45.99, 
        notes: 'Ceramic pads, low dust' 
      });
    } else if (make === 'Honda') {
      basicParts.push({ 
        id: `cabin-${vehicle.id}`, 
        name: 'Cabin Air Filter', 
        category: 'Filters', 
        compatibleWith: ['Honda Civic 2016-2022'], 
        price: 24.99, 
        notes: 'HEPA filter available' 
      });
    } else if (make === 'Ford') {
      basicParts.push({ 
        id: `fuel-${vehicle.id}`, 
        name: 'Fuel Filter', 
        category: 'Filters', 
        compatibleWith: ['Ford F-150 2018-2022'], 
        price: 29.99, 
        notes: 'Recommended replacement every 30,000 miles' 
      });
    }
    
    return basicParts;
  };

  const getVehicleFullName = (vehicle: Vehicle) => {
    return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  };

  const getVehicleById = (id: string): Vehicle | undefined => {
    return vehicles.find(v => v.id === id);
  };

  const handleAddVehicleClick = () => {
    // In a real app, this would open a modal to add a vehicle
    // For demo, we'll just add a mock vehicle
    const newVehicle = {
      make: 'Chevrolet',
      model: 'Malibu',
      year: 2021,
    };
    
    addVehicle(newVehicle);
    toast({
      title: "Vehicle Added",
      description: "New vehicle has been added to your garage",
      variant: "default"
    });
  };

  const handleAddToCartClick = (part: PartCompatibility) => {
    toast({
      title: "Added to Cart",
      description: `${part.name} has been added to your cart`,
      variant: "default"
    });
  };

  const selectedVehicleParts = selectedVehicle ? compatibleParts[selectedVehicle] || [] : [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Vehicle-Specific Parts</h2>
      
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : vehicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <Car className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Vehicles Found</h3>
            <p className="text-muted-foreground text-center mb-4">
              You need to add vehicles to your garage before you can view compatible parts.
            </p>
            <Button onClick={handleAddVehicleClick}>Add Vehicle</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <TabsList className="h-auto w-auto">
              {vehicles.map(vehicle => (
                <TabsTrigger
                  key={vehicle.id}
                  value={vehicle.id}
                  onClick={() => setSelectedVehicle(vehicle.id)}
                  className={selectedVehicle === vehicle.id ? "bg-primary text-primary-foreground" : ""}
                >
                  <Car className="h-4 w-4 mr-2" />
                  {getVehicleFullName(vehicle)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          
          {selectedVehicle && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {getVehicleById(selectedVehicle) ? getVehicleFullName(getVehicleById(selectedVehicle)!) : 'Loading...'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedVehicleParts.length === 0 ? (
                  <div className="text-center py-6">
                    <List className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <h3 className="text-lg font-medium mb-1">No parts found</h3>
                    <p className="text-muted-foreground">No compatible parts found for this vehicle.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedVehicleParts.map(part => (
                      <div key={part.id} className="border rounded-md p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-medium">{part.name}</h3>
                            <div className="text-sm text-muted-foreground mb-2">{part.category}</div>
                          </div>
                          <div className="text-lg font-bold">${part.price.toFixed(2)}</div>
                        </div>
                        <div className="mt-2 text-sm">
                          <div className="flex items-start gap-2 mb-1">
                            <Wrench className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <span>Compatible with: {part.compatibleWith.join(', ')}</span>
                          </div>
                          <div className="text-muted-foreground mt-2">{part.notes}</div>
                        </div>
                        <div className="mt-4">
                          <Button 
                            size="sm" 
                            onClick={() => handleAddToCartClick(part)}
                            className="flex items-center gap-2"
                          >
                            <ShoppingCart className="h-3 w-3" />
                            Add to Cart
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default VehiclePartsViewer;
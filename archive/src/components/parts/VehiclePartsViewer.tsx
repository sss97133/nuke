import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { Car, Wrench, List, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVehicles, Vehicle } from '@/hooks/useVehicles';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

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
  const { vehicles, isLoading: vehiclesLoading, addVehicle } = useVehicles();
  const [compatibleParts, setCompatibleParts] = useState<Record<string, PartCompatibility[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchCompatibleParts = useCallback(async () => {
    try {
      if (vehiclesLoading) return;
      
      setLoading(true);
      
      if (vehicles.length > 0) {
        setSelectedVehicle(vehicles[0].id);
        
        // Fetch compatible parts from Supabase
        const { data, error } = await supabase
          .from('vehicle_parts')
          .select(`
            *,
            vehicles:vehicle_id (id, make, model, year)
          `)
          .in('vehicle_id', vehicles.map(v => v.id));
          
        if (error) {
          throw error;
        }
        
        // Transform data into the expected format
        const partsByVehicle: Record<string, PartCompatibility[]> = {};
        
        data.forEach(part => {
          if (!partsByVehicle[part.vehicle_id]) {
            partsByVehicle[part.vehicle_id] = [];
          }
          
          partsByVehicle[part.vehicle_id].push({
            id: part.id,
            name: part.name,
            category: part.category,
            compatibleWith: part.compatible_vehicles,
            price: part.price,
            notes: part.notes
          });
        });
        
        setCompatibleParts(partsByVehicle);
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
  }, [vehicles, vehiclesLoading, toast]);

  useEffect(() => {
    fetchCompatibleParts();
  }, [fetchCompatibleParts]);

  const getVehicleFullName = (vehicle: Vehicle) => {
    return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  };

  const getVehicleById = (id: string): Vehicle | undefined => {
    return vehicles.find(v => v.id === id);
  };

  const handleAddVehicleClick = async () => {
    // In a real app, this would open a modal to add a vehicle
    // For demo, we'll just add a mock vehicle
    const newVehicle = {
      make: 'Chevrolet',
      model: 'Malibu',
      year: 2021,
    };
    
    await addVehicle(newVehicle);
    toast({
      title: "Vehicle Added",
      description: "New vehicle has been added to your garage"
    });
  };

  const handleAddToCartClick = (part: PartCompatibility) => {
    toast({
      title: "Added to Cart",
      description: `${part.name} has been added to your cart`
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
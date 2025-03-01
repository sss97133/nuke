
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Car, Wrench, List } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

// Define vehicle type
interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [compatibleParts, setCompatibleParts] = useState<Record<string, PartCompatibility[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        
        // Get vehicles from Supabase
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, year')
          .order('year', { ascending: false });
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          setVehicles(data);
          setSelectedVehicle(data[0].id);
          
          // Fetch compatible parts for each vehicle
          await fetchCompatibleParts(data);
        }
      } catch (error) {
        console.error('Error fetching vehicles:', error);
        toast({
          title: "Error",
          description: "Could not load vehicles data",
          variant: "destructive"
        });
        
        // Mock data for demonstration
        const mockVehicles = [
          { id: '1', make: 'Toyota', model: 'Camry', year: 2019 },
          { id: '2', make: 'Honda', model: 'Civic', year: 2020 },
          { id: '3', make: 'Ford', model: 'F-150', year: 2018 },
        ];
        setVehicles(mockVehicles);
        setSelectedVehicle('1');
        
        // Mock compatible parts
        const mockParts: Record<string, PartCompatibility[]> = {
          '1': [
            { id: '1', name: 'Oil Filter', category: 'Filters', compatibleWith: ['Toyota Camry 2019-2022'], price: 12.99, notes: 'Recommended replacement every 5,000 miles' },
            { id: '2', name: 'Air Filter', category: 'Filters', compatibleWith: ['Toyota Camry 2018-2022', 'Toyota Corolla 2018-2022'], price: 18.50, notes: 'Recommended replacement every 15,000 miles' },
            { id: '3', name: 'Brake Pads (Front)', category: 'Brakes', compatibleWith: ['Toyota Camry 2019-2022'], price: 45.99, notes: 'Ceramic pads, low dust' },
          ],
          '2': [
            { id: '4', name: 'Oil Filter', category: 'Filters', compatibleWith: ['Honda Civic 2018-2022', 'Honda Accord 2018-2022'], price: 10.99, notes: 'Recommended replacement every 7,500 miles' },
            { id: '5', name: 'Cabin Air Filter', category: 'Filters', compatibleWith: ['Honda Civic 2016-2022'], price: 24.99, notes: 'HEPA filter available' },
          ],
          '3': [
            { id: '6', name: 'Oil Filter', category: 'Filters', compatibleWith: ['Ford F-150 2015-2020'], price: 14.99, notes: 'Heavy duty option available' },
            { id: '7', name: 'Fuel Filter', category: 'Filters', compatibleWith: ['Ford F-150 2018-2022'], price: 29.99, notes: 'Recommended replacement every 30,000 miles' },
          ]
        };
        setCompatibleParts(mockParts);
      } finally {
        setLoading(false);
      }
    };

    const fetchCompatibleParts = async (vehicles: Vehicle[]) => {
      // In a real implementation, this would fetch compatible parts from your database
      // For now, using mock data
      const mockParts: Record<string, PartCompatibility[]> = {
        [vehicles[0].id]: [
          { id: '1', name: 'Oil Filter', category: 'Filters', compatibleWith: ['Toyota Camry 2019-2022'], price: 12.99, notes: 'Recommended replacement every 5,000 miles' },
          { id: '2', name: 'Air Filter', category: 'Filters', compatibleWith: ['Toyota Camry 2018-2022', 'Toyota Corolla 2018-2022'], price: 18.50, notes: 'Recommended replacement every 15,000 miles' },
          { id: '3', name: 'Brake Pads (Front)', category: 'Brakes', compatibleWith: ['Toyota Camry 2019-2022'], price: 45.99, notes: 'Ceramic pads, low dust' },
        ],
      };
      setCompatibleParts(mockParts);
    };

    fetchVehicles();
  }, [toast]);

  const getVehicleFullName = (vehicle: Vehicle) => {
    return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  };

  const getVehicleById = (id: string): Vehicle | undefined => {
    return vehicles.find(v => v.id === id);
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
            <Button>Add Vehicle</Button>
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


import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Vehicle } from "@/types/token";
import { supabase } from "@/integrations/supabase/client";
import { Loader } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface VehicleStepProps {
  selectedVehicleId: string | undefined;
  onVehicleSelect: (vehicleId: string | undefined) => void;
}

interface DBVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string | null;
}

// Create a mapper function to convert database vehicle to our Vehicle type
const mapToVehicle = (dbVehicle: DBVehicle): Vehicle => ({
  id: dbVehicle.id,
  make: dbVehicle.make,
  model: dbVehicle.model,
  year: dbVehicle.year,
  vin: dbVehicle.vin || undefined
});

const VehicleStep = ({
  selectedVehicleId,
  onVehicleSelect,
}: VehicleStepProps) => {
  const [searchVin, setSearchVin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [garageVehicles, setGarageVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [error, setError] = useState("");
  const [isLoadingGarage, setIsLoadingGarage] = useState(false);

  useEffect(() => {
    // If there's already a selected vehicle ID, fetch that vehicle
    if (selectedVehicleId) {
      fetchVehicleById(selectedVehicleId);
    }

    // Fetch vehicles from user's active garage
    fetchGarageVehicles();
  }, [selectedVehicleId]);

  const fetchGarageVehicles = async () => {
    setIsLoadingGarage(true);
    try {
      // First, get the active garage id from the user's profile
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error("No authenticated user");
      
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('active_garage_id')
        .eq('id', user.id)
        .single();
      
      if (profileError) throw profileError;
      
      if (!profileData.active_garage_id) {
        console.log("No active garage set");
        setGarageVehicles([]);
        return;
      }
      
      // Now fetch vehicles associated with that garage
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin')
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      if (data) {
        const typedVehicles = data.map(mapToVehicle);
        setGarageVehicles(typedVehicles);
      }
    } catch (error) {
      console.error('Error fetching garage vehicles:', error);
    } finally {
      setIsLoadingGarage(false);
    }
  };

  const fetchVehicleById = async (id: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      if (data) {
        setSelectedVehicle(mapToVehicle(data));
      }
    } catch (error) {
      console.error('Error fetching vehicle:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const searchVehicles = async () => {
    if (!searchVin.trim()) {
      setError("Please enter a VIN to search");
      return;
    }

    setIsLoading(true);
    setError("");
    
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin')
        .ilike('vin', `%${searchVin.trim()}%`)
        .limit(5);
      
      if (error) throw error;
      
      if (data) {
        const typedVehicles = data.map(mapToVehicle);
        setVehicles(typedVehicles);
        if (typedVehicles.length === 0) {
          setError("No vehicles found with that VIN");
        }
      }
    } catch (error) {
      console.error('Error searching vehicles:', error);
      setError("Failed to search for vehicles");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVehicleSelect = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    onVehicleSelect(vehicle.id);
  };

  const handleGarageVehicleSelect = (vehicleId: string) => {
    if (!vehicleId) {
      clearSelection();
      return;
    }
    
    const vehicle = garageVehicles.find(v => v.id === vehicleId);
    if (vehicle) {
      setSelectedVehicle(vehicle);
      onVehicleSelect(vehicle.id);
    }
  };

  const clearSelection = () => {
    setSelectedVehicle(null);
    onVehicleSelect(undefined);
  };

  return (
    <div className="space-y-4 py-2">
      {/* Garage Vehicles Dropdown */}
      <div className="space-y-2">
        <Label htmlFor="garage-vehicle">Select from your garage</Label>
        <Select 
          onValueChange={handleGarageVehicleSelect} 
          value={selectedVehicleId}
          disabled={isLoadingGarage}
        >
          <SelectTrigger id="garage-vehicle" className="w-full">
            <SelectValue placeholder={isLoadingGarage ? "Loading garage vehicles..." : "Select a vehicle"} />
          </SelectTrigger>
          <SelectContent>
            {garageVehicles.length === 0 ? (
              <SelectItem value="no-vehicles" disabled>
                No vehicles in garage
              </SelectItem>
            ) : (
              <>
                <SelectItem value="">Select a vehicle</SelectItem>
                {garageVehicles.map(vehicle => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.vin ? `(${vehicle.vin})` : ''}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Choose a vehicle from your garage or search by VIN below
        </p>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t"></span>
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="vehicle-search">Search for a Vehicle by VIN</Label>
        <div className="flex gap-2">
          <Input
            id="vehicle-search"
            placeholder="Enter VIN number"
            value={searchVin}
            onChange={(e) => setSearchVin(e.target.value)}
          />
          <Button 
            onClick={searchVehicles} 
            disabled={isLoading}
            type="button"
          >
            {isLoading ? <Loader className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
        <p className="text-sm text-muted-foreground">
          Link this token to a vehicle in your database by searching for its VIN
        </p>
      </div>

      {/* Display search results */}
      {vehicles.length > 0 && !selectedVehicle && (
        <div className="mt-4 space-y-2">
          <Label>Search Results</Label>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {vehicles.map(vehicle => (
              <Card 
                key={vehicle.id} 
                className="cursor-pointer hover:bg-accent"
                onClick={() => handleVehicleSelect(vehicle)}
              >
                <CardContent className="p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">VIN:</span> {vehicle.vin || "Not specified"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Display selected vehicle */}
      {selectedVehicle && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between items-center">
            <Label>Selected Vehicle</Label>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearSelection}
              type="button"
            >
              Change
            </Button>
          </div>
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Vehicle</h3>
                  <p className="font-semibold">
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">VIN</h3>
                  <p className="font-semibold">{selectedVehicle.vin || "Not specified"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default VehicleStep;

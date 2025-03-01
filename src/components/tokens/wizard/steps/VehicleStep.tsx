
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Vehicle } from "@/types/token";
import { supabase } from "@/integrations/supabase/client";
import { Loader } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface VehicleStepProps {
  selectedVehicleId: string | undefined;
  onVehicleSelect: (vehicleId: string | undefined) => void;
}

const VehicleStep = ({
  selectedVehicleId,
  onVehicleSelect,
}: VehicleStepProps) => {
  const [searchVin, setSearchVin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // If there's already a selected vehicle ID, fetch that vehicle
    if (selectedVehicleId) {
      fetchVehicleById(selectedVehicleId);
    }
  }, [selectedVehicleId]);

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
        setSelectedVehicle(data);
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
      
      setVehicles(data || []);
      if (data?.length === 0) {
        setError("No vehicles found with that VIN");
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

  const clearSelection = () => {
    setSelectedVehicle(null);
    onVehicleSelect(undefined);
  };

  return (
    <div className="space-y-4 py-2">
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


import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, Loader } from "lucide-react";
import { Vehicle } from "@/types/token";

interface VehicleSelectorProps {
  vehicles: Vehicle[];
  isLoading: boolean;
  selectedVehicle: string;
  onVehicleChange: (value: string) => void;
}

const VehicleSelector = ({ 
  vehicles, 
  isLoading, 
  selectedVehicle, 
  onVehicleChange 
}: VehicleSelectorProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Select Vehicle</label>
      <Select value={selectedVehicle} onValueChange={onVehicleChange}>
        <SelectTrigger className="transition-all duration-200 hover:border-primary">
          <SelectValue placeholder="Select a vehicle" />
        </SelectTrigger>
        <SelectContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader className="h-4 w-4 animate-spin mr-2" />
              <span>Loading vehicles...</span>
            </div>
          ) : vehicles.length > 0 ? (
            vehicles.map(vehicle => (
              <SelectItem 
                key={vehicle.id} 
                value={vehicle.id}
                className="transition-colors hover:bg-primary/10"
              >
                <div className="flex items-center">
                  <Car className="h-3 w-3 mr-2 text-muted-foreground" />
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
              </SelectItem>
            ))
          ) : (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No vehicles found
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};

export default VehicleSelector;

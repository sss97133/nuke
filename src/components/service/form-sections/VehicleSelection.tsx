import type { Database } from '../types';
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Vehicle, VehicleHistoricalData } from "@/types/inventory";

const departments = [
  "mechanical",
  "bodywork",
  "diagnostics",
  "tires",
  "detailing",
  "parts",
  "specialty",
  "quick_service",
  "metal_work",
  "paint_and_body",
  "upholstery",
  "wiring"
];

interface VehicleSelectionProps {
  onVehicleSelect: (vehicle: Vehicle | null) => void;
  onShowNewVehicle: () => void;
  onDepartmentChange: (department: string) => void;
  selectedDepartment: string;
}

export const VehicleSelection = ({
  onVehicleSelect,
  onShowNewVehicle,
  onDepartmentChange,
  selectedDepartment,
}: VehicleSelectionProps) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
          .from("vehicles")
          .select("*");

        if (error) {
          throw error;
        }

        // Transform the data to ensure historical_data is properly typed
        const transformedData = (data || []).map(vehicle => ({
          ...vehicle,
          historical_data: vehicle.historical_data as VehicleHistoricalData | null
        }));

        setVehicles(transformedData);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchVehicles();
  }, [toast]);

  const handleVehicleSelect = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    onVehicleSelect(vehicle);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Vehicle Selection</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Department</label>
          <Select value={selectedDepartment} onValueChange={onDepartmentChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => (
                <SelectItem key={dept} value={dept}>
                  {dept.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Vehicle</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between",
                  !selectedVehicle && "text-muted-foreground"
                )}
                disabled={isLoading}
              >
                {selectedVehicle
                  ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
                  : "Select vehicle..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
              <Command>
                <CommandInput 
                  placeholder="Search vehicles..." 
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandEmpty>No vehicle found.</CommandEmpty>
                <CommandGroup className="max-h-[200px] overflow-y-auto">
                  {vehicles.map((vehicle) => (
                    <CommandItem
                      key={vehicle.id}
                      value={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      onSelect={() => handleVehicleSelect(vehicle)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedVehicle?.id === vehicle.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onShowNewVehicle}
          className="mt-2"
        >
          Add New Vehicle
        </Button>
      </div>
    </div>
  );
};
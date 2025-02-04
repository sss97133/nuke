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
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Vehicle } from "@/types/inventory";

interface VehicleSelectionProps {
  onVehicleSelect: (vehicle: Vehicle | null) => void;
  onShowNewVehicle: () => void;
}

export const VehicleSelection = ({ onVehicleSelect, onShowNewVehicle }: VehicleSelectionProps) => {
  const [open, setOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchVehicles = async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*");

      if (error) {
        toast({
          title: "Error fetching vehicles",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const mappedVehicles: Vehicle[] = (data || []).map(vehicle => ({
        id: vehicle.id,
        vin: vehicle.vin || undefined,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        notes: vehicle.notes || undefined,
        images: undefined,
        createdBy: vehicle.user_id || '',
        updatedBy: vehicle.user_id || '',
        createdAt: vehicle.created_at,
        updatedAt: vehicle.updated_at
      }));

      setVehicles(mappedVehicles);
    };

    fetchVehicles();
  }, [toast]);

  const handleSelect = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    onVehicleSelect(vehicle);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[300px] justify-between"
            >
              {selectedVehicle ? 
                `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}` : 
                "Select vehicle..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <Command>
              <CommandInput placeholder="Search vehicles..." />
              <CommandEmpty>No vehicle found.</CommandEmpty>
              <CommandGroup className="max-h-[200px] overflow-y-auto">
                {vehicles.map((vehicle) => (
                  <CommandItem
                    key={vehicle.id}
                    value={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    onSelect={() => handleSelect(vehicle)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedVehicle?.id === vehicle.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          onClick={onShowNewVehicle}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add New Vehicle
        </Button>
      </div>
    </div>
  );
};
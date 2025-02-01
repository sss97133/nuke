import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle } from "@/types/inventory";
import { useNavigate } from "react-router-dom";

export const VehicleList = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

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

      // Map the Supabase data to match our frontend types
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

  const handleVehicleClick = (id: string) => {
    navigate(`/vehicles/${id}`);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto bg-[#F4F1DE] p-8 border border-[#283845]">
      <h2 className="text-2xl text-[#283845] uppercase tracking-wider text-center">Vehicle List</h2>
      <div className="grid gap-4">
        {vehicles.map((vehicle) => (
          <div
            key={vehicle.id}
            onClick={() => handleVehicleClick(vehicle.id)}
            className="p-4 border border-[#283845] bg-white hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <h3 className="font-mono text-lg">{vehicle.make} {vehicle.model} ({vehicle.year})</h3>
            <p className="text-sm text-[#9B2915]">VIN: {vehicle.vin || 'N/A'}</p>
            {vehicle.notes && <p className="mt-2 text-sm">{vehicle.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};
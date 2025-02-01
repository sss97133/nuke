import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import type { Vehicle } from "@/types/inventory";

export const VehicleList = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
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

      setVehicles(data || []);
    };

    fetchVehicles();
  }, [toast]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto bg-[#F4F1DE] p-8 border border-[#283845]">
      <h2 className="text-2xl text-[#283845] uppercase tracking-wider text-center">Vehicle List</h2>
      <div className="grid gap-4">
        {vehicles.map((vehicle) => (
          <div key={vehicle.id} className="p-4 border border-[#283845] bg-white">
            <h3 className="font-mono text-lg">{vehicle.make} {vehicle.model} ({vehicle.year})</h3>
            <p className="text-sm text-[#9B2915]">VIN: {vehicle.vin || 'N/A'}</p>
            {vehicle.notes && <p className="mt-2 text-sm">{vehicle.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};
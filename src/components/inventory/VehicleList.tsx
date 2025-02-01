import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import type { Vehicle } from "@/types/inventory";

export const VehicleList = () => {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVehicles();
  }, []);

  const fetchVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .order("createdAt", { ascending: false });

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      toast({
        title: "Error fetching vehicles",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center p-4">Loading vehicles...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-mono text-[#283845] mb-4">Vehicle List</h2>
      <div className="grid gap-4">
        {vehicles.map((vehicle) => (
          <div
            key={vehicle.id}
            className="p-4 border border-[#283845] bg-[#F4F1DE]"
          >
            <h3 className="font-mono text-lg">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h3>
            <p className="text-sm text-[#9B2915]">VIN: {vehicle.vin || "N/A"}</p>
            {vehicle.notes && (
              <p className="mt-2 text-sm">{vehicle.notes}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
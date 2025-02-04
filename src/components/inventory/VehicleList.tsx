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

      setVehicles(data as Vehicle[] || []);
    };

    fetchVehicles();
  }, [toast]);

  const handleVehicleClick = (id: string) => {
    navigate(`/vehicles/${id}`);
  };

  return (
    <div className="container mx-auto py-8">
      <div className="bg-background border border-border rounded-sm shadow-classic">
        <div className="p-6 border-b border-border">
          <h2 className="text-2xl font-system text-foreground">Vehicle List</h2>
        </div>
        <div className="p-6 space-y-4">
          {vehicles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No vehicles found
            </div>
          ) : (
            vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                onClick={() => handleVehicleClick(vehicle.id)}
                className="bg-card border border-border shadow-classic hover:bg-accent/50 
                         cursor-pointer transition-colors p-4 animate-fade-in"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-system mb-1">
                      {vehicle.make} {vehicle.model} ({vehicle.year})
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      VIN: {vehicle.vin || 'N/A'}
                    </p>
                  </div>
                  {vehicle.notes && (
                    <div className="bg-muted px-3 py-1 rounded-sm text-xs text-muted-foreground">
                      Notes
                    </div>
                  )}
                </div>
                {vehicle.notes && (
                  <p className="mt-3 text-sm text-muted-foreground border-t border-border pt-3">
                    {vehicle.notes}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
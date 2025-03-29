
import React from 'react';
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Consolidated Vehicle Management Utility
export const VehicleManagementUtils = {
  /**
   * Fetches vehicles for the current authenticated user
   * @returns Promise with user's vehicles or null
   */
  async fetchUserVehicles() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error("Authentication error:", authError);
      return null;
    }

    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching vehicles:", error);
      return null;
    }

    return vehicles;
  },

  /**
   * Adds a new vehicle with minimal required information
   * @param vehicleData Basic vehicle details
   * @returns Created vehicle or null
   */
  async addVehicle(vehicleData: {
    make: string;
    model: string;
    year: number;
    vin?: string;
  }) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error("Authentication required");
      return null;
    }

    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        ...vehicleData,
        user_id: user.id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error("Vehicle creation error:", error);
      return null;
    }

    return data;
  }
};

// Enhanced Vehicle Add Button Component
export const AddVehicleButton = React.memo(({ 
  className, 
  onVehicleAdded 
}: { 
  className?: string;
  onVehicleAdded?: (vehicle: any) => void;
}) => {
  const { toast } = useToast();

  const handleAddVehicle = async () => {
    try {
      // Example minimal vehicle data - in real scenario, this would come from a form
      const newVehicle = await VehicleManagementUtils.addVehicle({
        make: 'Tesla',
        model: 'Model 3',
        year: new Date().getFullYear()
      });

      if (newVehicle) {
        toast({
          title: "Vehicle Added",
          description: `${newVehicle.year} ${newVehicle.make} ${newVehicle.model} successfully added.`
        });
        onVehicleAdded?.(newVehicle);
      } else {
        toast({
          title: "Add Vehicle Failed",
          description: "Could not add vehicle. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Vehicle addition error:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive"
      });
    }
  };

  return (
    <Button 
      onClick={handleAddVehicle}
      className={cn(
        "flex items-center gap-2 transition-all duration-300 hover:bg-primary/90",
        className
      )}
    >
      <span>+ Add Vehicle</span>
    </Button>
  );
});

// Vehicle Collection Overview Component
export const VehicleCollectionOverview = React.memo(() => {
  const [vehicles, setVehicles] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const loadVehicles = async () => {
      const fetchedVehicles = await VehicleManagementUtils.fetchUserVehicles();
      setVehicles(fetchedVehicles || []);
      setLoading(false);
    };

    loadVehicles();
  }, []);

  if (loading) {
    return <div>Loading vehicles...</div>;
  }

  return (
    <div>
      <h2>Your Vehicles ({vehicles.length})</h2>
      {vehicles.map(vehicle => (
        <div key={vehicle.id}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>
      ))}
    </div>
  );
});

export default {
  VehicleManagementUtils,
  AddVehicleButton,
  VehicleCollectionOverview
};

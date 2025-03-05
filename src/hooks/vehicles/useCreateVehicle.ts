
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VehicleFormValues } from '@/components/vehicles/forms/types';

export function useCreateVehicle() {
  const { toast } = useToast();

  // Define the mutation for creating a vehicle
  const mutation = useMutation({
    mutationFn: async (vehicle: VehicleFormValues & { user_id: string, added: string, tags: string[] }) => {
      // Convert string values to the appropriate types
      const processedVehicle = {
        ...vehicle,
        // Convert numeric strings to numbers where appropriate
        year: vehicle.year ? parseInt(vehicle.year, 10) || null : null,
        mileage: vehicle.mileage ? parseInt(vehicle.mileage, 10) || null : null,
        purchase_price: vehicle.purchase_price ? parseFloat(vehicle.purchase_price) || null : null,
        weight: vehicle.weight ? parseFloat(vehicle.weight) || null : null,
        top_speed: vehicle.top_speed ? parseFloat(vehicle.top_speed) || null : null,
        doors: vehicle.doors ? parseInt(vehicle.doors, 10) || null : null,
        seats: vehicle.seats ? parseInt(vehicle.seats, 10) || null : null,
        
        // Add default market analysis fields - these should be calculated properly in a real app
        market_value: vehicle.purchase_price ? parseFloat(vehicle.purchase_price) * 1.1 : null,
        
        // Handle image (could be string or array)
        image: Array.isArray(vehicle.image) && vehicle.image.length > 0 ? vehicle.image[0] : 
              (typeof vehicle.image === 'string' ? vehicle.image : null),
        
        // Handle additional images if we have an array
        additional_images: Array.isArray(vehicle.image) && vehicle.image.length > 1 
          ? vehicle.image.slice(1) 
          : [],
      };

      // For now, we're mocking the database insert
      console.log('Creating vehicle with data:', processedVehicle);
      
      // In a real app, we would send to Supabase
      // const { data, error } = await supabase.from('vehicles').insert([processedVehicle]).select();
      // if (error) throw error;
      
      // Return mocked data
      return {
        id: `vehicle_${Date.now()}`,
        ...processedVehicle
      };
    },
    onSuccess: () => {
      toast({
        title: "Vehicle created",
        description: "Your vehicle has been successfully added.",
      });
    },
    onError: (error) => {
      console.error('Error creating vehicle:', error);
      toast({
        title: "Error creating vehicle",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    createVehicle: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

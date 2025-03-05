
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VehicleFormValues } from '@/components/vehicles/forms/types';
import { addStoredVehicle, addVehicleRelationship } from './mockVehicleStorage';

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

      console.log('Creating vehicle with data:', processedVehicle);
      
      // In a real app, we would send to Supabase
      // const { data, error } = await supabase.from('vehicles').insert([processedVehicle]).select();
      // if (error) throw error;
      
      // For now, use our mock storage system
      const newVehicle = addStoredVehicle({
        id: Date.now(), // Use timestamp as ID
        make: processedVehicle.make,
        model: processedVehicle.model,
        year: processedVehicle.year || new Date().getFullYear(),
        trim: processedVehicle.trim || '',
        price: processedVehicle.purchase_price ? Number(processedVehicle.purchase_price) : undefined,
        market_value: processedVehicle.market_value ? Number(processedVehicle.market_value) : undefined,
        price_trend: 'stable',
        mileage: processedVehicle.mileage ? Number(processedVehicle.mileage) : 0,
        image: processedVehicle.image || '/placeholder-vehicle.jpg',
        location: processedVehicle.location || 'Unknown',
        added: 'just now',
        tags: vehicle.tags ? vehicle.tags.split(',').map(tag => tag.trim()) : [],
        condition_rating: 7,
        vehicle_type: processedVehicle.body_style || 'car',
        body_type: processedVehicle.body_style || '',
        transmission: processedVehicle.transmission || '',
        drivetrain: processedVehicle.drivetrain || '',
        rarity_score: 5,
        era: getEraFromYear(processedVehicle.year),
        restoration_status: 'original',
        special_edition: false
      });
      
      // Create relationship between user and vehicle
      addVehicleRelationship(vehicle.user_id, newVehicle.id, 'discovered');
      
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

// Helper function to determine era from year
function getEraFromYear(year: number | null): string {
  if (!year) return '';
  
  if (year < 1950) return 'Vintage';
  if (year < 1970) return '60s';
  if (year < 1980) return '70s';
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '2000s';
  return 'Modern';
}

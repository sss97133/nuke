import type { Database } from '../types';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VehicleFormValues } from '@/components/vehicles/forms/types';

export function useCreateVehicle() {
  const { toast } = useToast();

  // Define the mutation for creating a vehicle
  const mutation = useMutation({
    mutationFn: async (vehicle: VehicleFormValues & { user_id?: string }) => {
      // Get current user if user_id not provided
      if (!vehicle.user_id) {
        const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
        if (!user) {
          throw new Error('User not authenticated');
        }
        vehicle.user_id = user.id;
      }

      // Convert string values to the appropriate types
      const processedVehicle = {
        ...vehicle,
        // Convert numeric strings to numbers where appropriate
        year: vehicle.year ? Number(vehicle.year) || null : null,
        mileage: vehicle.mileage ? Number(vehicle.mileage) || null : null,
        purchase_price: vehicle.purchase_price ? parseFloat(vehicle.purchase_price) || null : null,
        weight: vehicle.weight ? Number(vehicle.weight) || null : null,
        top_speed: vehicle.top_speed ? Number(vehicle.top_speed) || null : null,
        doors: vehicle.doors ? Number(vehicle.doors) || null : null,
        seats: vehicle.seats ? Number(vehicle.seats) || null : null,
        
        // Add timestamp for creation
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        
        // Handle tags if it's a string (convert to array)
        tags: typeof vehicle.tags === 'string' ? 
          vehicle.tags.split(',').map(tag => tag.trim()) : 
          vehicle.tags || [],
      };

      console.log('Creating vehicle with data:', processedVehicle);
      
      // Insert the vehicle into Supabase
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('vehicles')
        .insert([processedVehicle])
        .select();
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        throw new Error('Failed to create vehicle');
      }
      
      // If there are any images, save them
      if (Array.isArray(vehicle.image) && vehicle.image.length > 0) {
        const vehicleId = data[0].id;
        
        // Save each image to storage
        for (let i = 0; i < vehicle.image.length; i++) {
          const imageFile = vehicle.image[i];
          
          if (typeof imageFile === 'string' && imageFile.startsWith('data:')) {
            // It's a data URL, need to convert to file
            try {
              const res = await fetch(imageFile);
              const blob = await res.blob();
              const file = new File([blob], `vehicle-${vehicleId}-${i}.jpg`, { type: 'image/jpeg' });
              
              // Upload to Supabase storage
              const { data: uploadData, error: uploadError } = await supabase.storage
  if (error) console.error("Database query error:", error);
                .from('vehicle-images')
                .upload(`${vehicleId}/${file.name}`, file);
              
              if (uploadError) {
                console.error('Error uploading image:', uploadError);
                continue;
              }
              
              // Create record in vehicle_images table
              const { error: imageInsertError } = await supabase
  if (error) console.error("Database query error:", error);
                
                .insert([{
                  vehicle_id: vehicleId,
                  file_path: uploadData?.path,
                  is_primary: i === 0, // First image is primary
                  user_id: vehicle.user_id
                }]);
              
              if (imageInsertError) {
                console.error('Error creating image record:', imageInsertError);
              }
            } catch (err) {
              console.error('Error processing image:', err);
            }
          }
        }
      }
      
      return data[0];
    },
    onSuccess: (data, variables) => {
      const ownershipStatus = variables.ownership_status;
      let title = '';
      let description = '';
      
      switch (ownershipStatus) {
        case 'owned':
          title = "Vehicle added to your garage";
          description = "Your vehicle has been successfully added to your garage.";
          break;
        case 'claimed':
          title = "Vehicle claimed and added to your garage";
          description = "Your claimed vehicle has been added to your garage. You can verify ownership later.";
          break;
        case 'discovered':
          title = "Vehicle added to discoveries";
          description = "The discovered vehicle has been added to your discoveries list.";
          break;
      }
      
      toast({
        title,
        description
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

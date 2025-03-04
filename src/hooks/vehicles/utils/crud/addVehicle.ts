
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';

/**
 * Add a new vehicle to Supabase
 */
export const addVehicle = async (
  newVehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>, 
  session: any,
  toast: ReturnType<typeof useToast>['toast']
) => {
  try {
    if (!session) {
      toast({
        title: 'Authentication Required',
        description: 'You must be logged in to add vehicles',
        variant: 'destructive',
      });
      return null;
    }

    // Transform the vehicle object to match database schema
    // Include only the fields that actually exist in the database
    const dbVehicle = {
      make: newVehicle.make,
      model: newVehicle.model,
      year: newVehicle.year,
      price: newVehicle.price.toString(), // Convert to string for database
      location: newVehicle.location,
      image: newVehicle.image,
      mileage: newVehicle.mileage,
      user_id: session.user.id,
      source: 'manual_entry',
      // Exclude fields that don't exist in the database:
      // body_type, transmission, drivetrain, vehicle_type, rarity_score
    };

    const { data, error } = await supabase
      .from('discovered_vehicles')
      .insert(dbVehicle)
      .select();

    if (error) {
      console.error('Error adding vehicle:', error);
      toast({
        title: 'Error',
        description: `Failed to add vehicle: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    }
    
    toast({
      title: 'Success',
      description: 'Vehicle added successfully',
    });
    
    return data[0];
  } catch (err) {
    console.error('Unexpected error:', err);
    toast({
      title: 'Error',
      description: 'An unexpected error occurred while adding the vehicle',
      variant: 'destructive',
    });
    return null;
  }
};

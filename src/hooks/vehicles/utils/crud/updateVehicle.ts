
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';
import { findVehicleRealId } from './findVehicleRealId';

/**
 * Update an existing vehicle in Supabase
 */
export const updateVehicle = async (
  id: number, 
  updates: Partial<Vehicle>, 
  vehicles: Vehicle[],
  session: any,
  toast: ReturnType<typeof useToast>['toast']
) => {
  try {
    if (!session) {
      toast({
        title: 'Authentication Required',
        description: 'You must be logged in to update vehicles',
        variant: 'destructive',
      });
      return false;
    }

    // Need to find the actual UUID from our transformed ID
    const vehicleToUpdate = vehicles.find(v => v.id === id);
    if (!vehicleToUpdate) {
      toast({
        title: 'Error',
        description: 'Vehicle not found',
        variant: 'destructive',
      });
      return false;
    }

    const realId = await findVehicleRealId(vehicleToUpdate, toast);
    if (!realId) return false;

    // Clean up updates to include only fields that exist in the database
    const { 
      relevance_score, 
      added, 
      id: _id, 
      body_type,
      transmission,
      drivetrain,
      vehicle_type,
      rarity_score,
      condition_rating,
      tags,
      ...dbUpdates 
    } = updates as any;

    // Convert price to string if it exists in updates
    if (dbUpdates.price !== undefined) {
      dbUpdates.price = dbUpdates.price.toString();
    }

    const { error } = await supabase
      .from('discovered_vehicles')
      .update(dbUpdates)
      .eq('id', realId);

    if (error) {
      console.error('Error updating vehicle:', error);
      toast({
        title: 'Error',
        description: `Failed to update vehicle: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    }
    
    toast({
      title: 'Success',
      description: 'Vehicle updated successfully',
    });
    
    return true;
  } catch (err) {
    console.error('Unexpected error:', err);
    toast({
      title: 'Error',
      description: 'An unexpected error occurred while updating the vehicle',
      variant: 'destructive',
    });
    return false;
  }
};

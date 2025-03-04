
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';
import { findVehicleRealId } from './findVehicleRealId';

/**
 * Delete a vehicle from Supabase
 */
export const deleteVehicle = async (
  id: number, 
  vehicles: Vehicle[],
  session: any,
  toast: ReturnType<typeof useToast>['toast']
) => {
  try {
    if (!session) {
      toast({
        title: 'Authentication Required',
        description: 'You must be logged in to delete vehicles',
        variant: 'destructive',
      });
      return false;
    }

    // Need to find the actual UUID from our transformed ID
    const vehicleToDelete = vehicles.find(v => v.id === id);
    if (!vehicleToDelete) {
      toast({
        title: 'Error',
        description: 'Vehicle not found',
        variant: 'destructive',
      });
      return false;
    }

    const realId = await findVehicleRealId(vehicleToDelete, toast);
    if (!realId) return false;

    const { error } = await supabase
      .from('discovered_vehicles')
      .delete()
      .eq('id', realId);

    if (error) {
      console.error('Error deleting vehicle:', error);
      toast({
        title: 'Error',
        description: `Failed to delete vehicle: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    }
    
    toast({
      title: 'Success',
      description: 'Vehicle deleted successfully',
    });
    
    return true;
  } catch (err) {
    console.error('Unexpected error:', err);
    toast({
      title: 'Error',
      description: 'An unexpected error occurred while deleting the vehicle',
      variant: 'destructive',
    });
    return false;
  }
};

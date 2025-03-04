
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';
import { transformVehicleData } from './vehicleTransformers';

/**
 * Fetch vehicles from Supabase
 */
export const fetchVehicles = async (session: any, toast: ReturnType<typeof useToast>['toast']) => {
  try {
    if (!session) {
      console.log("No session found, user might not be authenticated");
      return { vehicles: [], error: null };
    }

    const { data, error } = await supabase
      .from('discovered_vehicles')
      .select('*')
      .order('created_at', { ascending: false });  // Use created_at instead of added

    if (error) {
      console.error('Error fetching vehicles:', error);
      toast({
        title: 'Error fetching vehicles',
        description: error.message,
        variant: 'destructive',
      });
      return { vehicles: [], error: error.message };
    }

    const transformedData = transformVehicleData(data || []);
    return { vehicles: transformedData, error: null };
  } catch (err: any) {
    console.error('Unexpected error:', err);
    toast({
      title: 'Error',
      description: 'Failed to load vehicles',
      variant: 'destructive',
    });
    return { vehicles: [], error: 'An unexpected error occurred' };
  }
};

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

/**
 * Find the real UUID for a vehicle based on our transformed ID
 */
export const findVehicleRealId = async (
  vehicleToFind: Vehicle,
  toast: ReturnType<typeof useToast>['toast']
) => {
  try {
    const { data: vehicleData, error: fetchError } = await supabase
      .from('discovered_vehicles')
      .select('id')
      .eq('make', vehicleToFind.make)
      .eq('model', vehicleToFind.model)
      .eq('year', vehicleToFind.year)
      .limit(1);

    if (fetchError || !vehicleData || vehicleData.length === 0) {
      console.error('Error finding vehicle:', fetchError);
      toast({
        title: 'Error',
        description: 'Could not find vehicle',
        variant: 'destructive',
      });
      return null;
    }

    return vehicleData[0].id;
  } catch (err) {
    console.error('Error finding vehicle:', err);
    return null;
  }
};

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

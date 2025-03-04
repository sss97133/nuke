
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Vehicle, SortField, SortDirection } from '@/components/vehicles/discovery/types';
import { useAuthState } from '@/hooks/auth/use-auth-provider';

export function useSupabaseVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { session } = useAuthState();

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!session) {
        console.log("No session found, user might not be authenticated");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('discovered_vehicles')
        .select('*')
        .order('added', { ascending: false });

      if (error) {
        console.error('Error fetching vehicles:', error);
        setError(error.message);
        toast({
          title: 'Error fetching vehicles',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      // Transform the data to match our Vehicle type
      const transformedData: Vehicle[] = data.map(item => ({
        id: parseInt(item.id.toString().replace(/-/g, '').substring(0, 9), 16), // Convert UUID to numeric ID
        make: item.make,
        model: item.model,
        year: item.year,
        price: item.price || 0,
        market_value: item.market_value || 0,
        price_trend: item.price_trend as 'up' | 'down' | 'stable' || 'stable',
        mileage: item.mileage || 0,
        image: item.image || '/placeholder.svg',
        location: item.location || 'Unknown',
        added: formatAddedDate(item.added || item.created_at),
        tags: item.tags || [],
        condition_rating: item.condition_rating || 5,
        vehicle_type: item.vehicle_type || 'car',
        body_type: item.body_type || '',
        transmission: item.transmission || '',
        drivetrain: item.drivetrain || '',
        rarity_score: item.rarity_score || 0,
        relevance_score: 50 // Default value
      }));

      setVehicles(transformedData);
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('An unexpected error occurred');
      toast({
        title: 'Error',
        description: 'Failed to load vehicles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, [session?.user?.id]);

  // Create, update and delete functions
  const addVehicle = async (newVehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>) => {
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
      const dbVehicle = {
        make: newVehicle.make,
        model: newVehicle.model,
        year: newVehicle.year,
        price: newVehicle.price,
        market_value: newVehicle.market_value,
        price_trend: newVehicle.price_trend,
        mileage: newVehicle.mileage,
        image: newVehicle.image,
        location: newVehicle.location,
        tags: newVehicle.tags,
        condition_rating: newVehicle.condition_rating,
        vehicle_type: newVehicle.vehicle_type,
        body_type: newVehicle.body_type,
        transmission: newVehicle.transmission,
        drivetrain: newVehicle.drivetrain,
        rarity_score: newVehicle.rarity_score,
        user_id: session.user.id,
        source: 'manual_entry'
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

      // Refresh the vehicle list
      fetchVehicles();
      
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

  const updateVehicle = async (id: number, updates: Partial<Vehicle>) => {
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

      // Remove fields that don't exist in the database or shouldn't be updated
      const { relevance_score, added, id: _id, ...dbUpdates } = updates as any;

      // Get the vehicle data from Supabase to get the real UUID
      const { data: vehicleData, error: fetchError } = await supabase
        .from('discovered_vehicles')
        .select('id')
        .eq('make', vehicleToUpdate.make)
        .eq('model', vehicleToUpdate.model)
        .eq('year', vehicleToUpdate.year)
        .limit(1);

      if (fetchError || !vehicleData || vehicleData.length === 0) {
        console.error('Error finding vehicle to update:', fetchError);
        toast({
          title: 'Error',
          description: 'Could not find vehicle to update',
          variant: 'destructive',
        });
        return false;
      }

      const realId = vehicleData[0].id;

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

      // Refresh the vehicle list
      fetchVehicles();
      
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

  const deleteVehicle = async (id: number) => {
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

      // Get the vehicle data from Supabase to get the real UUID
      const { data: vehicleData, error: fetchError } = await supabase
        .from('discovered_vehicles')
        .select('id')
        .eq('make', vehicleToDelete.make)
        .eq('model', vehicleToDelete.model)
        .eq('year', vehicleToDelete.year)
        .limit(1);

      if (fetchError || !vehicleData || vehicleData.length === 0) {
        console.error('Error finding vehicle to delete:', fetchError);
        toast({
          title: 'Error',
          description: 'Could not find vehicle to delete',
          variant: 'destructive',
        });
        return false;
      }

      const realId = vehicleData[0].id;

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

      // Refresh the vehicle list
      fetchVehicles();
      
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

  // Helper function to format the added date relative to now (e.g., "5 days ago")
  const formatAddedDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return '1 day ago';
    } else {
      return `${diffDays} days ago`;
    }
  };

  return {
    vehicles,
    loading,
    error,
    fetchVehicles,
    addVehicle,
    updateVehicle,
    deleteVehicle
  };
}

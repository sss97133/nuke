
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useAuthState } from '@/hooks/auth/use-auth-provider';
import { 
  fetchVehicles, 
  addVehicle as addVehicleToSupabase, 
  updateVehicle as updateVehicleInSupabase,
  deleteVehicle as deleteVehicleFromSupabase
} from './utils/vehicleCrudOperations';

export function useSupabaseVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { session } = useAuthState();

  const fetchVehiclesData = async () => {
    try {
      setLoading(true);
      setError(null);

      const { vehicles: fetchedVehicles, error: fetchError } = await fetchVehicles(session, toast);
      
      if (fetchError) {
        setError(fetchError);
        return;
      }

      setVehicles(fetchedVehicles);
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
    fetchVehiclesData();
  }, [session?.user?.id]);

  // Wrapper for add vehicle operation
  const addVehicle = async (newVehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>) => {
    const result = await addVehicleToSupabase(newVehicle, session, toast);
    if (result) {
      fetchVehiclesData(); // Refresh the vehicle list
    }
    return result;
  };

  // Wrapper for update vehicle operation
  const updateVehicle = async (id: number, updates: Partial<Vehicle>) => {
    const success = await updateVehicleInSupabase(id, updates, vehicles, session, toast);
    if (success) {
      fetchVehiclesData(); // Refresh the vehicle list
    }
    return success;
  };

  // Wrapper for delete vehicle operation
  const deleteVehicle = async (id: number) => {
    const success = await deleteVehicleFromSupabase(id, vehicles, session, toast);
    if (success) {
      fetchVehiclesData(); // Refresh the vehicle list
    }
    return success;
  };

  return {
    vehicles,
    loading,
    error,
    fetchVehicles: fetchVehiclesData,
    addVehicle,
    updateVehicle,
    deleteVehicle
  };
}

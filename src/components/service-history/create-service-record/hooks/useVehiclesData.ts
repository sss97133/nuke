import { useState, useEffect, useCallback } from 'react';
import { supabase } from './__mocks__/supabase-client';
import { useToast } from './__mocks__/use-toast';
import { Vehicle } from '../types';
import { PostgrestError } from '@supabase/supabase-js';

export const useVehiclesData = () => {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  const fetchVehicles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year');
      
      if (error) throw error;
      
      // Ensure we have properly typed Vehicle objects
      const typedVehicles: Vehicle[] = (data || []).map((vehicle: any) => ({
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year
      }));
      
      setVehicles(typedVehicles);
    } catch (err) {
      const error = err as PostgrestError;
      console.error('Error fetching vehicles:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load vehicles. Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setVehiclesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  return { vehicles, vehiclesLoading };
};

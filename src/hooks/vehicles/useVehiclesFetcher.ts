import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Database } from '@/types/supabase';
import { Vehicle } from '@/types/vehicle';
import { adaptVehicleFromDB } from './utils';
import { Session } from '@supabase/supabase-js';

export function useVehiclesFetcher(
  vehicleStatus: 'discovered' | 'owned', 
  session: Session | null,
  sortField: string,
  sortDirection: string
) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchVehicles = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log(`Fetching ${vehicleStatus} vehicles...`);
      
      // Get authenticated user
      const userId = session?.user?.id;
      
      if (!userId) {
        console.log('User not authenticated');
        setVehicles([]);
        setIsLoading(false);
        return;
      }
      
      try {
        // Build query based on vehicle status
        let query = supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', userId);
          
        if (vehicleStatus === 'owned') {
          query = query.eq('ownership_status', 'owned');
        } else {
          query = query.eq('ownership_status', 'discovered');
        }
        
        // Add sorting if specified
        if (sortField && sortDirection) {
          query = query.order(sortField, { ascending: sortDirection === 'asc' });
        }
        
        const { data, error: fetchError } = await query;
        
        if (fetchError) {
          throw fetchError;
        }
        
        const adaptedVehicles = data.map(adaptVehicleFromDB);
        setVehicles(adaptedVehicles);
      } catch (err) {
        console.error(`Error fetching ${vehicleStatus} vehicles:`, err);
        setError(err instanceof Error ? err : new Error(`Failed to fetch ${vehicleStatus} vehicles`));
        setVehicles([]);
      }
    } catch (err: unknown) {
      console.error(`Error in fetchVehicles:`, err);
      setError(err instanceof Error ? err : new Error(`Failed to fetch ${vehicleStatus} vehicles`));
      setVehicles([]);
    } finally {
      setIsLoading(false);
    }
  }, [session, sortField, sortDirection, vehicleStatus]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  return {
    vehicles,
    isLoading,
    error
  };
}

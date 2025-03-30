import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Database } from '@/types/supabase';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { adaptVehicleFromDB } from './utils';
import { Session, PostgrestError } from '@supabase/supabase-js';
import { SortDirection, SortField } from '@/components/vehicles/discovery/types';

type DbVehicle = Database['public']['Tables']['vehicles']['Row'];

export function useVehiclesFetcher(
  vehicleStatus: 'discovered' | 'owned', 
  session: Session | null,
  sortField: SortField,
  sortDirection: SortDirection
) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<PostgrestError | null>(null);

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
          setError(fetchError);
          console.error(`Error fetching ${vehicleStatus} vehicles:`, fetchError);
          setVehicles([]);
          return;
        }
        
        if (!data) {
          setVehicles([]);
          return;
        }

        const adaptedVehicles = data.map((vehicle: DbVehicle) => adaptVehicleFromDB(vehicle));
        setVehicles(adaptedVehicles);
      } catch (err) {
        const error = err as Error;
        console.error(`Error fetching ${vehicleStatus} vehicles:`, error);
        setError(new PostgrestError({
          message: error.message,
          details: '',
          hint: '',
          code: 'PGRST116'
        }));
        setVehicles([]);
      }
    } catch (err) {
      const error = err as Error;
      console.error(`Error in fetchVehicles:`, error);
      setError(new PostgrestError({
        message: error.message,
        details: '',
        hint: '',
        code: 'PGRST116'
      }));
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

// Helper to determine the "era" based on year
const determineEra = (year: number): string => {
  if (!year) return '';
  
  if (year < 1920) return 'pre-war';
  if (year < 1930) return '20s';
  if (year < 1940) return '30s';
  if (year < 1950) return '40s';
  if (year < 1960) return '50s';
  if (year < 1970) return '60s';
  if (year < 1980) return '70s';
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '00s';
  if (year < 2020) return '10s';
  
  return 'modern';
};

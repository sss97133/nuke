
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '../../components/vehicles/discovery/types';
import { adaptVehicleFromDB, USE_REAL_DATA } from './utils';
import { getStoredVehicles, getVehiclesByRelationship } from './mockVehicleStorage';

export function useVehiclesFetcher(
  vehicleStatus: 'discovered' | 'owned', 
  session: any,
  sortField: string,
  sortDirection: string
) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchVehicles() {
      try {
        setIsLoading(true);
        console.log(`Fetching ${vehicleStatus} vehicles...`);
        
        if (USE_REAL_DATA.vehicles) {
          // Try to get authenticated user
          const userId = session?.user?.id;
          
          if (!userId) {
            console.log('User not authenticated, using mock data');
            if (isMounted) {
              // Use getStoredVehicles to get mock vehicles based on status
              const mockVehicles = getStoredVehicles().filter(v => v.status === vehicleStatus);
              console.log(`Loaded mock ${vehicleStatus} vehicles:`, mockVehicles.length);
              setVehicles(mockVehicles);
              setIsLoading(false);
            }
            return;
          }
          
          try {
            // Mock implementation using our in-memory storage
            const relationshipType = vehicleStatus === 'owned' ? 'claimed' : 'discovered';
            const filteredVehicles = getVehiclesByRelationship(userId, relationshipType);
            if (isMounted) {
              setVehicles(filteredVehicles);
            }
          } catch (err) {
            console.error(`Error fetching ${vehicleStatus} relationships:`, err);
            if (isMounted) {
              setError(`Failed to fetch ${vehicleStatus} vehicle relationships`);
              
              // Fall back to mock data
              const relationshipType = vehicleStatus === 'owned' ? 'claimed' : 'discovered';
              const mockVehicles = getVehiclesByRelationship('mock-user-1', relationshipType);
              console.log(`Loaded mock ${vehicleStatus} vehicles (fallback):`, mockVehicles.length);
              setVehicles(mockVehicles);
            }
          }
        } else {
          // Use mock data directly when feature flag is off
          if (isMounted) {
            // Use mock data with relationship filter
            const relationshipType = vehicleStatus === 'owned' ? 'claimed' : 'discovered';
            const mockVehicles = getVehiclesByRelationship('mock-user-1', relationshipType);
            console.log(`Loaded mock ${vehicleStatus} vehicles:`, mockVehicles.length);
            setVehicles(mockVehicles);
          }
        }
      } catch (err: any) {
        console.error(`Error fetching ${vehicleStatus} vehicles:`, err);
        
        if (isMounted) {
          // Set error message
          setError(err.message || `Failed to fetch ${vehicleStatus} vehicles`);
          
          // Fall back to mock data
          const relationshipType = vehicleStatus === 'owned' ? 'claimed' : 'discovered';
          const mockVehicles = getVehiclesByRelationship('mock-user-1', relationshipType);
          console.log(`Loaded mock ${vehicleStatus} vehicles (fallback):`, mockVehicles.length);
          setVehicles(mockVehicles);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    
    fetchVehicles();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [session, sortField, sortDirection, vehicleStatus]);

  return {
    vehicles,
    isLoading,
    error
  };
}

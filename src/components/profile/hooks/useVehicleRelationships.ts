import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type VehicleRelationshipType = 'discovered' | 'claimed' | 'verified';

export interface VehicleRelationship {
  id: string;
  userId: string;
  vehicleId: string;
  relationshipType: VehicleRelationshipType;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  image_url?: string;
  status?: string;
  relationship?: VehicleRelationshipType;
}

export const useVehicleRelationships = (userId?: string) => {
  const [vehicles, setVehicles] = useState<{
    discovered: Vehicle[];
    claimed: Vehicle[];
    verified: Vehicle[];
    all: Vehicle[];
  }>({
    discovered: [],
    claimed: [],
    verified: [],
    all: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchVehicleRelationships = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get all relationships for this user
        const { data: relationships, error: relationshipsError } = await supabase
          .from('vehicle_relationships')
          .select('*')
          .eq('user_id', userId);

        if (relationshipsError) throw relationshipsError;

        if (relationships && relationships.length > 0) {
          // Get all the vehicle ids
          const vehicleIds = relationships.map(rel => rel.vehicle_id);
          
          // Fetch the vehicles
          const { data: vehiclesData, error: vehiclesError } = await supabase
            .from('vehicles')
            .select('*')
            .in('id', vehicleIds);
            
          if (vehiclesError) throw vehiclesError;
          
          // Map vehicles to their relationship types
          const vehicleMap = new Map<string, Vehicle & { relationship: VehicleRelationshipType }>();
          
          if (vehiclesData) {
            vehiclesData.forEach(vehicle => {
              const relationship = relationships.find(rel => rel.vehicle_id === vehicle.id);
              if (relationship) {
                vehicleMap.set(vehicle.id, {
                  ...vehicle,
                  relationship: relationship.relationship_type as VehicleRelationshipType
                });
              }
            });
          }
          
          // Organize by relationship type
          const discovered: Vehicle[] = [];
          const claimed: Vehicle[] = [];
          const verified: Vehicle[] = [];
          const all: Vehicle[] = [];
          
          vehicleMap.forEach(vehicle => {
            all.push(vehicle);
            
            if (vehicle.relationship === 'discovered') {
              discovered.push(vehicle);
            } else if (vehicle.relationship === 'claimed') {
              claimed.push(vehicle);
            } else if (vehicle.relationship === 'verified') {
              verified.push(vehicle);
            }
          });
          
          setVehicles({
            discovered,
            claimed,
            verified,
            all
          });
        }
      } catch (err) {
        console.error('Error fetching vehicle relationships:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    };

    fetchVehicleRelationships();
  }, [userId]);

  return {
    vehicles,
    isLoading,
    error,
    refetch: () => {
      setIsLoading(true);
      setError(null);
      // Trigger re-render which will call the useEffect again
    }
  };
};

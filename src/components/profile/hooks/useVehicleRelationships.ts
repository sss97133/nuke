
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Types for vehicle relationships
interface VehicleRelationship {
  id: string;
  vehicle_id: string;
  user_id: string;
  relationship_type: 'owned' | 'discovered' | 'claimed';
  created_at: string;
}

interface RelatedVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  relationship_type: 'owned' | 'discovered' | 'claimed';
}

export function useVehicleRelationships(userId: string) {
  const [relationships, setRelationships] = useState<RelatedVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRelationships = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // For now, we'll just fetch vehicles and simulate relationships
        // Until the actual vehicle_relationships table is created
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, year, status')
          .eq('user_id', userId);
        
        if (error) throw error;
        
        // Transform vehicles into relationships
        const vehicleRelationships: RelatedVehicle[] = data.map(vehicle => ({
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          relationship_type: (vehicle.status as 'owned' | 'discovered' | 'claimed') || 'discovered'
        }));
        
        setRelationships(vehicleRelationships);
      } catch (err) {
        console.error("Error fetching vehicle relationships:", err);
        setError("Failed to load vehicle relationships");
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchRelationships();
  }, [userId]);
  
  return {
    relationships,
    isLoading,
    error
  };
}

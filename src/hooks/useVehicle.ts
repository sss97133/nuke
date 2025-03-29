import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  images?: string[];
  created_at: string;
  updated_at: string;
}

export const useVehicle = (id: string | undefined) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchVehicle = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          throw error;
        }

        setVehicle(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch vehicle'));
      } finally {
        setLoading(false);
      }
    };

    fetchVehicle();
  }, [id]);

  return { vehicle, loading, error };
}; 
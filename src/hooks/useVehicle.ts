import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PostgrestError } from '@supabase/supabase-js';

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
  const [error, setError] = useState<PostgrestError | null>(null);

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
          setError(error);
          console.error('Error fetching vehicle:', error);
          return;
        }

        setVehicle(data);
      } catch (err) {
        const error = err as Error;
        console.error('Unexpected error fetching vehicle:', error);
        setError(new PostgrestError({
          message: error.message,
          details: '',
          hint: '',
          code: 'PGRST116'
        }));
      } finally {
        setLoading(false);
      }
    };

    fetchVehicle();
  }, [id]);

  return { vehicle, loading, error };
}; 
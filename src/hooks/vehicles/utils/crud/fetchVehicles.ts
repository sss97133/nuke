
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';
import { transformVehicleData } from '../vehicleTransformers';

/**
 * Fetch vehicles from Supabase
 */
export const fetchVehicles = async (session: any, toast: ReturnType<typeof useToast>['toast']) => {
  try {
    if (!session) {
      console.log("No session found, user might not be authenticated");
      return { vehicles: [], error: null };
    }

    const { data, error } = await supabase
      .from('discovered_vehicles')
      .select('*')
      .order('created_at', { ascending: false });  // Use created_at instead of added

    if (error) {
      console.error('Error fetching vehicles:', error);
      toast({
        title: 'Error fetching vehicles',
        description: error.message,
        variant: 'destructive',
      });
      return { vehicles: [], error: error.message };
    }

    const transformedData = transformVehicleData(data || []);
    return { vehicles: transformedData, error: null };
  } catch (err: any) {
    console.error('Unexpected error:', err);
    toast({
      title: 'Error',
      description: 'Failed to load vehicles',
      variant: 'destructive',
    });
    return { vehicles: [], error: 'An unexpected error occurred' };
  }
};


import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { useToast } from '@/hooks/use-toast';

/**
 * Find the real UUID for a vehicle based on our transformed ID
 */
export const findVehicleRealId = async (
  vehicleToFind: Vehicle,
  toast: ReturnType<typeof useToast>['toast']
) => {
  try {
    const { data: vehicleData, error: fetchError } = await supabase
      .from('discovered_vehicles')
      .select('id')
      .eq('make', vehicleToFind.make)
      .eq('model', vehicleToFind.model)
      .eq('year', vehicleToFind.year)
      .limit(1);

    if (fetchError || !vehicleData || vehicleData.length === 0) {
      console.error('Error finding vehicle:', fetchError);
      toast({
        title: 'Error',
        description: 'Could not find vehicle',
        variant: 'destructive',
      });
      return null;
    }

    return vehicleData[0].id;
  } catch (err) {
    console.error('Error finding vehicle:', err);
    return null;
  }
};

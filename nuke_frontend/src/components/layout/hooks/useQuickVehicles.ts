import { useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';

export type QuickVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string;
  thumbnail: string | null;
};

export function useQuickVehicles() {
  const [vehicles, setVehicles] = useState<QuickVehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (userId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const { data: rpcData, error } = await supabase
        .rpc('get_user_vehicle_relationships', { p_user_id: userId });

      if (error) throw error;

      const vehicleMap = new Map<string, QuickVehicle>();
      const addVehicles = (list: any[]) => {
        list?.forEach((v: any) => {
          if (v?.id && !vehicleMap.has(v.id)) {
            vehicleMap.set(v.id, {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              title: [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
              thumbnail: v.primary_image_url || v.primaryImageUrl || null
            });
          }
        });
      };

      if (rpcData) {
        addVehicles(rpcData.user_added_vehicles || []);
        addVehicles(rpcData.verified_ownerships || []);
        addVehicles(rpcData.permission_ownerships || []);
        addVehicles(rpcData.discovered_vehicles || []);
      }

      const sorted = Array.from(vehicleMap.values()).sort((a, b) => {
        if (a.year && b.year) return b.year - a.year;
        if (a.year) return -1;
        if (b.year) return 1;
        return (a.title || '').localeCompare(b.title || '');
      });

      setVehicles(sorted);
    } catch {
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return { vehicles, loading, load };
}

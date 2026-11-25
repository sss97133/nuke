import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { readPhysicalHarnessModel, type PhysicalHarnessModel } from './physicalHarnessModel';

interface Read { vehicleId?: string; model: PhysicalHarnessModel | null; error: string | null; loaded: boolean }
const EMPTY: Read = { model: null, error: null, loaded: false };
export function usePhysicalHarnessModel(vehicleId: string | undefined): Read {
  const [read, setRead] = useState<Read>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    setRead({ ...EMPTY, vehicleId });
    if (!vehicleId) return;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('harness_schematic_model', { p_vehicle_id: vehicleId });
        if (error) throw error;
        const model = readPhysicalHarnessModel(data, vehicleId);
        if (!cancelled) setRead({ vehicleId, model, loaded: true, error: null });
      } catch {
        if (!cancelled) setRead({ vehicleId, model: null, loaded: true,
          error: 'The physical wiring model could not be read. Reload to try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);
  return read.vehicleId === vehicleId ? read : EMPTY;
}

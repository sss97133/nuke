import { useCallback, useEffect, useState } from 'react';
import { arr, obj, str, type JsonObject } from './jobRead';
import { readJob } from './readJob';

/** One read for every job on a vehicle, keyed by work order. */
export function useVehiclePublication(vehicleId: string, refreshKey?: unknown) {
  const [rows, setRows] = useState<Map<string, JsonObject>>(new Map());
  const load = useCallback(() => {
    readJob('vehicle_work_publication_read', { p_vehicle_id: vehicleId }).then(l => {
      const m = new Map<string, JsonObject>();
      if (l.status === 'loaded') for (const r of arr(l.data.rows).map(obj)) if (r && str(r.work_order_id)) m.set(str(r.work_order_id)!, r);
      setRows(m);
    });
  }, [vehicleId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  return { get: (id: string) => rows.get(id) ?? null, reload: load };
}


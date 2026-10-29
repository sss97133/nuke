import { useCallback, useEffect, useRef, useState } from 'react';
import { arr, obj, str, type JsonObject } from './jobRead';
import { readJob } from './readJob';

/** One read for every job on a vehicle, keyed by work order. */
export function useVehiclePublication(vehicleId: string, refreshKey?: unknown) {
  const [rows, setRows] = useState<Map<string, JsonObject>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(() => {
    const request = ++generation.current;
    setLoading(true); setError(null); setRows(new Map());
    void readJob('vehicle_work_publication_read', { p_vehicle_id: vehicleId }).then(result => {
      if (generation.current !== request) return;
      const next = new Map<string, JsonObject>();
      if (result.status === 'loaded' && Array.isArray(result.data.rows)) {
        for (const row of arr(result.data.rows).map(obj)) if (row && str(row.work_order_id)) next.set(str(row.work_order_id)!, row);
      } else setError(result.status === 'failed' ? result.reason : 'The publication response was incomplete.');
      setRows(next); setLoading(false);
    });
  }, [vehicleId]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load, refreshKey]);
  return { get: (id: string) => rows.get(id) ?? null, reload: load, loading, error };
}

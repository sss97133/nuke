import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { readPhysicalWorkspace, type PhysicalWorkspace } from './physicalWorkspaceModel';

export function usePhysicalWorkspace(vehicleId: string | undefined, readerUserId: string | null = null) {
  const [attempt, setAttempt] = useState(0);
  const readKey = `${vehicleId ?? ''}:${readerUserId ?? 'visitor'}`;
  const [state, setState] = useState<{ data: PhysicalWorkspace | null; loading: boolean; error: string | null; readKey: string }>({ data: null, loading: true, error: null, readKey });
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, readKey });
    if (!vehicleId) {
      setState({ data: null, loading: false, error: 'A vehicle is required to read its harness.', readKey });
      return;
    }
    (async () => {
      try {
        const result = await supabase.rpc('harness_schematic_model', { p_vehicle_id: vehicleId });
        if (result.error) throw new Error(result.error.message);
        const data = readPhysicalWorkspace(result.data, vehicleId);
        if (!cancelled) setState({ data, loading: false, error: null, readKey });
      } catch (error) {
        if (!cancelled) setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'The harness could not be read.', readKey });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId, readKey, attempt]);
  // Never render the previous subject during the effect's first paint.
  const sameRead = state.readKey === readKey;
  return { ...state, data: sameRead && state.data?.vehicle_id === vehicleId ? state.data : null,
    loading: !sameRead || state.loading, error: sameRead ? state.error : null, refresh };
}

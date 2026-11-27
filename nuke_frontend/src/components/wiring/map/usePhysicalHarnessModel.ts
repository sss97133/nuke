import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../hooks/useAuth';
import { readPhysicalSourceWorkspace, type PhysicalHarnessModel } from './physicalHarnessModel';

interface Read { vehicleId?: string; viewerId?: string | null; model: PhysicalHarnessModel | null; error: string | null; loaded: boolean; refreshing: boolean }
const EMPTY: Read = { model: null, error: null, loaded: false, refreshing: false };
export function usePhysicalHarnessModel(vehicleId: string | undefined): Read {
  const { session } = useAuth();
  const viewerId: string | null = session?.user?.id ?? null;
  const [read, setRead] = useState<Read>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let controller: AbortController | null = null;
    setRead({ ...EMPTY, vehicleId, viewerId });
    if (!vehicleId) return;
    const refresh = async () => {
      if (cancelled || pending || document.visibilityState === 'hidden') return;
      pending = true;
      controller = new AbortController();
      const deadline = window.setTimeout(() => controller?.abort(), 20000);
      setRead(previous => ({ ...previous, refreshing: true }));
      try {
        const { data, error } = await supabase.rpc('harness_source_workspace', { p_vehicle_id: vehicleId }).abortSignal(controller.signal);
        if (error) throw error;
        const model = readPhysicalSourceWorkspace(data, vehicleId);
        if (!cancelled) setRead({ vehicleId, viewerId, model, loaded: true, refreshing: false, error: null });
      } catch {
        if (!cancelled) setRead({ vehicleId, viewerId, model: null, loaded: true, refreshing: false,
          error: 'The physical wiring model could not be read. Reload to try again.' });
      } finally {
        window.clearTimeout(deadline);
        pending = false;
      }
    };
    const recheck = () => { void refresh(); };
    recheck();
    // The raw source includes fields outside the evaluation cursor. Recheck
    // actual content instead of claiming that cursor covers every source field.
    const timer = window.setInterval(recheck, 60000);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      cancelled = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [vehicleId, viewerId]);
  return read.vehicleId === vehicleId && read.viewerId === viewerId ? read : EMPTY;
}

// connector-inspector/useBuildState.ts — build_state workflow map for the
// BUILD skin. Reads vehicle_custom_circuits keyed on (overlay_id, circuit_code),
// advances states optimistically, persists via the scoped client write path
// (column-level GRANT UPDATE (build_state) — migration
// 2026-06-11_custom_circuits_build_state_client_write.sql; receipt
// docs/wiring/receipts/2026-06-10_connector-inspector-skins.md).
// build_state is mutable workflow state per WIRING_SUBSTRATE_V2_SPEC.md,
// NOT testimony — this is the one column the browser may write.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export const BUILD_STATES = ['uncut', 'cut', 'terminated_a', 'terminated_b', 'routed', 'verified'] as const;
export type BuildState = typeof BUILD_STATES[number];

export const BUILD_STATE_LABELS: Record<BuildState, string> = {
  uncut: 'UNCUT', cut: 'CUT', terminated_a: 'TERM A',
  terminated_b: 'TERM B', routed: 'ROUTED', verified: 'VERIFIED',
};

// Build-state COLORS live in colorways.ts (per-colorway `buildState` token) —
// no chrome hex in this file; it owns workflow state, not presentation.

export function stateIndex(s: BuildState | undefined): number {
  return Math.max(0, BUILD_STATES.indexOf(s ?? 'uncut'));
}

export interface BuildStateApi {
  states: Record<string, BuildState>;
  loaded: boolean;
  overlayId: string | null;
  pending: Set<string>;
  toast: string | null;
  clearToast: () => void;
  setState: (circuitCode: string, next: BuildState) => void;
  advance: (circuitCode: string) => void;
}

export function useBuildState(vehicleId: string | undefined): BuildStateApi {
  const [states, setStates] = useState<Record<string, BuildState>>({});
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!vehicleId) { setLoaded(true); return; }
      const { data: ov } = await supabase
        .from('vehicle_wiring_overlays')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!ov?.id) { setLoaded(true); return; }
      setOverlayId(ov.id as string);
      const { data } = await supabase
        .from('vehicle_custom_circuits')
        .select('circuit_code, build_state')
        .eq('overlay_id', ov.id)
        .limit(1000);
      if (cancelled) return;
      const map: Record<string, BuildState> = {};
      for (const row of data || []) {
        map[(row as { circuit_code: string }).circuit_code] =
          (row as { build_state: BuildState }).build_state;
      }
      setStates(map);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const setState = useCallback((circuitCode: string, next: BuildState) => {
    const prev = statesRef.current[circuitCode] ?? 'uncut';
    if (prev === next) return;
    // optimistic
    setStates(s => ({ ...s, [circuitCode]: next }));
    setPending(p => new Set(p).add(circuitCode));
    (async () => {
      let failure: string | null = null;
      if (!overlayId) {
        failure = 'no wiring overlay for this vehicle';
      } else {
        const { data, error } = await supabase
          .from('vehicle_custom_circuits')
          .update({ build_state: next })
          .eq('overlay_id', overlayId)
          .eq('circuit_code', circuitCode)
          .select('circuit_code');
        if (error) failure = error.message;
        else if (!data || data.length === 0) failure = 'no DB row for this circuit (write blocked or not ingested)';
      }
      setPending(p => { const n = new Set(p); n.delete(circuitCode); return n; });
      if (failure) {
        setStates(s => ({ ...s, [circuitCode]: prev })); // revert
        setToast(`#${circuitCode} → ${BUILD_STATE_LABELS[next]} NOT SAVED — ${failure}`);
      }
    })();
  }, [overlayId]);

  const advance = useCallback((circuitCode: string) => {
    const i = stateIndex(statesRef.current[circuitCode]);
    if (i < BUILD_STATES.length - 1) setState(circuitCode, BUILD_STATES[i + 1]);
  }, [setState]);

  const clearToast = useCallback(() => setToast(null), []);

  return { states, loaded, overlayId, pending, toast, clearToast, setState, advance };
}

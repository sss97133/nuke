import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface WorthEnginePayload {
  vehicle: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    color: string | null;
    vin: string | null;
  };
  substrate: {
    atoms: number;
    images: number;
    first_photo: string | null;
    last_photo: string | null;
    work_sessions: number;
    work_sessions_independent: number;
    total_min_clamped: number;
    burst_active_min: number;
  };
  inferred_value: {
    v1_time_span_clamped_USD: number;
    v2_photo_count_USD: number;
    v3_burst_active_USD: number;
    v1_available: boolean;
    v1_independent: boolean;
    v2_available: boolean;
    v3_available: boolean;
    available_method_count: number;
    baseline_backfill_sessions: number;
    v2_v3_ratio: number;
    convergent_pair_count: number;
    range_low_USD: number;
    range_high_USD: number;
  };
  documented_costs: {
    parts: number;
    payments_out: number;
    total_documented: number;
  };
  market_value_trajectory: any[];
  latest_market_mid_USD: number | null;
  pushes: any[];
  open_substrate_gaps: string[];
  warnings: string[];
  existence_confidence: 'zero' | 'low' | 'moderate' | 'high';
  magnitude_confidence: 'no_methods' | 'single_method' | 'tight' | 'bracketed' | 'wide_bracket';
  methodology_note: string;
  error?: string;
}

export function useWorthEngine(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['worth-engine', vehicleId],
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WorthEnginePayload | null> => {
      if (!vehicleId) return null;
      const { data, error } = await supabase.rpc('vehicle_full_picture', { p_vehicle_id: vehicleId });
      if (error) throw error;
      return data as WorthEnginePayload;
    },
  });
}

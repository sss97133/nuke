/**
 * useEyeRead — the evidence-graded appraisal header (vehicle_condition_scores).
 *
 * The band the evidence defends, plus condition class/score, frame count, method
 * and the read date. When a band exists it OWNS the value story; the model
 * estimate is demoted (valuation-block doctrine). Consumed by VehicleBriefing
 * (headline) and the dossier page.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export interface EyeRead {
  band: [number, number] | null;
  conditionClass: string | null;
  tier: string;
  score: number;
  frames: number | null;
  method: string;
  computedAt: string;
}

export function useEyeRead(vehicleId: string | undefined): EyeRead | null {
  const [read, setRead] = useState<EyeRead | null>(null);
  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    supabase
      .from('vehicle_condition_scores')
      .select('condition_score, condition_tier, descriptor_summary, observation_count, computed_at, computation_version')
      .eq('vehicle_id', vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        const ds: any = data.descriptor_summary || {};
        const band = Array.isArray(ds.as_is_band_usd) && ds.as_is_band_usd[0] != null
          ? [Number(ds.as_is_band_usd[0]), Number(ds.as_is_band_usd[1])] as [number, number]
          : null;
        setRead({
          band,
          conditionClass: typeof ds.condition_class === 'string' ? ds.condition_class.split('(')[0].trim() : null,
          tier: data.condition_tier,
          score: Number(data.condition_score),
          frames: data.observation_count,
          method: data.computation_version || 'appraisal',
          computedAt: data.computed_at,
        });
      });
    return () => { alive = false; };
  }, [vehicleId]);
  return read;
}

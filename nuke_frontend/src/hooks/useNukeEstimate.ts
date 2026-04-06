import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface NukeEstimate {
  estimated_value: number;
  value_low: number;
  value_high: number;
  confidence_score: number;
  price_tier: string;
  confidence_interval_pct: number;
  signal_weights: Record<string, { weight: number; multiplier: number; sourceCount: number }>;
  deal_score: number | null;
  deal_score_label: string | null;
  heat_score: number | null;
  heat_score_label: string | null;
  model_version: string;
  input_count: number;
  calculated_at: string;
}

interface RecordPrice {
  record_price: number;
  record_sale_date: string | null;
  previous_record_price: number | null;
  times_record_broken: number;
}

interface SurvivalRate {
  total_produced: number | null;
  estimated_surviving: number | null;
  survival_rate: number | null;
  estimation_method: string;
  confidence_score: number | null;
}

export function useNukeEstimate(vehicleId: string, vehicle: { year?: number; make?: string; model?: string }) {
  return useQuery({
    queryKey: ['nuke-estimate', vehicleId],
    queryFn: async () => {
      const result: { estimate: NukeEstimate | null; record: RecordPrice | null; survival: SurvivalRate | null } = {
        estimate: null, record: null, survival: null
      };

      const { data: est } = await supabase
        .from('nuke_estimates')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      if (est) result.estimate = est as NukeEstimate;

      if (vehicle.make && vehicle.model && vehicle.year) {
        const [{ data: rec }, { data: surv }] = await Promise.all([
          supabase
            .from('record_prices')
            .select('record_price, record_sale_date, previous_record_price, times_record_broken')
            .ilike('make', vehicle.make!)
            .ilike('model', `%${vehicle.model!}%`)
            .lte('year_start', vehicle.year!)
            .gte('year_end', vehicle.year!)
            .maybeSingle(),
          supabase
            .from('survival_rate_estimates')
            .select('total_produced, estimated_surviving, survival_rate, estimation_method, confidence_score')
            .ilike('make', vehicle.make!)
            .ilike('model', `%${vehicle.model!}%`)
            .lte('year_start', vehicle.year!)
            .gte('year_end', vehicle.year!)
            .maybeSingle(),
        ]);
        if (rec) result.record = rec as RecordPrice;
        if (surv) result.survival = surv as SurvivalRate;
      }

      return result;
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { NukeEstimate, RecordPrice, SurvivalRate };

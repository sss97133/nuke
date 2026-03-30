import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// Types extracted from VehiclePopup.tsx — the canonical intel shape
export interface VehicleIntel {
  comment_intel: CommentIntel | null;
  description_intel: DescriptionIntel | null;
  scores: ScoreData | null;
  apparitions: Apparition[] | null;
  recent_comps: CompSale[] | null;
}

export interface CommentIntel {
  sentiment: { score: number; overall: string; mood_keywords?: string[]; emotional_themes?: string[] } | null;
  key_quotes: (string | { quote: string; significance?: string })[] | null;
  expert_insights: (string | { insight: string; expertise_level?: string })[] | null;
  community_concerns: (string | { concern: string })[] | null;
  price_sentiment: { community_view?: string; reasoning?: string; overall?: string; comments?: string } | null;
  market_signals: { demand?: string; rarity?: string; price_trend?: string; value_factors?: string[] } | null;
  seller_disclosures: string[] | null;
  authenticity: { concerns_raised?: boolean | string; details?: string } | null;
  overall_sentiment: string | null;
  sentiment_score: number | null;
  comment_count: number | null;
}

export interface DescriptionIntel {
  red_flags: { f: string; sev: string }[] | null;
  mods: string[] | null;
  work_history: { d: string; s: string | null; w: string }[] | null;
  condition: string | null;
  condition_note: string | null;
  title_status: string | null;
  owner_count: number | null;
  matching_numbers: boolean | null;
  documentation: string[] | null;
  option_codes: { c: string; d: string; p: string; r: string }[] | null;
  equipment: string[] | null;
  price_positive: string[] | null;
  price_negative: string[] | null;
}

export interface ScoreData {
  nuke_estimate: number | null;
  nuke_confidence: number | null;
  heat_score: number | null;
  deal_score: number | null;
}

export interface Apparition {
  platform: string;
  url: string | null;
  event_type: string | null;
  event_date: string | null;
  price: number | null;
}

export interface CompSale {
  id: string;
  year: number | null;
  model: string | null;
  sale_price: number;
  sale_date: string | null;
  thumbnail: string | null;
  mileage: number | null;
}

export function useVehicleIntel(vehicleId: string | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vehicle-intel', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;
      const { data, error } = await supabase.rpc('popup_vehicle_intel', {
        p_vehicle_id: vehicleId,
      });
      if (error) throw error;
      return (data as VehicleIntel) ?? null;
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000, // 5 min — intel changes slowly
  });

  return {
    vehicleIntel: data ?? null,
    vehicleIntelLoading: isLoading,
    vehicleIntelError: error?.message ?? null,
    refetchIntel: refetch,
  };
}

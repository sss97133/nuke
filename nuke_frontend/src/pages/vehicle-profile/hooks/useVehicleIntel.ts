import { useState, useEffect, useCallback } from 'react';
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
  const [vehicleIntel, setVehicleIntel] = useState<VehicleIntel | null>(null);
  const [vehicleIntelLoading, setVehicleIntelLoading] = useState(false);
  const [vehicleIntelError, setVehicleIntelError] = useState<string | null>(null);

  const fetchIntel = useCallback(async () => {
    if (!vehicleId) return;
    setVehicleIntelLoading(true);
    setVehicleIntelError(null);
    try {
      const { data, error } = await supabase.rpc('popup_vehicle_intel', {
        p_vehicle_id: vehicleId,
      });
      if (error) {
        setVehicleIntelError(error.message);
      } else if (data) {
        setVehicleIntel(data as VehicleIntel);
      }
    } catch (err: any) {
      setVehicleIntelError(err?.message || 'Failed to load intelligence');
    } finally {
      setVehicleIntelLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    fetchIntel();
  }, [fetchIntel]);

  return { vehicleIntel, vehicleIntelLoading, vehicleIntelError, refetchIntel: fetchIntel };
}

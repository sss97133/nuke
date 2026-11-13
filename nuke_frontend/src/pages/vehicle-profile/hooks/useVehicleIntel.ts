import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// Types extracted from VehiclePopup.tsx — the canonical intel shape
export interface VehicleIntel {
  comment_intel: CommentIntel | null;
  description_intel: DescriptionIntel | null;
  scores: ScoreData | null;
  apparitions: Apparition[] | null;
  recent_comps: CompSale[] | null;
  recent_comps_scope?: CompScope | null;
}

export interface CompScope {
  label: string | null;
  basis: string | null;
  condition_matched: boolean;
  condition_note: string;
}

export interface CommentIntel {
  sentiment: { score: number; overall: string; mood_keywords?: string[]; emotional_themes?: string[] } | null;
  key_quotes: (string | { quote: string; significance?: string; comment_id?: string | null; author?: string | null;
    is_seller?: boolean; posted_at?: string | null; url?: string | null })[] | null;
  expert_insights: (string | { insight: string; expertise_level?: string })[] | null;
  community_concerns: (string | { concern: string })[] | null;
  price_sentiment: { community_view?: string; reasoning?: string; overall?: string; comments?: string } | null;
  market_signals: { demand?: string; rarity?: string; demand_level?: string; rarity_assessment?: string; price_trend?: string; value_factors?: string[] } | null;
  seller_disclosures: string[] | null;
  authenticity: { concerns_raised?: boolean | string; details?: string } | null;
  overall_sentiment: string | null;
  sentiment_score: number | null;
  comment_count: number | null;
  /** Provenance of the stored summary; absent on summaries written before 2026-11-12. */
  analyzed_at?: string | null;
  model_used?: string | null;
  prompt_version?: string | null;
  comments_analyzed?: number | null;
  quotes_dropped_not_verbatim?: number | null;
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
  schedule_status?: 'accepted_awaiting_schedule';
}

type EventClock = { source_platform: string; source_url: string | null; event_type: string | null;
  started_at: string | null; ended_at: string | null; sold_at: string | null; event_kind: string | null };

/** Acceptance is a submission milestone, never an auction start date. Match the
 * exact existing event projection; do not apply one pending lot to other lots. */
export function qualifyApparitionClocks(apparitions: Apparition[], events: EventClock[]): Apparition[] {
  const sameClock = (a: string | null, b: string | null) => a === b || (!!a && !!b
    && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
  return apparitions.map(apparition => {
    const matches = events.filter(event => event.source_platform === apparition.platform
      && event.source_url === apparition.url && event.event_type === apparition.event_type
      && sameClock(event.sold_at || event.ended_at || event.started_at, apparition.event_date));
    const event = matches.length === 1 ? matches[0] : null;
    return event?.event_kind === 'bat_acceptance' && !event.ended_at && !event.sold_at
      ? { ...apparition, event_date: null, schedule_status: 'accepted_awaiting_schedule' } : apparition;
  });
}

export interface CompSale {
  id: string;
  year: number | null;
  model: string | null;
  sale_price: number;
  sale_date: string | null;
  thumbnail: string | null;
  mileage: number | null;
  source_url?: string | null;
  platform?: string | null;
  sold_basis?: string | null;
  sold_amount_from?: string | null;
}

export function useVehicleIntel(vehicleId: string | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vehicle-intel', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;
      const [intel, clocks] = await Promise.all([
        supabase.rpc('popup_vehicle_intel', { p_vehicle_id: vehicleId }),
        supabase.from('vehicle_events')
          .select('source_platform,source_url,event_type,started_at,ended_at,sold_at,event_kind:metadata->>kind')
          .eq('vehicle_id', vehicleId).order('started_at', { ascending: false, nullsFirst: false }).limit(20),
      ]);
      const { data, error } = intel;
      if (error) throw error;
      if (!data) return null;
      const result = data as VehicleIntel;
      // A failed clock read must not promote an unqualified start timestamp to
      // an auction date. Preserve the occurrence, with its date unresolved.
      return { ...result, apparitions: result.apparitions?.map(apparition => clocks.error
        ? { ...apparition, event_date: null } : qualifyApparitionClocks([apparition], clocks.data || [])[0]) ?? null };
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

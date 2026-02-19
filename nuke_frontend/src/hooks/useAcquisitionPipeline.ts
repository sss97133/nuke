import { useState, useEffect, useCallback } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../lib/supabase';

export interface PipelineEntry {
  id: string;
  year: number | null;
  make: string;
  model: string | null;
  asking_price: number | null;
  comp_median: number | null;
  deal_score: number | null;
  estimated_profit: number | null;
  stage: string;
  priority: string;
  location_city: string | null;
  location_state: string | null;
  discovery_url: string | null;
  discovery_source: string | null;
  seller_contact: string | null;
  notes: string | null;
  market_proof_data: {
    condition_tier?: string;
    cost_to_ready?: number;
    total_investment?: number;
    target_sale_price?: number;
    net_profit?: number;
    roi_pct?: number;
    recommendation?: string;
    match_strategy?: string;
    risk_factors?: string[];
    cost_notes?: string[];
    cost_breakdown?: {
      parts?: number;
      labor?: number;
      labor_hours?: number;
      transport?: number;
      inspection?: number;
      listing_fees_pct?: number;
    };
  } | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStats {
  total: number;
  targets: number;
  strong_buys: number;
  buys: number;
  active_deals: number;
  total_target_profit: number;
  avg_target_roi: number;
}

export function useAcquisitionPipeline() {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch targets and active deals (not the 700+ market_proofed/discovered)
      const { data, error: fetchErr } = await supabase
        .from('acquisition_pipeline')
        .select('*')
        .in('stage', ['target', 'contacted', 'inspecting', 'offer_made', 'under_contract', 'acquired', 'in_transport', 'at_shop', 'validated', 'reconditioning', 'listed', 'sold'])
        .order('deal_score', { ascending: false })
        .order('estimated_profit', { ascending: false });

      if (fetchErr) throw new Error(fetchErr.message);
      setEntries(data || []);

      // Compute stats
      const all = data || [];
      const targets = all.filter(e => e.stage === 'target');
      const activeDealStages = ['contacted', 'inspecting', 'offer_made', 'under_contract', 'acquired', 'in_transport', 'at_shop', 'validated', 'reconditioning', 'listed'];
      const activeDeals = all.filter(e => activeDealStages.includes(e.stage));

      // Get total count from all stages
      const { count: totalCount } = await supabase
        .from('acquisition_pipeline')
        .select('*', { count: 'exact', head: true });

      const totalProfit = targets.reduce((s, e) => s + (e.estimated_profit || 0), 0);
      const roiValues = targets
        .map(e => e.market_proof_data?.roi_pct)
        .filter((v): v is number => v != null && v > 0);
      const avgRoi = roiValues.length > 0
        ? Math.round(roiValues.reduce((s, v) => s + v, 0) / roiValues.length * 10) / 10
        : 0;

      setStats({
        total: totalCount || 0,
        targets: targets.length,
        strong_buys: all.filter(e => (e.deal_score || 0) >= 80).length,
        buys: all.filter(e => (e.deal_score || 0) >= 70 && (e.deal_score || 0) < 80).length,
        active_deals: activeDeals.length,
        total_target_profit: totalProfit,
        avg_target_roi: avgRoi,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const advanceStage = useCallback(async (pipelineId: string, action: string, params: Record<string, unknown> = {}) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(`${getSupabaseFunctionsUrl()}/acquire-vehicle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, pipeline_id: pipelineId, ...params }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to advance stage');
      await fetchData(); // refresh
      return result;
    } catch (err) {
      throw err;
    }
  }, [fetchData]);

  return { entries, stats, loading, error, refresh: fetchData, advanceStage };
}

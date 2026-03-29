import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export interface AnalysisSignal {
  id: string;
  widget_slug: string;
  score: number | null;
  label: string;
  severity: string;
  reasons: string[];
  evidence: any;
  recommendations: any;
  confidence: number | null;
  computed_at: string;
}

export function useAnalysisSignals(vehicleId: string | undefined) {
  const [signals, setSignals] = useState<AnalysisSignal[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('analysis_signals')
      .select('id, widget_slug, score, label, severity, reasons, evidence, recommendations, confidence, computed_at')
      .eq('vehicle_id', vehicleId)
      .is('dismissed_until', null)
      .order('severity', { ascending: true })
      .order('computed_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) {
          setSignals(data || []);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [vehicleId]);

  return { signals, loading };
}

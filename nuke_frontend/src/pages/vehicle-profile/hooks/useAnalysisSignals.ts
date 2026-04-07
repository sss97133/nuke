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
          // Filter out signals with errors or missing data — don't show broken widgets
          const clean = (data || []).filter((s: any) => {
            if (!s.label) return false;
            // Check for error indicators in the evidence JSON
            const evi = s.evidence;
            if (evi && typeof evi === 'object') {
              const eviStr = JSON.stringify(evi).toLowerCase();
              if (eviStr.includes('"error"') || eviStr.includes('404') || eviStr.includes('failed')) return false;
            }
            // Check for error in reasons
            if (Array.isArray(s.reasons) && s.reasons.length === 1) {
              const r = String(s.reasons[0]).toLowerCase();
              if (r.includes('error') || r.includes('failed') || r.includes('404') || r.includes('unable to')) return false;
            }
            return true;
          });
          setSignals(clean);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [vehicleId]);

  return { signals, loading };
}

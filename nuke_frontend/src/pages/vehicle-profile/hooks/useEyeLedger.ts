/**
 * useEyeLedger — the ledger behind an Eye read: the canon-check atoms
 * (appraisal_canon_checks) + the appraise-layer payload (vehicle_observations).
 *
 * One loader for both the in-app drill (EyeLedgerPopup) and the shareable
 * dossier page — the same substrate, rendered two ways. Complete testimony, no
 * top-K curation; the consumer sorts and ranks.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export interface CanonCheck {
  observation_id: string;
  image_id: string | null;
  image_url: string | null;
  part: string;
  canon_ref: string;
  verdict: 'pass' | 'fail' | 'suspect' | 'indeterminate' | 'cannot_assess';
  evidence: string;
  confidence: number | null;
  method: string | null;
  observed_at: string | null;
}

export interface EyeLedger {
  checks: CanonCheck[];
  payload: any | null;
  loaded: boolean;
  /** fail+suspect, severity-then-confidence ranked */
  findings: CanonCheck[];
  /** verdict → count */
  counts: Record<string, number>;
  totalChecks: number;
  /** indeterminate + cannot_assess */
  refused: number;
}

export function useEyeLedger(vehicleId: string | undefined): EyeLedger {
  const [checks, setChecks] = useState<CanonCheck[] | null>(null);
  const [payload, setPayload] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    setLoaded(false);
    Promise.all([
      supabase
        .from('appraisal_canon_checks')
        .select('observation_id, image_id, image_url, part, canon_ref, verdict, evidence, confidence, method, observed_at')
        .eq('vehicle_id', vehicleId),
      supabase
        .from('vehicle_observations')
        .select('structured_data, observed_at')
        .eq('vehicle_id', vehicleId)
        .eq('structured_data->>layer', 'appraise')
        .order('observed_at', { ascending: false })
        .limit(1),
    ]).then(([c, a]) => {
      if (!alive) return;
      setChecks((c.data as CanonCheck[]) || []);
      setPayload(a.data?.[0]?.structured_data?.payload ?? null);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [vehicleId]);

  const derived = useMemo(() => {
    const all = checks || [];
    const rank: Record<string, number> = { fail: 0, suspect: 1 };
    const findings = all
      .filter((c) => c.verdict === 'fail' || c.verdict === 'suspect')
      .sort((x, y) => (rank[x.verdict] - rank[y.verdict]) || ((Number(y.confidence) || 0) - (Number(x.confidence) || 0)));
    const counts: Record<string, number> = {};
    for (const c of all) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
    const refused = (counts['indeterminate'] || 0) + (counts['cannot_assess'] || 0);
    return { findings, counts, totalChecks: all.length, refused };
  }, [checks]);

  return { checks: checks || [], payload, loaded, ...derived };
}

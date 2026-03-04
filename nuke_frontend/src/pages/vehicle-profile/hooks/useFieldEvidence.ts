/**
 * useFieldEvidence.ts
 *
 * React hook that fetches field_evidence rows for a vehicle from Supabase,
 * groups them by field_name, and returns the primary (highest-confidence) value
 * plus all competing sources per field.
 *
 * Part of the Provenance UI shipped in the provenance-ui branch.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FieldEvidenceRow {
  id: string;
  vehicle_id: string;
  field_name: string;
  field_value: string;
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  confidence: number;
  verified: boolean;
  verified_by: string | null;
  verification_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldEvidenceGroup {
  /** The primary (winning) value for this field — highest confidence */
  primary: FieldEvidenceRow;
  /** All evidence rows for this field, sorted confidence desc */
  sources: FieldEvidenceRow[];
  /** Number of distinct sources that agree on the primary value */
  agreementCount: number;
  /** Total source count */
  totalSources: number;
  /** Are there conflicting values? */
  hasConflict: boolean;
}

export type FieldEvidenceMap = Record<string, FieldEvidenceGroup>;

/* ------------------------------------------------------------------ */
/*  Trust hierarchy weights — used to break ties within same confidence */
/* ------------------------------------------------------------------ */

const SOURCE_TRUST: Record<string, number> = {
  vin_decode: 100,
  nhtsa_vin_decode: 100,
  title_document: 90,
  bat_listing: 85,
  receipt: 80,
  image_vision: 65,
  user_input: 50,
  enrichment: 30,
};

function trustWeight(sourceType: string): number {
  return SOURCE_TRUST[sourceType] ?? 40;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useFieldEvidence(vehicleId: string | undefined) {
  const [evidence, setEvidence] = useState<FieldEvidenceMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvidence = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('field_evidence')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('confidence', { ascending: false });

      if (queryError) {
        console.warn('[useFieldEvidence] query error:', queryError.message);
        setError(queryError.message);
        setEvidence({});
        return;
      }

      if (!data || data.length === 0) {
        setEvidence({});
        return;
      }

      // Group by field_name
      const grouped: Record<string, FieldEvidenceRow[]> = {};
      for (const row of data as FieldEvidenceRow[]) {
        if (!grouped[row.field_name]) grouped[row.field_name] = [];
        grouped[row.field_name].push(row);
      }

      // Build FieldEvidenceMap
      const map: FieldEvidenceMap = {};
      for (const [fieldName, rows] of Object.entries(grouped)) {
        // Sort: confidence desc, then trust weight desc, then newest first
        rows.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          const tw = trustWeight(b.source_type) - trustWeight(a.source_type);
          if (tw !== 0) return tw;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

        const primary = rows[0];
        const primaryValue = (primary.field_value || '').toLowerCase().trim();
        const agreementCount = rows.filter(
          (r) => (r.field_value || '').toLowerCase().trim() === primaryValue
        ).length;

        const distinctValues = new Set(
          rows.map((r) => (r.field_value || '').toLowerCase().trim())
        );

        map[fieldName] = {
          primary,
          sources: rows,
          agreementCount,
          totalSources: rows.length,
          hasConflict: distinctValues.size > 1,
        };
      }

      setEvidence(map);
    } catch (err: any) {
      console.error('[useFieldEvidence] unexpected error:', err);
      setError(err?.message || 'Unknown error');
      setEvidence({});
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    fetchEvidence();
  }, [fetchEvidence]);

  return { evidence, loading, error, refetch: fetchEvidence };
}

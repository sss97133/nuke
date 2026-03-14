/**
 * useFieldEvidence.ts
 *
 * React hook that fetches field_evidence rows for a vehicle from Supabase,
 * groups them by field_name, and returns the primary (highest-confidence) value
 * plus all competing sources per field.
 *
 * Part of the Provenance UI shipped in the provenance-ui branch.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

/** Track vehicles already backfilled this session to avoid repeat RPC calls */
const backfilledVehicles = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Maps to actual field_evidence table columns */
export interface FieldEvidenceRow {
  id: string;
  vehicle_id: string;
  field_name: string;
  /** DB column: proposed_value — mapped to field_value for UI consumption */
  field_value: string;
  source_type: string;
  /** 0-1 float — converted from DB source_confidence (0-100 int) */
  confidence: number;
  extraction_context: string | null;
  extracted_at: string | null;
  status: string | null;
  created_at: string;
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
        .select('id, vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at, status, created_at')
        .eq('vehicle_id', vehicleId)
        .order('source_confidence', { ascending: false });

      if (queryError) {
        console.warn('[useFieldEvidence] query error:', queryError.message);
        setError(queryError.message);
        setEvidence({});
        return;
      }

      if (!data || data.length < 3) {
        // Sparse or no evidence — trigger on-demand backfill
        if (vehicleId && !backfilledVehicles.has(vehicleId)) {
          backfilledVehicles.add(vehicleId);
          try {
            const { data: inserted } = await supabase.rpc('ensure_field_evidence', { p_vehicle_id: vehicleId });
            if (inserted && inserted > 0) {
              // Re-fetch after backfill populated new rows
              const { data: refreshed } = await supabase
                .from('field_evidence')
                .select('id, vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at, status, created_at')
                .eq('vehicle_id', vehicleId)
                .order('source_confidence', { ascending: false });
              if (refreshed && refreshed.length > 0) {
                // Replace data reference and continue to mapping below
                (data as any[]).length = 0;
                (data as any[]).push(...refreshed);
              }
            }
          } catch (backfillErr) {
            console.warn('[useFieldEvidence] backfill error (non-fatal):', backfillErr);
          }
        }
        if (!data || data.length === 0) {
          setEvidence({});
          return;
        }
      }

      // Map DB columns to UI interface
      const mapped: FieldEvidenceRow[] = (data as any[]).map((r) => ({
        id: r.id,
        vehicle_id: r.vehicle_id,
        field_name: r.field_name,
        field_value: r.proposed_value ?? '',
        source_type: r.source_type,
        confidence: (r.source_confidence ?? 0) / 100, // 0-100 int → 0-1 float
        extraction_context: r.extraction_context ?? null,
        extracted_at: r.extracted_at ?? null,
        status: r.status ?? null,
        created_at: r.created_at,
      }));

      // Group by field_name
      const grouped: Record<string, FieldEvidenceRow[]> = {};
      for (const row of mapped) {
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
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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

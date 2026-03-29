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

export type ConflictType = 'genuine' | 'refinement' | 'synonym' | 'variance';

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
  /** What kind of conflict (if any) */
  conflictType?: ConflictType;
}

export type FieldEvidenceMap = Record<string, FieldEvidenceGroup>;

/* ------------------------------------------------------------------ */
/*  Conflict classification — refinement vs synonym vs genuine         */
/* ------------------------------------------------------------------ */

/** Normalize for comparison: strip punctuation, whitespace, case */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-\/\s_.()]+/g, '').trim();
}

/** Extract core semantic tokens from a value for fuzzy matching */
function coreTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 1));
}

/** Domain-specific synonym groups for vehicle fields */
const SYNONYM_GROUPS: string[][] = [
  ['4wd', '4x4', 'fourwheeldrive', 'four wheel drive', 'awd'],
  ['2wd', '4x2', 'twowheeldrive', 'rwd', 'rear wheel drive'],
  ['v8', 'v-8', '8cylinder', '8cyl'],
  ['v6', 'v-6', '6cylinder', '6cyl'],
  ['sbc', 'smallblockchev', 'smallblock'],
  ['bbc', 'bigblockchev', 'bigblock'],
  ['auto', 'automatic'],
  ['manual', 'stick', 'standard'],
];

function areSynonyms(a: string, b: string): boolean {
  const aN = norm(a);
  const bN = norm(b);
  if (aN === bN) return true;
  for (const group of SYNONYM_GROUPS) {
    const normed = group.map(norm);
    if (normed.some(g => aN.includes(g)) && normed.some(g => bN.includes(g))) return true;
  }
  return false;
}

function classifyConflict(
  field: string,
  primary: string,
  others: string[],
): ConflictType {
  const pNorm = norm(primary);

  // Synonym: values normalize to the same string or are domain synonyms
  // e.g. "C/K Pickup" vs "C-K Pickup", "4WD" vs "4x4"
  if (others.every(v => areSynonyms(primary, v))) return 'synonym';

  // Field-specific: model/series/trim differences are almost always refinement
  // (NHTSA gives platform name, BaT/user give specific trim). Only genuine if
  // values share zero common tokens AND neither is a known platform shorthand.
  if (field === 'model' || field === 'series' || field === 'trim') {
    const pTokens = coreTokens(primary);
    const allOtherTokens = others.flatMap(v => [...coreTokens(v)]);
    const hasAnyOverlap = [...pTokens].some(t => allOtherTokens.includes(t));
    // If there's any token overlap OR the values are short (platform codes like "C/K"),
    // treat as refinement rather than conflict
    if (hasAnyOverlap || pNorm.length <= 8) return 'refinement';
  }

  // Refinement: one value contains the other, OR they share substantial token overlap
  // e.g. "Carburetor" vs "Carburetor (Edelbrock 4bbl)", "C/K Pickup" vs "C2500 Sierra Classic"
  if (others.every(v => {
    const vNorm = norm(v);
    // Direct containment
    if (pNorm.includes(vNorm) || vNorm.includes(pNorm)) return true;
    // Token overlap: if >50% of the shorter value's tokens exist in the longer
    const pTokens = coreTokens(primary);
    const vTokens = coreTokens(v);
    const shorter = pTokens.size <= vTokens.size ? pTokens : vTokens;
    const longer = pTokens.size > vTokens.size ? pTokens : vTokens;
    if (shorter.size === 0) return false;
    let overlap = 0;
    for (const t of shorter) { if (longer.has(t)) overlap++; }
    return overlap / shorter.size > 0.5;
  })) return 'refinement';

  // Variance: numeric fields within tolerance
  const numericFields = ['mileage', 'odometer', 'horsepower', 'displacement', 'sale_price', 'asking_price'];
  if (numericFields.some(nf => field.toLowerCase().includes(nf))) {
    const nums = [primary, ...others]
      .map(v => parseFloat(v.replace(/[^0-9.]/g, '')))
      .filter(n => !isNaN(n));
    if (nums.length >= 2) {
      const range = Math.max(...nums) - Math.min(...nums);
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      // Within 5% of mean = measurement variance
      if (mean > 0 && range / mean < 0.05) return 'variance';
    }
  }

  return 'genuine';
}

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

      // Filter out rejected evidence — don't include in conflict analysis or display
      const active = mapped.filter(r => r.status !== 'rejected');

      // Group by field_name
      const grouped: Record<string, FieldEvidenceRow[]> = {};
      for (const row of active) {
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

        const hasConflict = distinctValues.size > 1;
        let conflictType: ConflictType | undefined;
        if (hasConflict) {
          const others = [...distinctValues].filter(v => v !== primaryValue);
          conflictType = classifyConflict(fieldName, primaryValue, others);
        }

        map[fieldName] = {
          primary,
          sources: rows,
          agreementCount,
          totalSources: rows.length,
          hasConflict,
          conflictType,
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

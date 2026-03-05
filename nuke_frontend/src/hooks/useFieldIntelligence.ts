import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useMicroPortalData, type PortalDataState } from '../components/vehicles/micro-portals/useMicroPortalData';

export interface FieldIntelligence {
  field_name: string;
  field_value: string;
  exact_match_count: number;
  total_with_field: number;
  value_pct: number;
  rarity: 'UNIQUE' | 'RARE' | 'UNCOMMON' | 'COMMON' | 'VERY COMMON';
  rank: number;
  total_distinct_values: number;
  avg_price_with: number | null;
  median_price_with: number | null;
  price_sample_count: number | null;
  avg_price_without: number | null;
  price_premium_pct: number | null;
  min_year: number | null;
  max_year: number | null;
  peak_year: number | null;
  top_values: Array<{ value: string; count: number }>;
  companions: Array<{
    field: string;
    label: string;
    values: Array<{ value: string; count: number }>;
  }>;
  error?: string;
}

/** Fields that have their own dedicated RPCs or don't benefit from aggregate stats */
const SKIP_FIELDS = new Set(['vin', 'year', 'make', 'model']);

function classifyIntelligence(data: FieldIntelligence): PortalDataState {
  if (data.error) return 'empty';
  if (data.exact_match_count === 0) return 'empty';
  if (data.exact_match_count <= 2) return 'sparse';
  return 'rich';
}

export function useFieldIntelligence(
  fieldName: string | undefined,
  fieldValue: string | undefined,
) {
  const enabled = !!fieldName && !!fieldValue && !SKIP_FIELDS.has(fieldName);

  const fetcher = useCallback(async (): Promise<FieldIntelligence> => {
    if (!fieldName || !fieldValue) throw new Error('No field');
    const { data, error } = await supabase.rpc('get_field_value_intelligence', {
      p_field_name: fieldName,
      p_field_value: fieldValue,
    });
    if (error) throw error;
    // Parse numeric strings from jsonb
    const d = data as Record<string, any>;
    return {
      ...d,
      avg_price_with: d.avg_price_with != null ? Number(d.avg_price_with) : null,
      median_price_with: d.median_price_with != null ? Number(d.median_price_with) : null,
      price_sample_count: d.price_sample_count != null ? Number(d.price_sample_count) : null,
      avg_price_without: d.avg_price_without != null ? Number(d.avg_price_without) : null,
      price_premium_pct: d.price_premium_pct != null ? Number(d.price_premium_pct) : null,
      min_year: d.min_year != null ? Number(d.min_year) : null,
      max_year: d.max_year != null ? Number(d.max_year) : null,
      peak_year: d.peak_year != null ? Number(d.peak_year) : null,
    } as FieldIntelligence;
  }, [fieldName, fieldValue]);

  return useMicroPortalData<FieldIntelligence>(
    `field-intel-${fieldName}-${fieldValue}`,
    fetcher,
    classifyIntelligence,
    enabled,
  );
}

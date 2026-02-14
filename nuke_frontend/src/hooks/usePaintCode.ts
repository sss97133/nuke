import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useMicroPortalData, type PortalDataState } from '../components/vehicles/micro-portals/useMicroPortalData';

export interface PaintCodeInfo {
  code: string | null;
  name: string | null;
  hex_color: string | null;
  color_family: string | null;
  type: string | null; // solid, metallic, pearl
  year_start: number | null;
  year_end: number | null;
}

function classifyPaint(data: PaintCodeInfo): PortalDataState {
  if (!data.name && !data.code && !data.hex_color) return 'empty';
  if (!data.code || !data.hex_color) return 'sparse';
  return 'rich';
}

/**
 * Resolves a vehicle's color into paint code info.
 * Checks paint_codes table (cross-manufacturer), falls back to gm_paint_codes.
 */
export function usePaintCode(
  make: string | undefined,
  color: string | undefined,
  year: number | undefined,
  enabled: boolean,
) {
  const fetcher = useCallback(async (): Promise<PaintCodeInfo> => {
    if (!color) return { code: null, name: color || null, hex_color: null, color_family: null, type: null, year_start: null, year_end: null };

    // Try universal paint_codes table first
    const { data: universal } = await supabase
      .from('paint_codes')
      .select('code, name, hex_color, color_family, type, year_start, year_end')
      .ilike('make', make || '')
      .ilike('name', `%${color}%`)
      .limit(1)
      .maybeSingle();

    if (universal) return universal as PaintCodeInfo;

    // Fallback to GM paint codes table
    if (make && make.toLowerCase().match(/^(chevrolet|gmc|cadillac|buick|pontiac|oldsmobile|gm)$/)) {
      const { data: gm } = await supabase
        .from('gm_paint_codes')
        .select('paint_code, color_name, hex_value')
        .ilike('color_name', `%${color}%`)
        .limit(1)
        .maybeSingle();

      if (gm) {
        return {
          code: gm.paint_code,
          name: gm.color_name,
          hex_color: gm.hex_value,
          color_family: null,
          type: null,
          year_start: null,
          year_end: null,
        };
      }
    }

    // Return name only — sparse state
    return { code: null, name: color, hex_color: null, color_family: null, type: null, year_start: null, year_end: null };
  }, [make, color, year]);

  return useMicroPortalData<PaintCodeInfo>(
    `paint-code-${make}-${color}`,
    fetcher,
    classifyPaint,
    enabled && !!color,
  );
}

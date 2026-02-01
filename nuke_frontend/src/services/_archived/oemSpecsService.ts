import { supabase } from '../lib/supabase';

export interface OEMSpec {
  make: string;
  model: string;
  year_start: number;
  year_end?: number;
  series?: string;
  body_style?: string;
  trim_level?: string;
  wheelbase_inches?: number;
  length_inches?: number;
  width_inches?: number;
  height_inches?: number;
  curb_weight_lbs?: number;
  engine_size?: string;
  horsepower?: number;
  torque_ft_lbs?: number;
  drivetrain?: string;
  doors?: number;
  seats?: number;
  mpg_city?: number;
  mpg_highway?: number;
  available_paint_codes?: string[];
}

/**
 * Auto-populate vehicle specs from OEM database
 */
export async function autoPopulateVehicleSpecs(
  vehicleId: string,
  year: number,
  make: string,
  model: string,
  trim?: string,
  bodyStyle?: string
): Promise<{ success: boolean; message?: string; populated_count?: number }> {
  try {
    const { data, error } = await supabase.rpc('auto_populate_vehicle_specs', {
      p_vehicle_id: vehicleId,
      p_year: year,
      p_make: make,
      p_model: model,
      p_trim: trim || null,
      p_body_style: bodyStyle || null
    });

    if (error) throw error;
    
    return data || { success: false, message: 'No data returned' };
  } catch (error) {
    console.error('Error auto-populating specs:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Search OEM specs database
 */
export async function searchOEMSpecs(
  make: string,
  model: string,
  year?: number
): Promise<OEMSpec[]> {
  try {
    let query = supabase
      .from('oem_vehicle_specs')
      .select('*')
      .ilike('make', make)
      .ilike('model', model);

    if (year) {
      query = query
        .lte('year_start', year)
        .or(`year_end.gte.${year},year_end.is.null`);
    }

    const { data, error } = await query.order('year_start', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error searching OEM specs:', error);
    return [];
  }
}

/**
 * Get available paint codes for a vehicle
 */
export async function getAvailablePaintCodes(
  make: string,
  model: string,
  year: number
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('oem_vehicle_specs')
      .select('available_paint_codes')
      .ilike('make', make)
      .ilike('model', model)
      .lte('year_start', year)
      .or(`year_end.gte.${year},year_end.is.null`)
      .single();

    if (error) throw error;
    return data?.available_paint_codes || [];
  } catch (error) {
    console.error('Error fetching paint codes:', error);
    return [];
  }
}

/**
 * Get GM paint code details
 */
export async function getGMPaintCode(code: string) {
  try {
    const { data, error } = await supabase
      .from('gm_paint_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching paint code:', error);
    return null;
  }
}

/**
 * Search GM paint codes by name or code
 */
export async function searchGMPaintCodes(search: string) {
  try {
    const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
    const searchSafe = escapeILike(search);
    const { data, error } = await supabase
      .from('gm_paint_codes')
      .select('*')
      .or(`code.ilike.%${searchSafe}%,name.ilike.%${searchSafe}%`)
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error searching paint codes:', error);
    return [];
  }
}


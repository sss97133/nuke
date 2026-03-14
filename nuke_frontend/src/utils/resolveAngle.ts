/**
 * resolveAngle — Resolve the best angle label for a vehicle image.
 *
 * Priority chain:
 * 1. image_angle_spectrum → x/y/z degrees + zone_name + canonical_angle_key
 * 2. image_angle_observations → canonical angle taxonomy display_label
 * 3. angle → raw string, underscore-to-space
 *
 * Returns: { label, degrees?, confidence? }
 */

import { supabase } from '../lib/supabase';

export interface ResolvedAngle {
  label: string;
  degrees?: { x: number; y: number; z: number };
  zone?: string;
  confidence?: number;
}

/**
 * Fetch and resolve the best angle data for an image.
 */
export async function resolveAngle(
  imageId: string,
  fallbackAngle?: string | null
): Promise<ResolvedAngle | null> {
  if (!imageId) return fallbackAngle ? formatFallback(fallbackAngle) : null;

  // 1. Try image_angle_spectrum (most detailed — has 3D coordinates)
  try {
    const { data: spectrum } = await supabase
      .from('image_angle_spectrum')
      .select('x_coordinate, y_coordinate, z_coordinate, zone_name, canonical_angle_key, confidence')
      .eq('image_id', imageId)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spectrum) {
      const label = formatCanonicalKey(spectrum.canonical_angle_key) || spectrum.zone_name || 'Unknown';
      const hasDegrees =
        spectrum.x_coordinate != null && spectrum.y_coordinate != null;
      return {
        label,
        degrees: hasDegrees
          ? {
              x: Number(spectrum.x_coordinate),
              y: Number(spectrum.y_coordinate),
              z: Number(spectrum.z_coordinate ?? 0),
            }
          : undefined,
        zone: spectrum.zone_name || undefined,
        confidence: spectrum.confidence != null ? Number(spectrum.confidence) : undefined,
      };
    }
  } catch {
    // Table might not exist — continue
  }

  // 2. Try image_angle_observations → angle_taxonomy
  try {
    const { data: obs } = await supabase
      .from('image_angle_observations')
      .select(`
        confidence,
        angle_taxonomy!inner (
          display_label,
          canonical_key,
          domain
        )
      `)
      .eq('image_id', imageId)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (obs?.angle_taxonomy) {
      const taxonomy = obs.angle_taxonomy as any;
      return {
        label: taxonomy.display_label || formatCanonicalKey(taxonomy.canonical_key),
        confidence: obs.confidence != null ? Number(obs.confidence) : undefined,
      };
    }
  } catch {
    // Continue to fallback
  }

  // 3. Fallback to raw angle string
  return fallbackAngle ? formatFallback(fallbackAngle) : null;
}

function formatCanonicalKey(key?: string | null): string {
  if (!key) return '';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Three Quarter/i, '3/4')
    .replace(/\bDriver\b/i, 'Driver')
    .replace(/\bPassenger\b/i, 'Passenger');
}

function formatFallback(angle: string): ResolvedAngle {
  return {
    label: formatCanonicalKey(angle),
  };
}

/**
 * Format degrees for display: "315 AZ / -30 EL"
 */
export function formatDegrees(degrees: { x: number; y: number; z?: number }): string {
  const az = Math.round(degrees.x);
  const el = Math.round(degrees.y);
  return `${az} AZ / ${el} EL`;
}

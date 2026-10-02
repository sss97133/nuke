/** A bounded read of the existing image ledger, shared by the profile and field drill. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface EvidenceImage {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  vehicle_zone: string | null;
  angle: string | null;
  ai_detected_angle: string | null;
  ai_processing_status: string | null;
  vision_analyzed_at: string | null;
  vision_model_version: string | null;
  created_at: string | null;
  taken_at: string | null;
  source: string | null;
  is_primary: boolean | null;
  is_document: boolean | null;
  category: string | null;
}

const CAP = 500;
const SELECT = 'id,image_url,thumbnail_url,medium_url,vehicle_zone,angle,ai_detected_angle,ai_processing_status,vision_analyzed_at,vision_model_version,created_at,taken_at,source,is_primary,is_document,category';

export function webSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function hasImageAnalysis(image: EvidenceImage): boolean {
  return !!image.vision_analyzed_at || image.ai_processing_status === 'completed';
}
export function hasImageZone(image: EvidenceImage): boolean {
  return !!image.vehicle_zone && !['other', 'unknown', 'unclassified'].includes(image.vehicle_zone);
}

// These identify relevant areas, NOT proof of a particular value or specification.
const FIELD_AREAS: Record<string, string[]> = {
  color: ['ext_'], interior_color: ['int_'],
  transmission: ['mech_transmission', 'int_center_console', 'int_dashboard'],
  drivetrain: ['ext_undercarriage', 'mech_transmission'],
  engine_type: ['mech_engine'], engine_size: ['mech_engine'],
  fuel_type: ['mech_engine'], fuel_system_type: ['mech_engine'],
  horsepower: ['mech_engine'], torque: ['mech_engine'],
  vin: ['detail_vin', 'detail_badge'], mileage: ['detail_odometer', 'int_dashboard'],
  body_style: ['ext_front', 'ext_rear', 'ext_driver', 'ext_passenger'],
};

export function relatedFieldImages(images: EvidenceImage[], field: string): EvidenceImage[] {
  const prefixes = FIELD_AREAS[field] || [];
  return images.filter(image => image.is_document !== true && hasImageZone(image)
    && prefixes.some(prefix => image.vehicle_zone!.startsWith(prefix)));
}

export function useVehicleImageEvidence(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle-image-evidence', vehicleId],
    enabled: !!vehicleId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 12_000);
      try {
        const { data, count, error } = await supabase.from('vehicle_images')
          .select(SELECT, { count: 'exact' }).eq('vehicle_id', vehicleId!)
          .not('is_sensitive', 'is', true).not('is_duplicate', 'is', true)
          .not('is_superseded', 'is', true).not('image_url', 'is', null)
          .or('and(or(vision_gate_status.is.null,vision_gate_status.eq.approved),or(image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")))')
          .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
          .limit(CAP).abortSignal(controller.signal);
        if (error) throw error;
        const images = ((data || []) as EvidenceImage[]).filter(image => webSourceUrl(image.image_url))
          .map(image => ({ ...image, thumbnail_url: webSourceUrl(image.thumbnail_url), medium_url: webSourceUrl(image.medium_url) }));
        return { images, total: count, complete: count !== null && images.length >= count, readAt: new Date().toISOString() };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    },
  });
}

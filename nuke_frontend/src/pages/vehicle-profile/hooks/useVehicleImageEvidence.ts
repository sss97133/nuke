/** A bounded read of the existing image ledger, shared by the profile and field drill. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { vehicleImageGallerySource } from '../../../lib/vehicleImageColumns';

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
  caption?: string | null;
  ai_byok_narrative?: string | null;
  ai_byok_components?: unknown;
}

const CAP = 500;
const SELECT = 'id,image_url,thumbnail_url,medium_url,vehicle_zone,angle,ai_detected_angle,ai_processing_status,vision_analyzed_at,vision_model_version,created_at,taken_at,source,is_primary,is_document,category,caption,ai_byok_narrative:ai_scan_metadata->byok_deep_analysis->>narrative_one_line,ai_byok_components:ai_scan_metadata->byok_deep_analysis->components_seen';

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
  transmission: ['mech_transmission', 'mech_drivetrain', 'ext_undercarriage', 'int_center_console', 'int_dashboard'],
  drivetrain: ['mech_drivetrain', 'ext_undercarriage', 'mech_transmission'],
  engine_type: ['mech_engine'], engine_size: ['mech_engine'],
  fuel_type: ['mech_engine'], fuel_system_type: ['mech_engine'],
  horsepower: ['mech_engine'], torque: ['mech_engine'],
  vin: ['detail_vin', 'detail_badge'], mileage: ['detail_odometer', 'int_dashboard'],
  body_style: ['ext_front', 'ext_rear', 'ext_driver', 'ext_passenger'],
};

const FIELD_TERMS: Record<string, string[]> = {
  transmission: ['transmission', 'gearbox'],
  drivetrain: ['transfer case', 'driveshaft', 'drive shaft', 'axle', 'differential', '4wd', '4x4'],
};
type AreaImage = Pick<EvidenceImage, 'vehicle_zone' | 'is_document'> & Partial<Pick<EvidenceImage, 'caption' | 'ai_byok_narrative' | 'ai_byok_components'>> & {
  ai_scan_metadata?: { byok_deep_analysis?: { narrative_one_line?: string | null; components_seen?: unknown } | null } | null;
};

function topicRank(image: AreaImage, field: string): number {
  const byok = image.ai_scan_metadata?.byok_deep_analysis;
  const detectedComponents = image.ai_byok_components || byok?.components_seen;
  const components = Array.isArray(detectedComponents) ? detectedComponents.map(component =>
    component && typeof component === 'object' && 'label' in component ? String(component.label) : '').join(' ') : '';
  const terms = FIELD_TERMS[field] || [];
  if (terms.some(term => components.toLowerCase().includes(term))) return 0;
  const text = [image.caption, image.ai_byok_narrative || byok?.narrative_one_line].filter(Boolean).join(' ').toLowerCase();
  return terms.some(term => text.includes(term)) ? 1 : 2;
}

export function isRelatedFieldImage(image: AreaImage, field: string): boolean {
  const prefixes = FIELD_AREAS[field] || [];
  return image.is_document !== true && (topicRank(image, field) < 2
    || (!!image.vehicle_zone && prefixes.some(prefix => image.vehicle_zone!.startsWith(prefix))));
}

export function relatedFieldImages(images: EvidenceImage[], field: string): EvidenceImage[] {
  const areas = FIELD_AREAS[field] || [];
  const rank = (image: EvidenceImage) => {
    const mention = topicRank(image, field);
    return mention < 2 ? mention : 2 + areas.findIndex(area => image.vehicle_zone?.startsWith(area));
  };
  return images.filter(image => isRelatedFieldImage(image, field)).sort((a, b) => rank(a) - rank(b));
}

export function useVehicleImageEvidence(vehicleId: string | undefined, field?: string) {
  const areas = field ? FIELD_AREAS[field] || [] : [];
  return useQuery({
    queryKey: ['vehicle-image-evidence', vehicleId, areas.length ? field : null],
    enabled: !!vehicleId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 12_000);
      try {
        let query = supabase.from(await vehicleImageGallerySource())
          .select(SELECT, { count: 'exact' }).eq('vehicle_id', vehicleId!)
          .eq('vehicle_image_gallery_eligible', true)
          .not('is_sensitive', 'is', true).not('is_duplicate', 'is', true)
          .not('is_superseded', 'is', true).not('image_url', 'is', null)
          .or('image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")');
        if (areas.length) query = query.not('is_document', 'is', true).or([
          ...areas.map(area => `vehicle_zone.like.${area}*`),
          ...(FIELD_TERMS[field!] || []).flatMap(term => [`caption.ilike.*${term}*`, `ai_scan_metadata->byok_deep_analysis->>narrative_one_line.ilike.*${term}*`, `ai_scan_metadata->byok_deep_analysis->>components_seen.ilike.*${term}*`]),
        ].join(','));
        const { data, count, error } = await query
          .order('is_primary', { ascending: false }).order(areas.length ? 'taken_at' : 'created_at', { ascending: !areas.length, nullsFirst: false })
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

/** A bounded read of the existing image ledger, shared by the profile and field drill. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { vehicleImageGallerySource } from '../../../lib/vehicleImageColumns';
import { FIELD_TOKEN, facetImageCitations, type FacetImageCitation } from './facetImageCitations';

export interface EvidenceImage {
  id: string;
  vehicle_id?: string | null;
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
  is_sensitive?: boolean | null;
  is_duplicate?: boolean | null;
  is_superseded?: boolean | null;
  superseded_by?: string | null;
  category: string | null;
  caption?: string | null;
  ai_byok_narrative?: string | null;
  ai_byok_components?: unknown;
  ai_byok_scene?: string | null;
}

const CAP = 500;
/** Existing image-detail witness read shared with source reproductions. RLS is
 * retained; each consumer must bind the returned observation to its vehicle. */
export function readImageWitnesses(imageId: string, signal: AbortSignal) {
  return supabase.from('observation_witnesses').select(`witness_role,
    observation:vehicle_observations!observation_id(
      id, vehicle_id, kind, observed_at, content_text, structured_data, is_superseded, superseded_by, extraction_method
    )`).eq('image_id', imageId).abortSignal(signal).limit(100);
}
const SELECT = 'id,vehicle_id,image_url,thumbnail_url,medium_url,vehicle_zone,angle,ai_detected_angle,ai_processing_status,vision_analyzed_at,vision_model_version,created_at,taken_at,source,is_primary,is_document,is_sensitive,is_duplicate,is_superseded,superseded_by,category,caption,ai_byok_narrative:ai_scan_metadata->byok_deep_analysis->>narrative_one_line,ai_byok_components:ai_scan_metadata->byok_deep_analysis->components_seen,ai_byok_scene:ai_scan_metadata->byok_deep_analysis->>scene_type';

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
type AreaImage = Pick<EvidenceImage, 'vehicle_zone' | 'is_document'> & Partial<Pick<EvidenceImage, 'caption' | 'ai_byok_narrative' | 'ai_byok_components' | 'ai_byok_scene'>> & {
  ai_scan_metadata?: { byok_deep_analysis?: { narrative_one_line?: string | null; components_seen?: unknown; scene_type?: string | null; attribution_doubt?: unknown } | null } | null;
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

export function isReferenceImage(image: AreaImage): boolean {
  const byok = image.ai_scan_metadata?.byok_deep_analysis;
  const scene = image.ai_byok_scene || byok?.scene_type;
  return ['cross_reference', 'product_screenshot', 'spreadsheet', 'hand_drawn_diagram'].includes(scene || '')
    || (typeof byok?.attribution_doubt === 'string' && !!byok.attribution_doubt.trim());
}

function matchesFieldArea(image: AreaImage, field: string): boolean {
  const scene = image.ai_byok_scene || image.ai_scan_metadata?.byok_deep_analysis?.scene_type;
  const prefixes = FIELD_AREAS[field] || [];
  return image.is_document !== true && scene !== 'receipt_document' && (topicRank(image, field) < 2
    || (!!image.vehicle_zone && prefixes.some(prefix => image.vehicle_zone!.startsWith(prefix))));
}

export function isRelatedFieldImage(image: AreaImage, field: string): boolean {
  return !isReferenceImage(image) && matchesFieldArea(image, field);
}

function rankFieldImages(images: EvidenceImage[], field: string): EvidenceImage[] {
  const areas = FIELD_AREAS[field] || [];
  const rank = (image: EvidenceImage) => {
    const mention = topicRank(image, field);
    return mention < 2 ? mention : 2 + areas.findIndex(area => image.vehicle_zone?.startsWith(area));
  };
  return images.sort((a, b) => rank(a) - rank(b));
}

export function relatedFieldImages(images: EvidenceImage[], field: string): EvidenceImage[] {
  return rankFieldImages(images.filter(image => isRelatedFieldImage(image, field)), field);
}

export function referenceFieldImages(images: EvidenceImage[], field: string): EvidenceImage[] {
  return rankFieldImages(images.filter(image => isReferenceImage(image) && matchesFieldArea(image, field)), field);
}

export type CitedFieldImage = { image: EvidenceImage; citations: FacetImageCitation[] };

/** An exact facet citation is still rechecked against current gallery bytes. */
export function bindFacetCitations(vehicleId: string, citations: FacetImageCitation[], images: EvidenceImage[]): CitedFieldImage[] {
  return images.filter(image => image.vehicle_id === vehicleId && !!webSourceUrl(image.image_url)
    && image.is_sensitive !== undefined && image.is_sensitive !== true
    && image.is_document !== undefined && image.is_document !== true
    && image.is_duplicate !== undefined && image.is_duplicate !== true
    && image.is_superseded !== undefined && image.is_superseded !== true
    && image.superseded_by === null)
    .map(image => ({ image, citations: citations.filter(citation => citation.imageId === image.id) }))
    .filter(item => item.citations.length > 0);
}

/** A current-value hero never substitutes an as-built source when current
 * citations exist. The full set remains available to the field drill. */
export function heroFacetImages(cited: CitedFieldImage[], allCitations: FacetImageCitation[]): EvidenceImage[] {
  const currentExpected = allCitations.some(citation => citation.facet === 'current');
  // Examined/availability rows and conflict sides are retained for the field
  // drill, but they do not support the value shown in the contextual hero.
  const supportsValue = (citation: FacetImageCitation) => citation.relation === 'source'
    && (citation.status === 'established' || citation.status === 'reading');
  const current = cited.filter(item => item.citations.some(citation => citation.facet === 'current' && supportsValue(citation)));
  return (currentExpected ? current : cited.filter(item => item.citations.some(supportsValue))).map(item => item.image);
}

export function useVehicleImageEvidence(vehicleId: string | undefined, field?: string, citationField = field) {
  const areas = field ? FIELD_AREAS[field] || [] : [];
  const facetDimension = citationField ? FIELD_TOKEN[citationField] : undefined;
  // The full inventory stays shared across field drills; changing a cited
  // facet does not fetch the same 500 image records again.
  const inventory = useQuery({
    queryKey: ['vehicle-image-evidence', vehicleId, areas.length ? field : null],
    enabled: !!vehicleId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 12_000);
      try {
        const gallerySource = await vehicleImageGallerySource(SELECT);
        let query = supabase.from(gallerySource)
          .select(SELECT, { count: 'exact' }).eq('vehicle_id', vehicleId!)
          .eq('vehicle_image_gallery_eligible', true)
          .not('is_sensitive', 'is', true).not('is_duplicate', 'is', true)
          .not('is_superseded', 'is', true).is('superseded_by', null).not('image_url', 'is', null)
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
  const facet = useQuery({
    queryKey: ['vehicle-facet-image-citations', vehicleId, facetDimension || null],
    enabled: !!vehicleId && !!facetDimension,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('vehicle_facet_items', {
        p_vehicle_id: vehicleId!, p_dimension: facetDimension!,
      }).abortSignal(signal);
      if (error || !Array.isArray(data)) throw error || new Error('Facet source reader unavailable');
      const citations = facetImageCitations(data);
      const citationIds = [...new Set(citations.map(citation => citation.imageId))];
      if (citationIds.length > 100) throw new Error('Facet citation read exceeds bounded image selection');
      if (!citationIds.length) return { citations, citedImages: [] as CitedFieldImage[] };
      const { data: images, error: imageError } = await supabase.from(await vehicleImageGallerySource(SELECT)).select(SELECT)
        .eq('vehicle_id', vehicleId!).in('id', citationIds)
        .eq('vehicle_image_gallery_eligible', true).not('is_sensitive', 'is', true)
        .not('is_document', 'is', true).not('is_duplicate', 'is', true)
        .not('is_superseded', 'is', true).is('superseded_by', null).not('image_url', 'is', null)
        .or('image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")')
        .limit(100).abortSignal(signal);
      if (imageError) throw imageError;
      const citedImages = bindFacetCitations(vehicleId!, citations, (images || []) as EvidenceImage[])
        .map(item => ({ ...item, image: { ...item.image, thumbnail_url: webSourceUrl(item.image.thumbnail_url),
          medium_url: webSourceUrl(item.image.medium_url) } }));
      return { citations, citedImages };
    },
  });
  return {
    ...inventory,
    data: inventory.data && (!facetDimension || (facet.isSuccess && !facet.isFetching)) ? { ...inventory.data, citations: facet.data?.citations || [],
      citedImages: facet.data?.citedImages || [], facetDimension: facetDimension || null } : undefined,
    isPending: inventory.isPending || (!!facetDimension && (facet.isPending || facet.isFetching)),
    isLoading: inventory.isLoading || (!!facetDimension && (facet.isLoading || facet.isFetching)),
    isFetching: inventory.isFetching || facet.isFetching,
    isError: inventory.isError || (!!facetDimension && facet.isError),
    error: inventory.error || (facetDimension ? facet.error : null),
    refetch: () => { if (facetDimension) void facet.refetch(); return inventory.refetch(); },
  };
}

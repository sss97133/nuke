/** Reuse the existing, access-gated spec drill RPC; never render its image URLs unchecked. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { EvidenceImage } from './useVehicleImageEvidence';

export interface ProvenanceCitation {
  source: string;
  value: string | null;
  source_type: string | null;
  confidence: number | null;
  verified: boolean | null;
  image_id: string | null;
  at: string | null;
}
export interface ImageObservation {
  observation_id: string;
  image_id: string;
  image_url: string;
  value: string | null;
  source_slug: string | null;
  observed_at: string | null;
  ingested_at: string | null;
  extraction_method: string | null;
  agent_model: string | null;
  claim_role: string | null;
  visual_relation: string | null;
  limitation: string | null;
  image_region: { label?: string } | null;
  reference?: { url?: string; pdf_page?: number; supplementary_pdf_page?: number } | null;
  source_family?: string | null;
  is_inferred: boolean | null;
}
export interface FieldProvenance {
  field: string;
  value: string | null;
  inline_source: string | null;
  source_image_url: string | null;
  evidence: ProvenanceCitation[];
  image_observations?: ImageObservation[];
  observations: { id: string; value: string | null; source_slug: string | null; source_url: string | null; observed_at: string | null }[];
}

export function citedFieldImages(provenance: FieldProvenance | null | undefined, images: EvidenceImage[]) {
  if (!provenance) return [];
  // The legacy RPC has no visibility filters and source_image_id has no live image FK.
  // Only join citations to this vehicle's access/visibility-filtered image inventory.
  const ids = new Set(provenance.evidence
    .filter(e => e.source !== 'field_evidence' || e.verified === true)
    .map(e => e.image_id).filter(Boolean));
  for (const observation of provenance.image_observations || []) ids.add(observation.image_id);
  return images.filter(image => ids.has(image.id)).sort((a, b) => {
    const priority = (id: string) => Math.min(3, ...(provenance.image_observations || []).filter(o => o.image_id === id).map(o => evidenceOrder(o.visual_relation)));
    return priority(a.id) - priority(b.id);
  });
}

/** An explicit inspection order, not a calibrated truth probability. */
export function evidenceOrder(relation: string | null): number {
  return relation === 'direct_code' ? 0 : relation === 'direct_visual' ? 1 : relation === 'component_inference' ? 2 : 3;
}
export function evidenceRelationLabel(relation: string | null): string {
  return relation === 'direct_code' ? 'CODED SPECIFICATION' : relation === 'direct_visual' ? 'VISIBLE APPEARANCE / CONTROL' : relation === 'component_inference' ? 'COMPONENT INFERENCE' : 'RECORDED CITATION';
}

export function useFieldProvenance(vehicleId: string, field: string) {
  return useQuery({
    queryKey: ['field-provenance', vehicleId, field],
    enabled: !!vehicleId && !!field,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 12_000);
      try {
        const { data, error } = await supabase.rpc('get_field_provenance', { p_vehicle_id: vehicleId, p_field: field }).abortSignal(controller.signal);
        if (error) throw error;
        return data as FieldProvenance | null;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    },
  });
}

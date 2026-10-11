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
  vehicle_id?: string;
  value: string | null;
  /** Existing canonical owner, qualified against the access-gated report collection. */
  canonical?: { status: 'resolved' | 'unknown' | 'unavailable'; value?: string; observation_id?: string };
  inline_source: string | null;
  source_image_url: string | null;
  evidence: ProvenanceCitation[];
  image_observations?: ImageObservation[];
  coverage?: {
    contract: 'field_provenance_aggregate_cap_v1';
    status: 'complete_current_reader' | 'refused_input_limit';
    collectionRowLimit: number;
    scanRowsBounded: false;
    responseBytesBounded: false;
  };
  observations: {
    id: string; value: string | null; source_slug: string | null; source_url: string | null; observed_at: string | null;
    // Optional until the extended reader deployment has been verified.
    ingested_at?: string | null; extraction_method?: string | null; confidence?: number | null;
    kind?: string | null;
    /** Existing reader returns at most 400 characters of observation content, not the complete source. */
    content?: string | null;
    source_observation_id?: string | null;
    source_observed_at?: string | null;
    source_recorded_at?: string | null;
    source_event_time_status?: string | null;
    independent_source?: boolean | null;
    identity_resolution_status?: string | null;
    factory_configuration_status?: string | null;
    current_configuration_status?: string | null;
  }[];
}

export function provenanceCoverageUnavailable(provenance: FieldProvenance | null | undefined) {
  return !!provenance?.coverage && provenance.coverage.status !== 'complete_current_reader';
}

export function citedFieldImages(provenance: FieldProvenance | null | undefined, images: EvidenceImage[]) {
  if (!provenance || provenanceCoverageUnavailable(provenance)) return [];
  // Recheck returned citations against this vehicle's independently filtered
  // image inventory; an arbitrary source URL is not a joined image reference.
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

// Ratified core properties; engine_size remains the original combined source field.
export const ENGINE_PROPERTY_IDS: Record<string, string> = {
  engine_configuration: 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b',
  engine_displacement_l: '66b2f1f6-b714-4ac0-85b6-60ba89529c1a',
};

export function bindEngineCanonical(vehicleId: string, field: string, provenance: FieldProvenance, rows: any[]): NonNullable<FieldProvenance['canonical']> {
  const row = rows.length === 1 ? rows[0] : null;
  const report = provenance.observations.find(o => o.id === row?.observation_id);
  const value = row?.structured_data?.[field];
  const validValue = field === 'engine_displacement_l'
    ? typeof value === 'number' && Number.isFinite(value) && value > 0
    : field === 'engine_configuration' && typeof value === 'string' && value.trim().length > 0;
  if (!ENGINE_PROPERTY_IDS[field] || provenance.field !== field || provenance.vehicle_id !== vehicleId
    || provenanceCoverageUnavailable(provenance) || !report || !validValue
    || row.vehicle_id !== vehicleId || row.property_id !== ENGINE_PROPERTY_IDS[field]
    || row.discriminator_value !== '__single__' || report.value !== String(value)) return { status: 'unknown' };
  return { status: 'resolved', value: String(value), observation_id: row.observation_id };
}

export function formatProvenanceValue(field: string, value: string): string {
  return field === 'engine_displacement_l' ? `${value} L` : value;
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
        const provenance = data as FieldProvenance | null;
        if (!provenance || !ENGINE_PROPERTY_IDS[field] || provenanceCoverageUnavailable(provenance)) return provenance;
        if (!provenance.observations.length) return { ...provenance, canonical: { status: 'unknown' as const } };
        // The view chooses the winner. Never rank reports or fall back to a claim in the client.
        const canonical = await supabase.from('vehicle_canonical')
          .select('vehicle_id,property_id,observation_id,structured_data,discriminator_value')
          .eq('vehicle_id', vehicleId).eq('property_id', ENGINE_PROPERTY_IDS[field])
          .eq('discriminator_value', '__single__').limit(2).abortSignal(controller.signal);
        return { ...provenance, canonical: canonical.error
          ? { status: 'unavailable' as const }
          : bindEngineCanonical(vehicleId, field, provenance, canonical.data || []) };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    },
  });
}

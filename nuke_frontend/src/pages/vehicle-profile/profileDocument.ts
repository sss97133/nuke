// Builds the vehicle page's ProfileDocument from the readers that exist today: the vehicle
// row, the typed price fact and accepted field_evidence. This is the adapter that one
// viewer-scoped SQL read (vehicle_profile_read) replaces; the document shape is the contract,
// so the header never learns which side of the wire its facts came from.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { getVehicleIdentityTokens, type VehicleIdentitySource } from '../../utils/vehicleIdentity';
import { profileFacetValue, type ProfileFacet, type StudyVehicleFacets } from '../stacks/bidPopulationReader';
import type { Claim, ProfileDocument, Section, Source, Viewer } from '../../kit';
import { priceKindLabel, type PriceFacts } from './hooks/useVehiclePriceFacts';
import { isClassifiedPresentation } from './buildAuctionPulse';

/** What the header reads off a vehicle row: identity, the strip's dimensions, the odometer and its source. */
export type HeaderVehicle = VehicleIdentitySource & Partial<StudyVehicleFacets> & {
  id?: string | null;
  listing_kind?: string | null;
  mileage_source?: string | null;
  odometer?: number | string | null;
  miles?: number | string | null;
};

export type EvidenceRow = {
  field_name: string;
  proposed_value: string | null;
  source_type: string | null;
  source_confidence: number | null;
  extracted_at: string | null;
  status: string | null;
};

/** The header's dimensions in strip order, and the field_evidence name each one is attributed under. */
export const HEADER_FACETS: Array<{ dimension: ProfileFacet; field: string | null; titleCase: boolean }> = [
  { dimension: 'body_style', field: 'body_style', titleCase: true },
  { dimension: 'engine', field: 'engine_size', titleCase: false },
  { dimension: 'transmission', field: 'transmission', titleCase: true },
  { dimension: 'drivetrain', field: 'drivetrain', titleCase: false },
  { dimension: 'location', field: null, titleCase: false },
];
export const HEADER_EVIDENCE_FIELDS = ['body_style', 'engine_size', 'transmission', 'drivetrain', 'mileage'];

/** A column with no attribution is shown as what it is: the legacy record, trusted a little, never ranked as evidence. */
export const LEGACY_SOURCE: Source = { kind: 'legacy', label: 'vehicle record' };
export const LEGACY_TRUST = 0.3;

/** Declared reader calibration by evidence class, used only when a row carries no confidence of its own. */
export const KIND_TRUST: Record<Source['kind'], number> = {
  owner: 0.9, document: 0.85, image: 0.8, listing: 0.6, agent: 0.5, model: 0.4, legacy: LEGACY_TRUST,
};

/** Declared calibration for the typed price fact, by kind. A recorded sale is not a bid is not an ask. */
export const PRICE_TRUST: Record<string, number> = { sold: 0.9, bid: 0.7, ask: 0.5, estimate: 0.4 };

/** field_evidence.source_type names a method; the kit wants an evidence class. */
export function sourceKindFor(sourceType: string | null | undefined): Source['kind'] {
  const s = String(sourceType || '').toLowerCase();
  if (!s || s === 'vehicle_record' || s === 'system_update') return 'legacy';
  if (/pixel|image|photo|plate|exif/.test(s)) return 'image';
  if (/listing|trailer|\bbat\b|auction|craigslist|classified|marketplace/.test(s)) return 'listing';
  if (/manual|documentation|corpus|spid|rpo|title|receipt|document|invoice/.test(s)) return 'document';
  if (/owner|user/.test(s)) return 'owner';
  if (/agent|llm|claude|gpt|vision|model/.test(s)) return 'agent';
  return 'legacy';
}

const normalize = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

export function titleCase(s: string): string {
  return s.trim().split(/\s+/).map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
}

/** The best accepted evidence row whose value is what the record shows; otherwise the legacy claim. */
export function attributedClaim(value: string, field: string | null, evidence: EvidenceRow[]): Claim<string> {
  const rows = field
    ? evidence.filter(r => r.field_name === field && r.status === 'accepted' && r.proposed_value != null && normalize(String(r.proposed_value)) === normalize(value))
    : [];
  const best = [...rows].sort((a, b) => (b.source_confidence ?? 0) - (a.source_confidence ?? 0))[0];
  if (!best) return { value, source: LEGACY_SOURCE, observed_at: null, trust: LEGACY_TRUST };
  const kind = sourceKindFor(best.source_type);
  const confidence = best.source_confidence;
  return {
    value,
    source: { kind, label: best.source_type ? best.source_type.replace(/_/g, ' ') : null, method: best.source_type ?? null },
    observed_at: best.extracted_at,
    trust: confidence != null && Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence / 100)) : KIND_TRUST[kind],
  };
}

/** A reading without a source is a guess, and a guess is not shown. */
export function odometerClaim(vehicle: HeaderVehicle, evidence: EvidenceRow[]): Claim<number> | null {
  const raw = vehicle?.mileage ?? vehicle?.odometer ?? vehicle?.miles;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const attributed = attributedClaim(String(Math.round(n)), 'mileage', evidence);
  if (attributed.source.kind !== 'legacy') return { ...attributed, value: n, unit: 'mi' };
  const sourceLabel = typeof vehicle?.mileage_source === 'string' ? vehicle.mileage_source.trim() : '';
  if (!sourceLabel) return null;
  const kind = sourceKindFor(sourceLabel);
  return { value: n, unit: 'mi', source: { kind: kind === 'legacy' ? 'listing' : kind, label: sourceLabel }, observed_at: null, trust: KIND_TRUST[kind === 'legacy' ? 'listing' : kind] };
}

/** The headline price as a claim: what kind of price, from which platform, as of when. */
export function priceClaim(p: PriceFacts | null): { label: string; claim: Claim<number>; classified: boolean } | null {
  const label = priceKindLabel(p);
  if (!p || !label || p.price_amount == null) return null;
  const classified = isClassifiedPresentation(p);
  return {
    label: p.price_kind === 'sold' ? 'Last recorded sale' : label,
    classified,
    claim: {
      value: p.price_amount,
      unit: classified ? '' : 'USD',
      source: { kind: 'listing', url: p.source_url ?? null, label: p.platform ? p.platform.replace(/[-_]/g, ' ').toUpperCase() : null, method: p.price_kind ?? null },
      observed_at: p.price_as_of,
      trust: PRICE_TRUST[p.price_kind ?? ''] ?? 0.5,
    },
  };
}

export type BuildInput = {
  vehicle: HeaderVehicle;
  priceFacts: PriceFacts | null;
  evidence: EvidenceRow[];
  viewer: Viewer;
  /** A live auction owns its clock-matched price in the live banner; the masthead then shows none. */
  priceOwnedByLiveStack: boolean;
  readAt?: string;
};

export function buildProfileDocument(input: BuildInput): ProfileDocument {
  const { vehicle } = input;
  const tokens = getVehicleIdentityTokens(vehicle, { transmissionStrategy: 'never' });
  const price = input.priceOwnedByLiveStack ? null : priceClaim(input.priceFacts);
  const sections: Section[] = [{
    kind: 'masthead',
    identity: { primary: tokens.primary, differentiators: tokens.differentiators },
    year: vehicle?.year ?? null,
    make: vehicle?.make ?? null,
    model: tokens.primary.find(t => t.kind === 'model')?.value ?? vehicle?.model ?? null,
    price: price?.claim ?? null,
    priceLabel: price ? `${price.label}${price.classified ? ' · currency unrecorded' : ''}` : null,
  }];

  const facets = HEADER_FACETS.flatMap(f => {
    const value = profileFacetValue(vehicle, f.dimension);
    if (!value || !String(value).trim()) return [];
    const member = attributedClaim(String(value), f.field, input.evidence);
    return [{ dimension: f.dimension, label: f.titleCase ? titleCase(String(value)) : String(value), member }];
  });
  const odometer = odometerClaim(vehicle, input.evidence);
  const shown = facets.length + (odometer ? 1 : 0);
  if (shown > 0) {
    const claims = [...facets.map(f => f.member), ...(odometer ? [odometer] : [])];
    const attributed = claims.filter(c => c.source.kind !== 'legacy').length;
    const asOf = claims.map(c => c.observed_at).filter((t): t is string => !!t).sort().pop() ?? null;
    sections.push({ kind: 'strip', coverage: { n: attributed, of: shown, grain: 'facts attributed', as_of: asOf }, facets, odometer });
  }

  return { vehicle_id: String(vehicle?.id ?? ''), viewer: input.viewer, read_at: input.readAt ?? new Date().toISOString(), sections };
}

/** Accepted field evidence for the header's fields: one request, shared by every reader on the page. */
export function useProfileEvidence(vehicleId: string | undefined) {
  const query = useQuery({
    queryKey: ['profile-evidence', vehicleId],
    queryFn: async (): Promise<EvidenceRow[]> => {
      if (!vehicleId) return [];
      const { data, error } = await supabase
        .from('field_evidence')
        .select('field_name, proposed_value, source_type, source_confidence, extracted_at, status')
        .eq('vehicle_id', vehicleId)
        .in('field_name', HEADER_EVIDENCE_FIELDS)
        .eq('status', 'accepted')
        .limit(200);
      if (error) throw error;
      return (data || []) as EvidenceRow[];
    },
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
  return { rows: query.data ?? [], settled: !vehicleId || !query.isLoading };
}

export function useProfileDocument(vehicle: HeaderVehicle | null | undefined, priceFacts: PriceFacts | null, priceOwnedByLiveStack: boolean, viewer: Viewer): ProfileDocument | null {
  const { rows } = useProfileEvidence(vehicle?.id ?? undefined);
  return useMemo(
    () => (vehicle ? buildProfileDocument({ vehicle, priceFacts, evidence: rows, viewer, priceOwnedByLiveStack }) : null),
    [vehicle, priceFacts, rows, viewer, priceOwnedByLiveStack],
  );
}

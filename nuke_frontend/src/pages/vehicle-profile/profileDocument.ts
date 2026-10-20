// The vehicle page's ProfileDocument, read in one request from vehicle_profile_read: a viewer-scoped
// SQL read whose row policies bound what the document can carry. The header never learns which
// table a fact came from; the shape (kit/types.ts) is the contract, and the read's own contract
// (supabase/sql/test_vehicle_profile_read.sql) proves the values. Two things happen on this side of
// the wire, both presentation: the title's identity tokens (display hygiene over the raw identity
// columns the read ships) and the rule that a live auction's banner owns the headline price.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { getVehicleIdentityTokens, type VehicleIdentitySource } from '../../utils/vehicleIdentity';
import type { ProfileDocument } from '../../kit';
// The kit index exports the Section component under the same name, which hides this type there.
import type { Section } from '../../kit/types';

type Masthead = Extract<Section, { kind: 'masthead' }>;
/** The masthead as the read ships it: the raw identity columns in place of tokens. */
export type MastheadRead = Omit<Masthead, 'identity'> & { identity_source: VehicleIdentitySource };
export type ReadSection = MastheadRead | Exclude<Section, { kind: 'masthead' }>;
/** The listing's full prose as captured (the newest readable description capture), or null. */
export type ProfileDescription = {
  text: string;
  length: number;
  source: { kind: string; url: string | null; method: string | null };
  observed_at: string | null;
};
/** What vehicle_profile_read returns. */
export type ProfileRead = Omit<ProfileDocument, 'sections'> & {
  sections: ReadSection[];
  description?: ProfileDescription | null;
  identity_marks?: Record<string, unknown>[];
};

const SECTION_KINDS = new Set(['masthead', 'strip', 'measures', 'timeline', 'table', 'gallery']);
const VIEWERS = new Set(['anon', 'contributor', 'owner']);

/**
 * A payload the renderer may trust: the document's spine is present and every section names a
 * kind the kit renders. Anything else renders nothing, never a guess.
 */
export function isProfileRead(x: unknown): x is ProfileRead {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  if (typeof r.vehicle_id !== 'string' || typeof r.read_at !== 'string' || !VIEWERS.has(String(r.viewer))) return false;
  if (!Array.isArray(r.sections)) return false;
  return r.sections.every(s => {
    if (!s || typeof s !== 'object') return false;
    const section = s as { kind?: unknown; identity_source?: unknown };
    if (!SECTION_KINDS.has(String(section.kind))) return false;
    return section.kind !== 'masthead' || (!!section.identity_source && typeof section.identity_source === 'object');
  });
}

/** The read's document as the kit renders it. */
export function profileDocumentFrom(read: ProfileRead, priceOwnedByLiveStack: boolean): ProfileDocument {
  return {
    vehicle_id: read.vehicle_id,
    viewer: read.viewer,
    read_at: read.read_at,
    sections: read.sections.map((section): Section => {
      if (section.kind !== 'masthead') return section;
      const { identity_source, ...rest } = section;
      const tokens = getVehicleIdentityTokens(identity_source, { transmissionStrategy: 'never' });
      return {
        ...rest,
        identity: { primary: tokens.primary, differentiators: tokens.differentiators },
        model: tokens.primary.find(t => t.kind === 'model')?.value ?? rest.model ?? null,
        price: priceOwnedByLiveStack ? null : rest.price ?? null,
        priceLabel: priceOwnedByLiveStack ? null : rest.priceLabel ?? null,
      };
    }),
  };
}

/** One request per vehicle for the header's document, shared by every reader on the page. */
export function useProfileRead(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle-profile-read', vehicleId],
    queryFn: async (): Promise<ProfileRead | null> => {
      if (!vehicleId) return null;
      const { data, error } = await supabase.rpc('vehicle_profile_read', { p_vehicle_id: vehicleId });
      if (error) throw error;
      return isProfileRead(data) ? data : null;
    },
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
}

export function useProfileDocument(vehicleId: string | undefined, priceOwnedByLiveStack: boolean): ProfileDocument | null {
  const { data } = useProfileRead(vehicleId);
  return useMemo(() => (data ? profileDocumentFrom(data, priceOwnedByLiveStack) : null), [data, priceOwnedByLiveStack]);
}

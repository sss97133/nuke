/**
 * entityProof — a generic, read-only proof/completeness computation for an
 * entity (vehicle | organization), from EXISTING tables. No schema change.
 *
 * This is the read-model behind the chain entity → proof → profile → projection
 * (see docs/library/technical/engineering-manual/20-polymorphic-subject-build-guide.md).
 * It demonstrates the polymorphic *read* pattern against today's schema, before
 * the polymorphic-subject migration is approved: the same shape describes how
 * "built out" any entity is, and which proof is still missing.
 *
 * Doctrine held:
 * - No fabrication. Every signal is a real query against a real table; an empty
 *   signal is an honest intake gap, never a guess.
 * - Gate signals (per the-illegible-asset.md) are the un-fakeable artifacts —
 *   weighted highest, because they are what makes a profile real rather than
 *   decorative. Ownership/identity prove *existence*, not *formation*.
 */

import { supabase } from '../lib/supabase';

export type EntityType = 'vehicle' | 'organization' | 'user';

export interface ProofSignal {
  key: string;
  label: string;
  present: boolean;
  /** weight toward proofScore; gate signals carry the most */
  weight: number;
  /** true = an un-fakeable formation artifact, not mere identity/ownership */
  gate?: boolean;
  detail?: string;
}

export interface EntityProof {
  entityType: EntityType;
  entityId: string;
  signals: ProofSignal[];
  /** 0..100, weighted share of present signals */
  proofScore: number;
  /** labels of the absent signals, highest-weight first */
  gaps: string[];
  /** true once at least one GATE artifact is present — the profile is "real" */
  hasFormationProof: boolean;
}

function score(signals: ProofSignal[]): Omit<EntityProof, 'entityType' | 'entityId'> {
  const totalW = signals.reduce((s, x) => s + x.weight, 0) || 1;
  const gotW = signals.filter((x) => x.present).reduce((s, x) => s + x.weight, 0);
  const proofScore = Math.round((gotW / totalW) * 100);
  const gaps = signals
    .filter((x) => !x.present)
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.label);
  const hasFormationProof = signals.some((x) => x.gate && x.present);
  return { signals, proofScore, gaps, hasFormationProof };
}

/** count rows matching a simple eq filter, robust to absent data. */
async function countWhere(
  table: string,
  build: (q: any) => any,
): Promise<number> {
  try {
    const q = build(supabase.from(table).select('id', { count: 'exact', head: true }));
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function vehicleProof(id: string): Promise<EntityProof> {
  const { data: v } = await supabase
    .from('vehicles')
    .select('id, vin, year, make, model, primary_image_url, image_count, has_photos, ownership_verified')
    .eq('id', id)
    .maybeSingle();

  const events = await countWhere('vehicle_events', (q) => q.eq('vehicle_id', id));
  const observations = await countWhere('vehicle_observations', (q) => q.eq('vehicle_id', id));

  const signals: ProofSignal[] = [
    { key: 'identity', label: 'Year/make/model', weight: 1, present: !!(v?.year && v?.make) },
    { key: 'vin', label: 'VIN on record', weight: 2, present: !!v?.vin },
    { key: 'photos', label: 'Photos', weight: 1, present: !!(v?.has_photos || (v?.image_count ?? 0) > 0) },
    { key: 'events', label: 'Timeline events', weight: 2, gate: true, present: events > 0, detail: `${events} events` },
    { key: 'observations', label: 'Verified observations', weight: 3, gate: true, present: observations > 0, detail: `${observations} observations` },
    { key: 'ownership', label: 'Ownership confirmed', weight: 2, present: !!v?.ownership_verified },
  ];
  return { entityType: 'vehicle', entityId: id, ...score(signals) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function orgProof(ref: string): Promise<EntityProof> {
  // ref may be a UUID or a slug (modes carry the slug).
  const { data: o } = await supabase
    .from('organizations')
    .select('id, business_name, is_verified, total_vehicles, total_images, total_events')
    .eq(UUID_RE.test(ref) ? 'id' : 'slug', ref)
    .maybeSingle();
  const id = o?.id ?? ref;

  const activeContributors = await countWhere('organization_contributors', (q) =>
    q.eq('organization_id', id).eq('status', 'active'),
  );
  const approvedOwnership = await countWhere('organization_ownership_verifications', (q) =>
    q.eq('organization_id', id).eq('status', 'approved'),
  );
  const verifiedLicenses = await countWhere('shop_licenses', (q) =>
    q.eq('shop_id', id).eq('is_verified', true),
  );
  const locatedWithCoords = await countWhere('shop_locations', (q) =>
    q.eq('shop_id', id).not('latitude', 'is', null),
  );
  // GATE: an independent-counterparty money event tied to this org (un-fakeable
  // existence of real commerce — see the-illegible-asset.md). Existence signal;
  // valuation/round-trip filtering is a later, provenance-graded concern.
  const counterpartyPayments = await countWhere('payment_events', (q) =>
    q.eq('counterparty_org_id', id),
  );
  // GATE: a documented job done under the org.
  const workOrders = await countWhere('work_orders', (q) => q.eq('org_id', id));

  const signals: ProofSignal[] = [
    { key: 'identity', label: 'Org name', weight: 1, present: !!o?.business_name },
    { key: 'ownership', label: 'Ownership verified (filing)', weight: 2, present: approvedOwnership > 0, detail: 'proves ownership, not formation' },
    { key: 'people', label: 'Active contributors', weight: 1, present: activeContributors > 0, detail: `${activeContributors}` },
    { key: 'location', label: 'Located (geo coords)', weight: 1, present: locatedWithCoords > 0 },
    { key: 'license', label: 'Verified license', weight: 1, present: verifiedLicenses > 0 },
    { key: 'inventory', label: 'Vehicles attached', weight: 1, present: (o?.total_vehicles ?? 0) > 0 },
    { key: 'media', label: 'Images', weight: 1, present: (o?.total_images ?? 0) > 0 },
    { key: 'work_record', label: 'Documented jobs', weight: 3, gate: true, present: workOrders > 0, detail: `${workOrders} work orders` },
    { key: 'independent_revenue', label: 'Independent-counterparty transaction', weight: 4, gate: true, present: counterpartyPayments > 0, detail: 'the un-fakeable artifact' },
  ];
  return { entityType: 'organization', entityId: id, ...score(signals) };
}

async function userProof(id: string): Promise<EntityProof> {
  const { data: p } = await supabase
    .from('profiles')
    .select('id, username, full_name, bio, avatar_url, is_verified')
    .eq('id', id)
    .maybeSingle();

  // A user's formation proof IS their accumulated work — the green squares.
  // Contributions (vehicles they discovered/built) and verified affiliations.
  const contributions = await countWhere('vehicles', (q) => q.eq('created_by_user_id', id));
  const affiliations = await countWhere('organization_contributors', (q) =>
    q.eq('user_id', id).eq('status', 'active'),
  );

  const signals: ProofSignal[] = [
    { key: 'identity', label: 'Username', weight: 1, present: !!p?.username },
    { key: 'name', label: 'Full name', weight: 1, present: !!p?.full_name },
    { key: 'avatar', label: 'Avatar', weight: 1, present: !!p?.avatar_url },
    { key: 'bio', label: 'Bio', weight: 1, present: !!p?.bio },
    { key: 'affiliations', label: 'Org affiliations', weight: 1, present: affiliations > 0, detail: `${affiliations}` },
    { key: 'verified', label: 'Identity verified', weight: 2, present: !!p?.is_verified },
    { key: 'contributions', label: 'Documented contributions', weight: 4, gate: true, present: contributions > 0, detail: `${contributions} vehicles` },
  ];
  return { entityType: 'user', entityId: id, ...score(signals) };
}

export async function entityProof(entityType: EntityType, entityId: string): Promise<EntityProof> {
  switch (entityType) {
    case 'vehicle':
      return vehicleProof(entityId);
    case 'organization':
      return orgProof(entityId);
    case 'user':
      return userProof(entityId);
  }
}

/**
 * The projection gate (engineering-manual/20, the-illegible-asset.md): an entity
 * may be WORN as a Nuke app only if it has a formation artifact — real proof of
 * being built out, not just identity/ownership. No formation proof → not
 * wearable; the mode would be a costume over an empty framework. Reads real
 * proof from real tables; fabricates nothing.
 */
export async function canProject(entityType: EntityType, entityId: string): Promise<boolean> {
  try {
    const proof = await entityProof(entityType, entityId);
    return proof.hasFormationProof;
  } catch {
    return false; // fail closed — never project on an error
  }
}

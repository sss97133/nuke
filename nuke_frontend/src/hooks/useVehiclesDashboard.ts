/**
 * useVehiclesDashboard.ts
 * Garage data hook — reads ownership periods and their verification evidence,
 * and provides view/sort/filter state for the garage UI.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { applyGarageOwnerCorrections, unresolvedGarageSources, type GarageOwnerCorrection, type UnresolvedGarageSource } from './garageOwnerCorrections';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelationshipType =
  | 'VERIFIED OWNER'
  | 'OWNER'
  | 'CO-OWNER'
  | 'PREVIOUSLY OWNED'
  | 'CONSIGNED'
  | 'SHARED INTEREST'
  | 'CLAIMED INTEREST'
  | 'BUSINESS HANDLING'
  | 'SALES REPRESENTATIVE'
  | 'TRANSFER PENDING'
  | 'RELATIONSHIP REVIEW'
  | 'OWNERSHIP CLAIM'
  | 'CONTRIBUTOR';

export type ViewMode = 'GRID' | 'LIST' | 'COMPACT';
export type SortMode = 'RECENT' | 'VALUE' | 'HEALTH' | 'NAME';
export type FilterMode = 'ALL' | 'OWNED' | 'CONTRIBUTED';

export interface EventSummary {
  total_events: number;
  times_sold: number;
  platforms: string[];
  first_event_date: string | null;
  last_event_date: string | null;
}

export interface GarageVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  primary_image_url: string | null;
  resolved_image_url: string | null;
  estimated_value: number | null;
  purchase_price: number | null;
  value_delta: number | null;
  health_score: number | null;
  confidence_score?: number | null;
  image_count: number | null;
  event_count: number | null;
  view_count: number | null;
  last_event_title: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
  relationship_type: RelationshipType;
  relationship_source: 'verification' | 'ownership' | 'permission' | 'contributor' | 'discovered' | 'uploaded_by' | 'owner_statement';
  relationship_roles?: RelationshipType[];
  relationship_detail?: string;
  relationship_id?: string;
  ownership_start_date?: string | null;
  ownership_end_date?: string | null;
  estimate_calculated_at?: string | null;
  permission_role?: string;
  event_weeks: string[] | null;
  event_summary: EventSummary | null;
}

export interface GarageSection {
  relationship_type: RelationshipType;
  vehicles: GarageVehicle[];
}

/** Dashboard page: "my" vehicles (owned, co-owned, consigned, previously owned) */
export interface MyVehicle {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  acquisition_date: string | null;
  last_activity_date: string | null;
  event_count: number | null;
  image_count: number | null;
  confidence_score: number;
  interaction_score: number;
  primary_image_url: string | null;
  current_value?: number | null;
  purchase_price?: number | null;
}

/** Dashboard page: client/contributor vehicles (same row shape as MyVehicle) */
export type ClientVehicle = MyVehicle;

/** Dashboard page: business fleet group */
export interface BusinessFleet {
  id: string;
  name: string;
  vehicle_count: number;
  vehicles: MyVehicle[];
}

/** Dashboard page: aggregate counts for stats bar */
export interface DashboardSummary {
  total_my_vehicles: number;
  total_client_vehicles: number;
  total_business_vehicles: number;
  recent_activity_30d: number;
}

export interface VehiclesDashboardState {
  unresolvedSources?: UnresolvedGarageSource[];
  sections: GarageSection[];
  vehicles: GarageVehicle[];
  totalEstimatedValue: number;
  isLoading: boolean;
  error: string | null;
  viewMode: ViewMode;
  sortMode: SortMode;
  filterMode: FilterMode;
  setViewMode: (m: ViewMode) => void;
  setSortMode: (m: SortMode) => void;
  setFilterMode: (m: FilterMode) => void;
  refresh: () => void;
  /** Dashboard page shape: my_vehicles, client_vehicles, business_fleets, summary */
  data: {
    my_vehicles: MyVehicle[];
    client_vehicles: ClientVehicle[];
    business_fleets: BusinessFleet[];
    summary: DashboardSummary;
  } | null;
  /** Alias for isLoading for dashboard page */
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Relationship priority — higher index = higher authority
// ---------------------------------------------------------------------------

const RELATIONSHIP_PRIORITY: RelationshipType[] = [
  'RELATIONSHIP REVIEW',
  'CONTRIBUTOR',
  'SALES REPRESENTATIVE',
  'BUSINESS HANDLING',
  'OWNERSHIP CLAIM',
  'TRANSFER PENDING',
  'CLAIMED INTEREST',
  'SHARED INTEREST',
  'PREVIOUSLY OWNED',
  'CONSIGNED',
  'CO-OWNER',
  'OWNER',
  'VERIFIED OWNER',
];

interface OwnershipPeriod {
  id: string;
  vehicle_id: string;
  role: string | null;
  is_current: boolean;
  start_date: string | null;
  end_date: string | null;
  verification_id: string | null;
  created_at: string;
}

interface Verification {
  id: string;
  vehicle_id: string;
  status: string;
  expires_at: string | null;
}

interface GarageRelationship {
  type: RelationshipType;
  source: GarageVehicle['relationship_source'];
  id: string;
  role?: string;
  start_date: string | null;
  end_date: string | null;
}

function verificationIsCurrent(row: Verification | undefined, now: Date): boolean {
  return !!row && row.status === 'approved' &&
    (!row.expires_at || new Date(row.expires_at).getTime() > now.getTime());
}

// The period establishes the relationship; verification corroborates it.
// A past approval cannot override a disposal or turn an unknown role into title.
export function resolveGarageRelationships(
  periods: OwnershipPeriod[],
  verifications: Verification[],
  discoveries: { id: string; vehicle_id: string }[],
  now = new Date(),
): Map<string, GarageRelationship> {
  const result = new Map<string, GarageRelationship>();
  const proofs = new Map(verifications.map(v => [v.id, v]));
  const today = now.toISOString().slice(0, 10);
  const current = (p: OwnershipPeriod) => p.is_current && !p.end_date &&
    (!p.start_date || p.start_date <= today);

  for (const d of discoveries) {
    result.set(d.vehicle_id, { type: 'PREVIOUSLY OWNED', source: 'discovered', id: d.id, start_date: null, end_date: null });
  }
  for (const v of verifications) {
    const existing = result.get(v.vehicle_id);
    if (!existing || (existing.type === 'OWNERSHIP CLAIM' && verificationIsCurrent(v, now))) {
      result.set(v.vehicle_id, { type: verificationIsCurrent(v, now) ? 'VERIFIED OWNER' : 'OWNERSHIP CLAIM',
        source: 'verification', id: v.id, start_date: null, end_date: null });
    }
  }
  // Reacquisition wins over an earlier ended period; otherwise use the latest
  // recorded period deterministically. Row creation is never acquisition time.
  const selected = new Map<string, OwnershipPeriod>();
  for (const p of [...periods].sort((a, b) => Number(current(b)) - Number(current(a)) ||
    (b.start_date ?? '').localeCompare(a.start_date ?? '') ||
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))) {
    if (!selected.has(p.vehicle_id)) selected.set(p.vehicle_id, p);
  }
  for (const p of selected.values()) {
    const role = p.role?.toLowerCase();
    const ownerRoles = ['verified_owner', 'owner', 'current_owner', 'co_owner', 'co-owner', 'previous_owner'];
    let type: RelationshipType = 'OWNERSHIP CLAIM';
    if ((!p.start_date || p.start_date <= today) && role && ownerRoles.includes(role)) {
      if (role === 'previous_owner' || (p.end_date && p.end_date <= today)) type = 'PREVIOUSLY OWNED';
      else if (current(p)) {
        const proof = proofs.get(p.verification_id ?? '');
        type = role === 'co_owner' || role === 'co-owner' ? 'CO-OWNER'
          : proof?.vehicle_id === p.vehicle_id && verificationIsCurrent(proof, now) ? 'VERIFIED OWNER' : 'OWNER';
      }
    } else if (role === 'consigned' && current(p)) type = 'CONSIGNED';
    result.set(p.vehicle_id, { type, source: 'ownership', id: p.id, role: p.role ?? undefined,
      start_date: p.start_date, end_date: p.end_date });
  }
  return result;
}


// ---------------------------------------------------------------------------
// Filter / Sort / Section helpers
// ---------------------------------------------------------------------------

function matchesFilter(v: GarageVehicle, filter: FilterMode): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'OWNED') return ['VERIFIED OWNER', 'OWNER', 'CO-OWNER', 'PREVIOUSLY OWNED'].includes(v.relationship_type);
  if (filter === 'CONTRIBUTED') return v.relationship_type === 'CONTRIBUTOR';
  return true;
}

function sortVehicles(a: GarageVehicle, b: GarageVehicle, sort: SortMode): number {
  switch (sort) {
    case 'VALUE':
      return (b.estimated_value ?? 0) - (a.estimated_value ?? 0);
    case 'HEALTH':
      return (b.health_score ?? 0) - (a.health_score ?? 0);
    case 'NAME': {
      const nameA = `${a.year ?? ''} ${a.make ?? ''} ${a.model ?? ''}`.trim();
      const nameB = `${b.year ?? ''} ${b.make ?? ''} ${b.model ?? ''}`.trim();
      return nameA.localeCompare(nameB);
    }
    case 'RECENT':
    default:
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }
}

function garageToMyVehicle(v: GarageVehicle): MyVehicle {
  return {
    vehicle_id: v.id,
    year: v.year,
    make: v.make,
    model: v.model,
    acquisition_date: v.ownership_start_date ?? null,
    last_activity_date: v.last_event_at ?? v.updated_at ?? null,
    event_count: v.event_count,
    image_count: v.image_count,
    confidence_score: v.confidence_score ?? 0,
    interaction_score: 0,
    primary_image_url: v.resolved_image_url ?? v.primary_image_url ?? null,
    current_value: v.estimated_value,
    purchase_price: v.purchase_price,
  };
}

const MY_RELATIONSHIP_TYPES: RelationshipType[] = ['VERIFIED OWNER', 'OWNER', 'CO-OWNER', 'PREVIOUSLY OWNED'];

function buildDashboardData(
  sections: GarageSection[],
  vehicles: GarageVehicle[],
): { my_vehicles: MyVehicle[]; client_vehicles: ClientVehicle[]; business_fleets: BusinessFleet[]; summary: DashboardSummary } {
  const myVehicles: MyVehicle[] = [];
  const clientVehicles: ClientVehicle[] = [];
  for (const s of sections) {
    const list = s.vehicles.map(garageToMyVehicle);
    if (MY_RELATIONSHIP_TYPES.includes(s.relationship_type)) {
      myVehicles.push(...list);
    } else if (['CONTRIBUTOR', 'CONSIGNED', 'SALES REPRESENTATIVE'].includes(s.relationship_type)) {
      clientVehicles.push(...list);
    }
  }
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const recentActivity30d = vehicles.filter((v) => {
    const t = v.last_event_at ?? v.updated_at;
    return t ? new Date(t).getTime() >= thirtyDaysAgo : false;
  }).length;
  return {
    my_vehicles: myVehicles,
    client_vehicles: clientVehicles,
    business_fleets: [],
    summary: {
      total_my_vehicles: myVehicles.length,
      total_client_vehicles: clientVehicles.length,
      total_business_vehicles: 0,
      recent_activity_30d: recentActivity30d,
    },
  };
}

function buildSections(vehicles: GarageVehicle[]): GarageSection[] {
  const map = new Map<RelationshipType, GarageVehicle[]>();
  for (const v of vehicles) {
    if (!map.has(v.relationship_type)) map.set(v.relationship_type, []);
    map.get(v.relationship_type)!.push(v);
  }
  // Sections ordered high→low priority
  return [...RELATIONSHIP_PRIORITY]
    .reverse()
    .filter((rt) => map.has(rt))
    .map((rt) => ({ relationship_type: rt, vehicles: map.get(rt)! }));
}

// ---------------------------------------------------------------------------
// Vehicle select columns (only columns that exist on the vehicles table)
// ---------------------------------------------------------------------------

const VEHICLE_SELECT = 'id, year, make, model, normalized_model, trim, vin, purchase_price, primary_image_url, image_count, confidence_score, heat_score, view_count, created_at, updated_at, status';

const VISIBLE_STATUSES = new Set(['active', 'pending', 'discovered', 'pending_backfill']);

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  normalized_model?: string | null;
  trim: string | null;
  vin: string | null;
  purchase_price: number | null;
  primary_image_url: string | null;
  image_count: number | null;
  confidence_score: number | null;
  heat_score: number | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
  status: string | null;
}

function rowToGarageVehicle(
  row: VehicleRow,
  relationship: GarageRelationship,
  estimate?: { estimated_value: number; calculated_at: string } | null,
  image_count?: number | null,
  fallback_image_url?: string | null,
  event_weeks?: string[] | null,
  event_summary?: EventSummary | null,
): GarageVehicle {
  const estimated_value = estimate?.estimated_value ?? null;

  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.normalized_model?.trim() || row.model,
    trim: row.trim,
    vin: row.vin,
    primary_image_url: row.primary_image_url,
    resolved_image_url: row.primary_image_url || fallback_image_url || null,
    estimated_value,
    purchase_price: row.purchase_price,
    // Vehicle-level purchase price is not an attributed ownership-period cost.
    value_delta: null,
    // Data confidence does not describe the vehicle's mechanical condition.
    health_score: null,
    confidence_score: row.confidence_score,
    image_count: image_count ?? null,
    event_count: event_summary?.total_events ?? null,
    view_count: row.view_count,
    last_event_title: null,
    last_event_at: event_summary?.last_event_date ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    relationship_type: relationship.type,
    relationship_source: relationship.source,
    relationship_id: relationship.id,
    ownership_start_date: relationship.start_date,
    ownership_end_date: relationship.end_date,
    estimate_calculated_at: estimate?.calculated_at ?? null,
    permission_role: relationship.role,
    event_weeks: event_weeks ?? null,
    event_summary: event_summary ?? null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVehiclesDashboard(userId: string | undefined | null): VehiclesDashboardState {
  const [rawVehicles, setRawVehicles] = useState<GarageVehicle[]>([]);
  const [unresolvedSources, setUnresolvedSources] = useState<UnresolvedGarageSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [sortMode, setSortMode] = useState<SortMode>('RECENT');
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) {
      setRawVehicles([]);
      setUnresolvedSources([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setRawVehicles([]);
    setUnresolvedSources([]);
    setIsLoading(true);
    setError(null);

    async function fetchAll() {
      try {
        // Preserve the May 23 owner decision: import permissions, contributors
        // and uploaded_by are not evidence of ownership and stay excluded.
        const [verifiedRes, prevOwnedRes, ownershipRes, correctionRes] = await Promise.all([
          supabase.from('ownership_verifications')
            .select('id, vehicle_id, status, expires_at')
            .eq('user_id', userId)
            .eq('status', 'approved'),
          supabase.from('discovered_vehicles')
            .select('id, vehicle_id')
            .eq('user_id', userId)
            .eq('relationship_type', 'previously_owned')
            .eq('is_active', true),
          supabase.from('vehicle_ownerships')
            .select('id, vehicle_id, role, is_current, start_date, end_date, verification_id, created_at')
            .eq('owner_profile_id', userId),
          supabase.rpc('get_my_garage_owner_corrections', { p_user_id: userId, p_include_unresolved: true }),
        ]);
        if (cancelled) return;
        for (const res of [verifiedRes, prevOwnedRes, ownershipRes, correctionRes]) {
          if (res.error) throw new Error('Garage relationships unavailable. Please retry.');
        }
        const relMap = resolveGarageRelationships(
          ownershipRes.data ?? [], verifiedRes.data ?? [], prevOwnedRes.data ?? [],
        );
        const corrections = (correctionRes.data ?? []) as GarageOwnerCorrection[];
        // Statements can concern a vehicle missing from the legacy ownership union.
        for (const c of corrections) {
          if (!c.vehicle_id) continue;
          if (!relMap.has(c.vehicle_id)) relMap.set(c.vehicle_id, { type: 'RELATIONSHIP REVIEW',
            source: 'owner_statement', id: c.id, start_date: null, end_date: null });
        }

        // Hydrate all vehicle IDs in the relationship map
        const idsToFetch = Array.from(relMap.keys());

        let allRows = new Map<string, VehicleRow>();
        if (idsToFetch.length > 0) {
          // Batch in chunks of 100
          const chunks: string[][] = [];
          for (let i = 0; i < idsToFetch.length; i += 100) {
            chunks.push(idsToFetch.slice(i, i + 100));
          }
          const chunkResults = await Promise.all(
            chunks.map(chunk =>
              supabase.from('vehicles').select(VEHICLE_SELECT).in('id', chunk)
            )
          );
          for (const res of chunkResults) {
            if (res.error) throw new Error('Garage vehicles unavailable. Please retry.');
            if (res.data) {
              for (const v of res.data as VehicleRow[]) {
                allRows.set(v.id, v);
              }
            }
          }
        }

        if (cancelled) return;

        // Batch fetch image counts, fallback images, event summaries, event weeks in parallel
        const vehicleIdArray = Array.from(allRows.keys());
        const imageCounts = new Map<string, number>();
        const fallbackImages = new Map<string, string>();
        const eventSummaries = new Map<string, EventSummary>();
        const eventWeeksMap = new Map<string, string[]>();
        const estimates = new Map<string, { estimated_value: number; calculated_at: string }>();

        if (vehicleIdArray.length > 0) {
          // IDs missing primary_image_url need fallback images
          const needsFallback = vehicleIdArray.filter(id => !allRows.get(id)?.primary_image_url);

          // Image counts come from vehicles.image_count (trigger-maintained by
          // update_vehicle_image_count, verified exact in prod). The live
          // count_vehicle_images_batch RPC died on the 15s statement timeout and
          // froze the whole garage behind it.
          for (const [vid, row] of allRows) {
            if (row.image_count != null) imageCounts.set(vid, Number(row.image_count));
          }

          const [fallbackRes, eventSummaryRes, eventWeeksRes, estimateRes] = await Promise.all([
            needsFallback.length > 0
              ? supabase.rpc('get_first_image_batch', { vehicle_ids: needsFallback })
              : Promise.resolve({ data: [] }),
            supabase
              .from('vehicle_event_summary')
              .select('vehicle_id, total_events, times_sold, platform_list, first_event_date, last_event_date')
              .in('vehicle_id', vehicleIdArray),
            supabase.rpc('get_vehicle_event_weeks_batch', { vehicle_ids: vehicleIdArray }),
            // Preserve get_user_garage's existing build-class admission policy.
            // Never replace absent evidence with legacy value or purchase price.
            supabase.from('nuke_estimates')
              .select('vehicle_id, estimated_value, calculated_at')
              .in('vehicle_id', vehicleIdArray)
              .eq('comp_method', 'class_stratified')
              .eq('is_stale', false)
              .eq('is_circular', false),
          ]);
          if (estimateRes.error) throw new Error('Garage estimates unavailable. Please retry.');
          for (const e of estimateRes.data ?? []) {
            if (Number.isFinite(Number(e.estimated_value)) && Number(e.estimated_value) > 0 &&
                e.calculated_at && Number.isFinite(Date.parse(e.calculated_at))) {
              estimates.set(e.vehicle_id, { estimated_value: Number(e.estimated_value), calculated_at: e.calculated_at });
            }
          }

          if (fallbackRes.data) {
            for (const f of fallbackRes.data as { vehicle_id: string; image_url: string }[]) {
              fallbackImages.set(f.vehicle_id, f.image_url);
            }
          }
          if (eventSummaryRes.data) {
            for (const s of eventSummaryRes.data as any[]) {
              eventSummaries.set(s.vehicle_id, {
                total_events: Number(s.total_events) || 0,
                times_sold: Number(s.times_sold) || 0,
                platforms: s.platform_list || [],
                first_event_date: s.first_event_date,
                last_event_date: s.last_event_date,
              });
            }
          }
          if (eventWeeksRes.data) {
            for (const w of eventWeeksRes.data as { vehicle_id: string; event_week: string }[]) {
              if (!eventWeeksMap.has(w.vehicle_id)) eventWeeksMap.set(w.vehicle_id, []);
              eventWeeksMap.get(w.vehicle_id)!.push(w.event_week);
            }
          }
        }

        if (cancelled) return;

        // Build GarageVehicle array — filter out non-visible statuses
        const garage: GarageVehicle[] = [];
        for (const [id, row] of allRows) {
          const rel = relMap.get(id);
          if (!rel) continue;
          if (row.status && !VISIBLE_STATUSES.has(row.status)) continue;
          garage.push(rowToGarageVehicle(row, rel, estimates.get(id), imageCounts.get(id), fallbackImages.get(id), eventWeeksMap.get(id), eventSummaries.get(id)));
        }

        setRawVehicles(applyGarageOwnerCorrections(garage, corrections));
        setUnresolvedSources(unresolvedGarageSources(corrections));
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Unknown error fetching vehicles';
          setError(msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  // Derived state
  const vehicles = rawVehicles
    .filter((v) => matchesFilter(v, filterMode))
    .sort((a, b) => sortVehicles(a, b, sortMode));

  const sections = buildSections(vehicles);

  // Current ownership only; ended periods, claims and consignments are not assets.
  const totalEstimatedValue = vehicles
    .filter((v) => ['VERIFIED OWNER', 'OWNER', 'CO-OWNER'].includes(v.relationship_type))
    .reduce((sum, v) => sum + (v.estimated_value ?? 0), 0);

  const data = userId ? buildDashboardData(sections, vehicles) : null;

  return {
    sections,
    unresolvedSources,
    vehicles,
    totalEstimatedValue,
    isLoading,
    error,
    viewMode,
    sortMode,
    filterMode,
    setViewMode,
    setSortMode,
    setFilterMode,
    refresh,
    data,
    loading: isLoading,
  };
}

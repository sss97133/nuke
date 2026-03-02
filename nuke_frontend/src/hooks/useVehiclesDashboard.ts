/**
 * useVehiclesDashboard.ts
 * Garage data hook — queries 5 relationship sources in parallel,
 * resolves a canonical relationship per vehicle via priority ranking,
 * and provides view/sort/filter state for the garage UI.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelationshipType =
  | 'VERIFIED OWNER'
  | 'OWNER'
  | 'CO-OWNER'
  | 'PREVIOUSLY OWNED'
  | 'CONSIGNED'
  | 'CONTRIBUTOR'
  | 'UPLOADER'
  | 'WATCHING';

export type ViewMode = 'GRID' | 'LIST' | 'COMPACT';
export type SortMode = 'RECENT' | 'VALUE' | 'HEALTH' | 'NAME';
export type FilterMode = 'ALL' | 'OWNED' | 'WATCHING' | 'UPLOADED';

export interface GarageVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  primary_image_url: string | null;
  estimated_value: number | null;
  purchase_price: number | null;
  value_delta: number | null;
  health_score: number | null;
  image_count: number | null;
  event_count: number | null;
  view_count: number | null;
  last_event_title: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
  relationship_type: RelationshipType;
  relationship_source: 'verification' | 'permission' | 'contributor' | 'discovered' | 'uploaded_by';
  permission_role?: string;
}

export interface GarageSection {
  relationship_type: RelationshipType;
  vehicles: GarageVehicle[];
}

export interface VehiclesDashboardState {
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
}

// ---------------------------------------------------------------------------
// Relationship priority — higher index = higher authority
// ---------------------------------------------------------------------------

const RELATIONSHIP_PRIORITY: RelationshipType[] = [
  'WATCHING',
  'UPLOADER',
  'CONTRIBUTOR',
  'PREVIOUSLY OWNED',
  'CONSIGNED',
  'CO-OWNER',
  'OWNER',
  'VERIFIED OWNER',
];

function higherPriority(a: RelationshipType, b: RelationshipType): RelationshipType {
  return RELATIONSHIP_PRIORITY.indexOf(a) >= RELATIONSHIP_PRIORITY.indexOf(b) ? a : b;
}

function permissionRoleToRelationship(role: string): RelationshipType {
  const r = role.toLowerCase();
  if (r === 'owner') return 'OWNER';
  if (r === 'co_owner' || r === 'co-owner') return 'CO-OWNER';
  if (r === 'contributor') return 'CONTRIBUTOR';
  return 'CONTRIBUTOR';
}

function discoveredTypeToRelationship(type: string): RelationshipType | null {
  if (type === 'previously_owned') return 'PREVIOUSLY OWNED';
  if (type === 'consigned') return 'CONSIGNED';
  if (type === 'interested' || type === 'discovered' || type === 'curated') return 'WATCHING';
  return null;
}

// ---------------------------------------------------------------------------
// Filter / Sort / Section helpers
// ---------------------------------------------------------------------------

function matchesFilter(v: GarageVehicle, filter: FilterMode): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'OWNED') return ['VERIFIED OWNER', 'OWNER', 'CO-OWNER', 'PREVIOUSLY OWNED', 'CONSIGNED'].includes(v.relationship_type);
  if (filter === 'WATCHING') return v.relationship_type === 'WATCHING';
  if (filter === 'UPLOADED') return v.relationship_type === 'UPLOADER';
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

const VEHICLE_SELECT = 'id, year, make, model, trim, vin, current_value, purchase_price, primary_image_url, confidence_score, heat_score, view_count, created_at, updated_at';

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  current_value: number | null;
  purchase_price: number | null;
  primary_image_url: string | null;
  confidence_score: number | null;
  heat_score: number | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
}

function rowToGarageVehicle(
  row: VehicleRow,
  relationship_type: RelationshipType,
  relationship_source: GarageVehicle['relationship_source'],
  permission_role?: string,
): GarageVehicle {
  const estimated_value = row.current_value ?? row.purchase_price ?? null;
  const value_delta =
    row.current_value != null && row.purchase_price != null
      ? row.current_value - row.purchase_price
      : null;

  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    vin: row.vin,
    primary_image_url: row.primary_image_url,
    estimated_value,
    purchase_price: row.purchase_price,
    value_delta,
    health_score: row.confidence_score,
    image_count: null,
    event_count: null,
    view_count: row.view_count,
    last_event_title: null,
    last_event_at: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    relationship_type,
    relationship_source,
    permission_role,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVehiclesDashboard(userId: string | undefined | null): VehiclesDashboardState {
  const [rawVehicles, setRawVehicles] = useState<GarageVehicle[]>([]);
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
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function fetchAll() {
      try {
        // Fire all 5 relationship queries in parallel
        const [verifiedRes, permRes, contribRes, discoveredRes, uploadedRes] = await Promise.all([
          // Q1: ownership_verifications (approved)
          supabase
            .from('ownership_verifications')
            .select('vehicle_id, created_at')
            .eq('user_id', userId)
            .eq('status', 'approved'),

          // Q2: vehicle_user_permissions (active)
          supabase
            .from('vehicle_user_permissions')
            .select('vehicle_id, role, created_at')
            .eq('user_id', userId)
            .eq('is_active', true),

          // Q3: vehicle_contributors
          supabase
            .from('vehicle_contributors')
            .select('vehicle_id, role, created_at, status')
            .eq('user_id', userId),

          // Q4: discovered_vehicles (all, including dismissed)
          supabase
            .from('discovered_vehicles')
            .select('vehicle_id, relationship_type, created_at, is_active')
            .eq('user_id', userId),

          // Q5: vehicles uploaded by this user
          supabase
            .from('vehicles')
            .select(VEHICLE_SELECT)
            .eq('uploaded_by', userId),
        ]);

        if (cancelled) return;

        // Build relationship map: vehicle_id → { type, source, role }
        const relMap = new Map<string, {
          type: RelationshipType;
          source: GarageVehicle['relationship_source'];
          role?: string;
        }>();

        function setRel(id: string, type: RelationshipType, source: GarageVehicle['relationship_source'], role?: string) {
          const existing = relMap.get(id);
          if (!existing || RELATIONSHIP_PRIORITY.indexOf(type) > RELATIONSHIP_PRIORITY.indexOf(existing.type)) {
            relMap.set(id, { type, source, role });
          }
        }

        // Q1: verified owners (highest priority)
        if (verifiedRes.data) {
          for (const row of verifiedRes.data) {
            setRel(row.vehicle_id, 'VERIFIED OWNER', 'verification');
          }
        }

        // Q2: permissions
        if (permRes.data) {
          for (const row of permRes.data) {
            const rel = permissionRoleToRelationship(row.role);
            setRel(row.vehicle_id, rel, 'permission', row.role);
          }
        }

        // Q3: contributors
        if (contribRes.data) {
          for (const row of contribRes.data) {
            if (row.status === 'inactive') continue;
            setRel(row.vehicle_id, 'CONTRIBUTOR', 'contributor', row.role || 'contributor');
          }
        }

        // Q4: discovered vehicles — track dismissed set
        const dismissedSet = new Set<string>();
        if (discoveredRes.data) {
          for (const row of discoveredRes.data) {
            if (row.is_active === false) {
              dismissedSet.add(row.vehicle_id);
              continue;
            }
            const rel = discoveredTypeToRelationship(row.relationship_type);
            if (rel) {
              setRel(row.vehicle_id, rel, 'discovered');
            }
          }
        }

        // Q5: uploaded_by — lowest priority, skip if already has relationship or dismissed
        const uploadedRows = (uploadedRes.data ?? []) as VehicleRow[];
        const uploadedIds = new Set<string>();
        for (const row of uploadedRows) {
          uploadedIds.add(row.id);
          if (!relMap.has(row.id) && !dismissedSet.has(row.id)) {
            relMap.set(row.id, { type: 'UPLOADER', source: 'uploaded_by' });
          }
        }

        // Hydrate vehicle IDs that aren't already in uploaded set
        const idsToFetch = new Set<string>();
        for (const id of relMap.keys()) {
          if (!uploadedIds.has(id)) idsToFetch.add(id);
        }

        let extraRows: VehicleRow[] = [];
        if (idsToFetch.size > 0) {
          const idArray = Array.from(idsToFetch);
          // Batch in chunks of 100
          const chunks: string[][] = [];
          for (let i = 0; i < idArray.length; i += 100) {
            chunks.push(idArray.slice(i, i + 100));
          }
          const chunkResults = await Promise.all(
            chunks.map(chunk =>
              supabase.from('vehicles').select(VEHICLE_SELECT).in('id', chunk)
            )
          );
          for (const res of chunkResults) {
            if (res.data) extraRows.push(...(res.data as VehicleRow[]));
          }
        }

        if (cancelled) return;

        // Merge all rows, deduplicate by id
        const allRows = new Map<string, VehicleRow>();
        for (const v of [...uploadedRows, ...extraRows]) {
          allRows.set(v.id, v);
        }

        // Build GarageVehicle array
        const garage: GarageVehicle[] = [];
        for (const [id, row] of allRows) {
          const rel = relMap.get(id);
          if (!rel) continue; // dismissed with no other relationship
          garage.push(rowToGarageVehicle(row, rel.type, rel.source, rel.role));
        }

        setRawVehicles(garage);
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

  const totalEstimatedValue = vehicles.reduce(
    (sum, v) => sum + (v.estimated_value ?? 0),
    0,
  );

  return {
    sections,
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
  };
}

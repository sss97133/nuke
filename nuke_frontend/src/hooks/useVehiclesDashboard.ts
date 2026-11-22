/**
 * useVehiclesDashboard.ts
 * Garage data hook — reads account records, ownership periods and their evidence,
 * and provides view/sort/filter state for the garage UI.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { readGarageActivity, type CustodyOrg, type GarageActivityContext } from './garageCustody';
import { applyGarageOwnerCorrections, unresolvedGarageSources, type GarageOwnerCorrection, type UnresolvedGarageSource } from './garageOwnerCorrections';
import type { ClassPrice } from '../components/garage/GarageCardAnalysis';

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
  | 'PROFILE RECORD'
  | 'CONTRIBUTOR'
  | 'DOCUMENTING';

export type ViewMode = 'GRID' | 'LIST' | 'COMPACT';
export type SortMode = 'RECENT' | 'FIRST' | 'DAYS' | 'PHOTOS' | 'WORK' | 'EVENTS' | 'DOCS' | 'YEAR' | 'MAKE' | 'NAME' | 'ADDED' | 'OWNED' | 'CLASS' | 'VALUE' | 'HEALTH';
export type FilterMode = 'ALL' | 'OWNED' | 'CONTRIBUTED';

export interface EventSummary {
  total_events: number;
  times_sold: number;
  platforms: string[];
  first_event_date: string | null;
  last_event_date: string | null;
}

/** One day of recorded activity: [YYYY-MM-DD, photos, work sessions, events, document pages]. */
export type GarageTimelineDay = [string, number, number, number, number];

/** The profile timeline's sources by day (get_vehicle_contribution_days_batch). */
export interface GarageTimeline {
  first_day: string;
  last_day: string;
  active_days: number;
  photos: number;
  work_days: number;
  events: number;
  documents: number;
  days: GarageTimelineDay[];
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
  relationship_source: 'verification' | 'ownership' | 'permission' | 'contributor' | 'discovered' | 'uploaded_by' | 'owner_statement' | 'profile_record' | 'account_record';
  relationship_roles?: RelationshipType[];
  relationship_detail?: string;
  inventory_status?: 'current' | 'previous' | 'unknown';
  relationship_id?: string;
  ownership_start_date?: string | null;
  ownership_end_date?: string | null;
  estimate_calculated_at?: string | null;
  /** This car's get_vehicle_class_prices row (priced or blocked); null when the reader has none; absent when not read. */
  class_price?: ClassPrice | null;
  permission_role?: string;
  event_weeks: string[] | null;
  event_summary: EventSummary | null;
  /** Dated activity from photos, work sessions, events and documents. Null when none is recorded or readable. */
  timeline?: GarageTimeline | null;
  /** vehicle_activity's newest genuine activity (photo, work session or event by a tied account), from get_user_garage. */
  last_activity_at?: string | null;
  /** Organization that holds the car, from organization_vehicles (not a hard-coded list). */
  custody_org?: CustodyOrg | null;
  /** Latest EXIF photo or work session by the viewer inside the recency window. */
  recent_work_at?: string | null;
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
  /** False for a visitor who is not signed in: the garage then explains itself instead of offering an add. */
  signedIn: boolean;
  viewerId: string | null;
  loadedVehicleCount?: number;
  warnings?: string[];
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
  /** The chosen order turned around; cars with nothing to order by stay last either way. */
  sortReversed?: boolean;
  setSortReversed?: (reversed: boolean) => void;
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
  'PROFILE RECORD',
  'CONTRIBUTOR',
  'DOCUMENTING',
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
  verification_category: string | null;
  title_document_url: string | null;
}

interface GarageRelationship {
  type: RelationshipType;
  source: GarageVehicle['relationship_source'];
  id?: string;
  role?: string;
  start_date: string | null;
  end_date: string | null;
}

interface GarageRecord { vehicle_id: string; relationship: string; last_activity_at?: string | null }

/** What get_user_garage says the account is to the car, in the garage's words. Its 'owner' outside the
 * period/verification fold stays under review: a permission row is not title, and it would count toward the total. */
const RECORD_RELATIONSHIPS: Record<string, RelationshipType> = {
  profile_record: 'PROFILE RECORD', contributor: 'CONTRIBUTOR',
  consigned: 'CONSIGNED', previously_owned: 'PREVIOUSLY OWNED', documenting: 'DOCUMENTING',
};

/** Account membership is broader than ownership. Keep the period/verification
 * fold authoritative while making contributed and created profiles findable. */
export function includeGarageRecords(
  relationships: Map<string, GarageRelationship>, records: GarageRecord[],
  terminalId: (id: string) => string = id => id,
) {
  for (const record of records) {
    const id = terminalId(record.vehicle_id);
    if (relationships.has(id)) continue;
    const created = record.relationship === 'profile_record';
    const contributed = record.relationship === 'contributor';
    relationships.set(id, {
      type: RECORD_RELATIONSHIPS[record.relationship] ?? 'RELATIONSHIP REVIEW',
      source: created ? 'profile_record' : contributed ? 'contributor' : 'account_record',
      start_date: null, end_date: null,
    });
  }
}

async function readGarageRecords(userId: string, cancelled: () => boolean): Promise<GarageRecord[]> {
  const records: GarageRecord[] = [];
  const pageSize = 500;
  let after: string | undefined;
  while (!cancelled()) {
    let request = supabase.rpc('get_user_garage', { p_user_id: userId })
      .order('vehicle_id', { ascending: true }).limit(pageSize);
    if (after) request = request.gt('vehicle_id', after);
    const { data, error } = await request;
    if (error || !Array.isArray(data)) throw new Error('Garage account records unavailable. Please retry.');
    const page = data as GarageRecord[];
    let previous = after ?? '';
    for (const row of page) {
      if (typeof row.vehicle_id !== 'string' || row.vehicle_id <= previous || typeof row.relationship !== 'string') {
        throw new Error('Garage account records incomplete. Please retry.');
      }
      previous = row.vehicle_id;
    }
    records.push(...page);
    if (page.length < pageSize) break;
    after = previous;
  }
  return records;
}

function verificationIsCurrent(row: Verification | undefined, now: Date): boolean {
  // The database column is timestamp without time zone, recorded in UTC.
  const expiry = row?.expires_at;
  const expiryTime = expiry ? Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(expiry) ? expiry : `${expiry}Z`) : null;
  return !!row && row.status === 'approved' &&
    row.verification_category === 'title_document' && /^https:\/\//.test(row.title_document_url ?? '') &&
    (expiryTime === null || expiryTime > now.getTime());
}

// The period establishes the relationship; verification corroborates it.
// A past approval cannot override a disposal or turn an unknown role into title.
/** Fold periods and title approvals; explicit account corrections are applied separately. */
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
  // Ownership periods outrank activity rows. Reacquisition wins over an earlier
  // ended period; row creation is never acquisition time.
  const ownerRoles = ['verified_owner', 'owner', 'current_owner', 'co_owner', 'co-owner', 'previous_owner'];
  const ownershipPeriod = (p: OwnershipPeriod) => ownerRoles.includes(p.role?.toLowerCase() ?? '');
  const selected = new Map<string, OwnershipPeriod>();
  for (const p of [...periods].sort((a, b) => Number(ownershipPeriod(b)) - Number(ownershipPeriod(a)) ||
    Number(current(b)) - Number(current(a)) ||
    (b.start_date ?? '').localeCompare(a.start_date ?? '') ||
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))) {
    if (!selected.has(p.vehicle_id)) selected.set(p.vehicle_id, p);
  }
  for (const p of selected.values()) {
    const role = p.role?.toLowerCase();
    // Activity or an unverified claim cannot withdraw an independent current title approval.
    if ((!role || !ownerRoles.includes(role)) && result.get(p.vehicle_id)?.type === 'VERIFIED OWNER') continue;
    let type: RelationshipType = 'OWNERSHIP CLAIM';
    if ((!p.start_date || p.start_date <= today) && role && ownerRoles.includes(role)) {
      if (role === 'previous_owner' || (p.end_date && p.end_date <= today)) type = 'PREVIOUSLY OWNED';
      else if (current(p)) {
        const linkedProof = proofs.get(p.verification_id ?? '');
        const proof = linkedProof?.vehicle_id === p.vehicle_id && verificationIsCurrent(linkedProof, now) ? linkedProof
          : verifications.find(row => row.vehicle_id === p.vehicle_id && verificationIsCurrent(row, now));
        if (proof?.vehicle_id === p.vehicle_id && verificationIsCurrent(proof, now)) {
          type = role === 'co_owner' || role === 'co-owner' ? 'CO-OWNER' : 'VERIFIED OWNER';
        }
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

/** Current ownership from the shared evidence and explicit account-statement fold. */
export function isCurrentGarageOwner(vehicle: Pick<GarageVehicle, 'relationship_type'>): boolean {
  return ['VERIFIED OWNER', 'OWNER', 'CO-OWNER'].includes(vehicle.relationship_type);
}

/** The day of the newest dated activity on the car: the garage's default order. */
export function garageLastDay(v: Pick<GarageVehicle, 'timeline' | 'last_event_at' | 'last_activity_at'>): string | null {
  // The database's activity clock leads: it is in the first read and counts only genuine activity.
  return v.last_activity_at?.slice(0, 10) ?? v.timeline?.last_day ?? v.last_event_at?.slice(0, 10) ?? null;
}

/** The first day the car appears in the record. */
export function garageFirstDay(v: Pick<GarageVehicle, 'timeline' | 'event_summary'>): string | null {
  return v.timeline?.first_day ?? v.event_summary?.first_event_date?.slice(0, 10) ?? null;
}

const finite = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const carName = (v: GarageVehicle, parts: (keyof GarageVehicle)[]) => parts.map(part => v[part] ?? '').join(' ').trim() || null;

/** What each order reads from a car, and whether its usual direction is largest or newest first. */
const SORTS: Record<SortMode, { key: (v: GarageVehicle) => number | string | null; desc: boolean }> = {
  // A row's updated_at moves with any backfill; the order follows dated activity instead.
  RECENT: { key: garageLastDay, desc: true },
  FIRST: { key: garageFirstDay, desc: false },
  DAYS: { key: v => v.timeline ? v.timeline.active_days : null, desc: true },
  // image_count also holds undated photos, so it is the photo total when it is larger.
  PHOTOS: { key: v => v.timeline || v.image_count != null ? Math.max(v.timeline?.photos ?? 0, v.image_count ?? 0) : null, desc: true },
  WORK: { key: v => v.timeline ? v.timeline.work_days : null, desc: true },
  EVENTS: { key: v => v.timeline ? v.timeline.events : finite(v.event_count), desc: true },
  DOCS: { key: v => v.timeline ? v.timeline.documents : null, desc: true },
  YEAR: { key: v => finite(v.year), desc: true },
  MAKE: { key: v => carName(v, ['make', 'model', 'year']), desc: false },
  NAME: { key: v => carName(v, ['year', 'make', 'model']), desc: false },
  ADDED: { key: v => v.created_at || null, desc: true },
  OWNED: { key: v => v.ownership_start_date ?? null, desc: true },
  CLASS: { key: v => finite(v.class_price?.value) || null, desc: true },
  VALUE: { key: v => finite(v.estimated_value) || null, desc: true },
  HEALTH: { key: v => finite(v.health_score), desc: true },
};

export function sortVehicles(a: GarageVehicle, b: GarageVehicle, sort: SortMode, reversed = false): number {
  const order = SORTS[sort] ?? SORTS.RECENT;
  const x = order.key(a);
  const y = order.key(b);
  if (x === y) return 0;
  // A car with nothing to order by comes after the ones that have it, in either direction.
  if (x === null) return 1;
  if (y === null) return -1;
  const up = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  return order.desc !== reversed ? -up : up;
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
    primary_image_url: v.resolved_image_url,
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

const VEHICLE_SELECT = 'id, year, make, model, normalized_model, trim, vin, primary_image_url, image_count, confidence_score, heat_score, view_count, created_at, updated_at, status, merged_into_vehicle_id, deleted_at, listing_kind';

const EXCLUDED_STATUSES = new Set(['deleted', 'merged', 'duplicate', 'rejected']);
// get_vehicle_contribution_days_batch: cars per call and calls in flight.
const TIMELINE_CHUNK = 25;
const TIMELINE_CONCURRENCY = 3;
/** get_vehicle_class_prices takes at most 500 ids a call. */
const CLASS_PRICE_CHUNK = 200;

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  normalized_model?: string | null;
  trim: string | null;
  vin: string | null;
  primary_image_url: string | null;
  image_count: number | null;
  confidence_score: number | null;
  heat_score: number | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
  status: string | null;
  merged_into_vehicle_id?: string | null;
  deleted_at?: string | null;
  listing_kind?: string | null;
}

function rowToGarageVehicle(
  row: VehicleRow,
  relationship: GarageRelationship,
  estimate?: { estimated_value: number; calculated_at: string } | null,
  image_count?: number | null,
  fallback_image_url?: string | null,
  event_weeks?: string[] | null,
  event_summary?: EventSummary | null,
  timeline?: GarageTimeline | null,
  last_activity_at?: string | null,
  class_price?: ClassPrice | null,
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
    resolved_image_url: fallback_image_url || null,
    estimated_value,
    // Direct purchase-price access is private; use an attributed cost reader when available.
    purchase_price: null,
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
    ...(class_price !== undefined ? { class_price } : {}),
    permission_role: relationship.role,
    event_weeks: event_weeks ?? null,
    event_summary: event_summary ?? null,
    timeline: timeline ?? null,
    last_activity_at: last_activity_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Read qualified relationships; ownership scope omits unrelated membership and secondary details. */
export function useVehiclesDashboard(userId: string | undefined | null, scope: 'all' | 'ownership' = 'all'): VehiclesDashboardState {
  const [readerViewer, setReaderViewer] = useState(userId ?? null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rawVehicles, setRawVehicles] = useState<GarageVehicle[]>([]);
  const [unresolvedSources, setUnresolvedSources] = useState<UnresolvedGarageSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [sortMode, setSortMode] = useState<SortMode>('RECENT');
  const [sortReversed, setSortReversed] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activity, setActivity] = useState<GarageActivityContext | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    setReaderViewer(userId ?? null);
    setWarnings([]);
    if (!userId) {
      setRawVehicles([]);
      setUnresolvedSources([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setRawVehicles([]);
    setActivity(null);
    setUnresolvedSources([]);
    setIsLoading(true);
    setError(null);

    async function fetchAll() {
      try {
        // Contribution/profile membership is visible without becoming title.
        // The existing period and verification fold still owns ownership.
        const [verifiedRes, prevOwnedRes, ownershipRes, correctionRes, accountRecords] = await Promise.all([
          supabase.from('ownership_verifications')
            .select('id, vehicle_id, status, expires_at, verification_category, title_document_url')
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
          // Active work (documenting, contributor) is relevant even in ownership scope —
          // stakes and engagement matter, not just title. Include all garage records.
          // In ownership scope, failure is non-fatal: continue without work relationships.
          // In all scope, work relationships are required, so failure propagates.
          scope === 'ownership'
            ? readGarageRecords(userId!, () => cancelled).catch(() => [] as GarageRecord[])
            : readGarageRecords(userId!, () => cancelled),
        ]);
        if (cancelled) return;
        for (const res of [verifiedRes, prevOwnedRes, ownershipRes, correctionRes]) {
          if (res.error) throw new Error('Garage relationships unavailable. Please retry.');
        }
        let relMap = resolveGarageRelationships(
          ownershipRes.data ?? [], verifiedRes.data ?? [], prevOwnedRes.data ?? [],
        );
        includeGarageRecords(relMap, accountRecords);
        let corrections = (correctionRes.data ?? []) as GarageOwnerCorrection[];
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

        // Membership can survive a vehicle merge on its original row. Follow
        // only recorded merge links, then resolve the original relationships
        // against the terminal identity before reading its images and events.
        for (let depth = 0; ; depth++) {
          const missing = [...new Set([...allRows.values()].flatMap(row =>
            row.merged_into_vehicle_id && !allRows.has(row.merged_into_vehicle_id) ? [row.merged_into_vehicle_id] : []))];
          if (!missing.length) break;
          if (depth >= 10) throw new Error('Garage vehicle identities unavailable. Please retry.');
          for (let offset = 0; offset < missing.length; offset += 100) {
            const { data, error } = await supabase.from('vehicles').select(VEHICLE_SELECT).in('id', missing.slice(offset, offset + 100));
            if (error) throw new Error('Garage vehicle identities unavailable. Please retry.');
            for (const row of (data ?? []) as VehicleRow[]) allRows.set(row.id, row);
          }
          if (missing.some(id => !allRows.has(id))) throw new Error('Garage vehicle identities unavailable. Please retry.');
          if (cancelled) return;
        }
        const terminalId = (id: string): string => {
          const seen = new Set<string>();
          while (allRows.get(id)?.merged_into_vehicle_id) {
            if (seen.has(id)) throw new Error('Garage vehicle identities unavailable. Please retry.');
            seen.add(id); id = allRows.get(id)!.merged_into_vehicle_id!;
          }
          return id;
        };
        relMap = resolveGarageRelationships(
          (ownershipRes.data ?? []).map(row => ({ ...row, vehicle_id: terminalId(row.vehicle_id) })),
          (verifiedRes.data ?? []).map(row => ({ ...row, vehicle_id: terminalId(row.vehicle_id) })),
          (prevOwnedRes.data ?? []).map(row => ({ ...row, vehicle_id: terminalId(row.vehicle_id) })),
        );
        includeGarageRecords(relMap, accountRecords, terminalId);
        corrections = corrections.map(row => ({ ...row, vehicle_id: row.vehicle_id ? terminalId(row.vehicle_id) : null }));
        for (const row of corrections) {
          if (row.vehicle_id && !relMap.has(row.vehicle_id)) relMap.set(row.vehicle_id,
            { type: 'RELATIONSHIP REVIEW', source: 'owner_statement', id: row.id, start_date: null, end_date: null });
        }
        allRows = new Map([...allRows].filter(([id]) => relMap.has(id)));

        // Batch fetch image counts, fallback images, event summaries, event weeks in parallel
        const vehicleIdArray = Array.from(allRows.keys());
        const imageCounts = new Map<string, number>();
        const fallbackImages = new Map<string, string>();
        const eventSummaries = new Map<string, EventSummary>();
        const eventWeeksMap = new Map<string, string[]>();
        const timelines = new Map<string, GarageTimeline>();
        const activityAt = new Map<string, string>();
        for (const record of accountRecords) {
          const at = typeof record.last_activity_at === 'string' && Number.isFinite(Date.parse(record.last_activity_at)) ? record.last_activity_at : null;
          const id = terminalId(record.vehicle_id);
          if (at && at > (activityAt.get(id) ?? '')) activityAt.set(id, at);
        }
        const estimates = new Map<string, { estimated_value: number; calculated_at: string }>();
        const classPrices = new Map<string, ClassPrice | null>();
        const readWarnings: string[] = [];
        const unreadable = [...relMap.keys()].filter(id => !allRows.has(id));
        if (unreadable.length) readWarnings.push(`${unreadable.length} related vehicle records could not be read.`);
        const publish = () => {
          if (cancelled) return;
          const garage: GarageVehicle[] = [];
          for (const [id, row] of allRows) {
            const rel = relMap.get(id);
            if (!rel || row.deleted_at || row.listing_kind === 'non_vehicle_item' ||
                (row.status && EXCLUDED_STATUSES.has(row.status))) continue;
            garage.push(rowToGarageVehicle(row, rel, estimates.get(id), imageCounts.get(id), fallbackImages.get(id), eventWeeksMap.get(id), eventSummaries.get(id), timelines.get(id), activityAt.get(id),
              classPrices.has(id) ? classPrices.get(id) : undefined));
          }
          setWarnings([...readWarnings]);
          setRawVehicles(applyGarageOwnerCorrections(garage, corrections));
          setUnresolvedSources(unresolvedGarageSources(corrections));
          setIsLoading(false);
        };

        // Collection/Owned consumers need the same evidence fold without
        // loading unrelated account membership, valuations and activity.
        if (scope === 'ownership') { publish(); return; }

        if (vehicleIdArray.length > 0) {
          // Image counts come from vehicles.image_count (trigger-maintained by
          // update_vehicle_image_count, verified exact in prod). The live
          // count_vehicle_images_batch RPC died on the 15s statement timeout and
          // froze the whole garage behind it.
          for (const [vid, row] of allRows) {
            if (row.image_count != null) imageCounts.set(vid, Number(row.image_count));
          }
          // The roster is usable while covers and secondary details are read.
          publish();

          const readCovers = async () => {
            const data: { vehicle_id: string; image_url: string }[] = [];
            let error = false;
            for (let offset = 0; offset < vehicleIdArray.length && !cancelled; offset += 100) {
              const batch = vehicleIdArray.slice(offset, offset + 100);
              const result = await supabase.rpc('get_first_image_batch', { vehicle_ids: batch });
              if (result.error || !Array.isArray(result.data) || result.data.some(row =>
                !batch.includes(row.vehicle_id) || typeof row.image_url !== 'string' || !row.image_url)) {
                error = true;
              } else {
                data.push(...result.data);
                for (const row of result.data) fallbackImages.set(row.vehicle_id, row.image_url);
                publish();
              }
            }
            return { data, error };
          };

          const optionalRead = async (read: PromiseLike<{ data: any; error?: unknown }>) => {
            try { return await read; } catch { return { data: null, error: true }; }
          };
          const activityRead = readGarageActivity(userId!, vehicleIdArray, () => cancelled);
          // The day reader is bound by cold photo reads (seconds for a large garage), so it runs
          // beside the other reads instead of holding them, in small chunks a few at a time (no one
          // call carries the whole garage into the statement timeout). The squares are applied
          // together once every chunk is in: every strip shares one window and intensity scale
          // (garageAxis), which would re-shade as each chunk landed.
          const applyTimelines = (rows: (GarageTimeline & { vehicle_id: string })[]) => {
            for (const t of rows) {
              if (typeof t.vehicle_id === 'string' && allRows.has(t.vehicle_id) && Array.isArray(t.days) &&
                  /^\d{4}-\d{2}-\d{2}$/.test(String(t.first_day)) && /^\d{4}-\d{2}-\d{2}$/.test(String(t.last_day))) {
                timelines.set(t.vehicle_id, {
                  first_day: t.first_day, last_day: t.last_day, active_days: Number(t.active_days) || 0,
                  photos: Number(t.photos) || 0, work_days: Number(t.work_days) || 0,
                  events: Number(t.events) || 0, documents: Number(t.documents) || 0,
                  days: t.days.filter(w => Array.isArray(w) && /^\d{4}-\d{2}-\d{2}$/.test(String(w[0]))),
                });
              }
            }
          };
          const readTimelines = async () => {
            const chunks: string[][] = [];
            for (let i = 0; i < vehicleIdArray.length; i += TIMELINE_CHUNK) chunks.push(vehicleIdArray.slice(i, i + TIMELINE_CHUNK));
            const rows: (GarageTimeline & { vehicle_id: string })[] = [];
            let error = false;
            let next = 0;
            const worker = async () => {
              while (next < chunks.length && !cancelled) {
                const chunk = chunks[next++];
                try {
                  const result = await supabase.rpc('get_vehicle_contribution_days_batch', { p_vehicle_ids: chunk });
                  if (result.error || !Array.isArray(result.data)) { error = true; continue; }
                  rows.push(...result.data);
                } catch { error = true; }
              }
            };
            await Promise.all(Array.from({ length: Math.min(TIMELINE_CONCURRENCY, chunks.length) }, worker));
            if (!cancelled && rows.length) { applyTimelines(rows); publish(); }
            return { error };
          };
          const timelineRead = readTimelines();
          // The stored class price (vehicle_class_price) of each car the account is tied to, in chunks the reader accepts.
          const readClassPrices = async () => {
            const data: ClassPrice[] = [];
            for (let offset = 0; offset < vehicleIdArray.length; offset += CLASS_PRICE_CHUNK) {
              const result = await supabase.rpc('get_vehicle_class_prices', { p_vehicle_ids: vehicleIdArray.slice(offset, offset + CLASS_PRICE_CHUNK) });
              if (result.error || !Array.isArray(result.data)) return { data: null, error: result.error ?? true };
              data.push(...result.data as ClassPrice[]);
            }
            return { data, error: null };
          };
          const [fallbackRes, eventSummaryRes, eventWeeksRes, estimateRes] = await Promise.all([
            readCovers(),
            supabase
              .from('vehicle_event_summary')
              .select('vehicle_id, total_events, times_sold, platform_list, first_event_date, last_event_date')
              .in('vehicle_id', vehicleIdArray),
            supabase.rpc('get_vehicle_event_weeks_batch', { vehicle_ids: vehicleIdArray }),
            // The class price only: the median of the same build class's sold comps, stored per car. Never replace
            // absent evidence with a legacy value, an old nuke_estimates row or the purchase price.
            readClassPrices(),
          ].map(optionalRead));
          const garageActivity = await activityRead;
          if (cancelled) return;
          readWarnings.push(...garageActivity.warnings);
          setActivity(garageActivity);
          if (fallbackRes.error) readWarnings.push('Some vehicle cover photos are unavailable.');
          if (eventSummaryRes.error) readWarnings.push('Event summaries are unavailable. Activity counts remain unknown.');
          // The event weeks stay as the timeline's fallback when the day reader is unavailable.
          void timelineRead.then(({ error }) => {
            if (cancelled || !error || !eventWeeksRes.error) return;
            readWarnings.push('Activity timelines are unavailable.');
            publish();
          });
          if (estimateRes.error) readWarnings.push('Recorded estimates are unavailable. Vehicle relationships remain visible.');
          if (!estimateRes.error) {
            for (const id of vehicleIdArray) classPrices.set(id, null);
            for (const row of (estimateRes.data ?? []) as ClassPrice[]) {
              if (!row?.vehicle_id || !allRows.has(row.vehicle_id)) continue;
              classPrices.set(row.vehicle_id, row);
              if (row.status === 'priced' && Number.isFinite(Number(row.value)) && Number(row.value) > 0 &&
                  row.computed_at && Number.isFinite(Date.parse(row.computed_at))) {
                estimates.set(row.vehicle_id, { estimated_value: Number(row.value), calculated_at: row.computed_at });
              }
            }
          }

          if (fallbackRes.data) {
            for (const f of fallbackRes.data as { vehicle_id: string; image_url: string }[]) {
              fallbackImages.set(f.vehicle_id, f.image_url);
            }
          }
          if (!eventSummaryRes.error && eventSummaryRes.data) {
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
          if (!eventWeeksRes.error && eventWeeksRes.data) {
            for (const w of eventWeeksRes.data as { vehicle_id: string; event_week: string }[]) {
              if (!eventWeeksMap.has(w.vehicle_id)) eventWeeksMap.set(w.vehicle_id, []);
              eventWeeksMap.get(w.vehicle_id)!.push(w.event_week);
            }
          }
        }

        if (cancelled) return;

        publish();
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
  }, [userId, refreshKey, scope]);

  // Derived state
  const sameViewer = readerViewer === (userId ?? null);
  const visibleLoading = !!userId && (!sameViewer || isLoading);
  const vehicles = useMemo(() => (sameViewer && userId ? rawVehicles : [])
    .map((v) => activity ? { ...v, custody_org: activity.custody.get(v.id) ?? null, recent_work_at: activity.recentWork.get(v.id) ?? null } : v)
    .filter((v) => matchesFilter(v, filterMode))
    .sort((a, b) => sortVehicles(a, b, sortMode, sortReversed)),
  [sameViewer, userId, rawVehicles, activity, filterMode, sortMode, sortReversed]);

  const sections = buildSections(vehicles);

  // Current ownership only; ended periods, claims and consignments are not assets.
  const totalEstimatedValue = vehicles
    .filter(isCurrentGarageOwner)
    .reduce((sum, v) => sum + (v.estimated_value ?? 0), 0);

  const data = sameViewer && userId ? buildDashboardData(sections, vehicles) : null;

  return {
    signedIn: !!userId,
    viewerId: userId ?? null,
    loadedVehicleCount: sameViewer && userId ? rawVehicles.length : 0,
    warnings: sameViewer && userId ? warnings : [],
    sections,
    unresolvedSources: sameViewer && userId ? unresolvedSources : [],
    vehicles,
    totalEstimatedValue,
    isLoading: visibleLoading,
    error: sameViewer && userId ? error : null,
    viewMode,
    sortMode,
    filterMode,
    setViewMode,
    setSortMode,
    sortReversed,
    setSortReversed,
    setFilterMode,
    refresh,
    data,
    loading: visibleLoading,
  };
}

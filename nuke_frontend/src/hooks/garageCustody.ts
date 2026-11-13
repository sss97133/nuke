/**
 * Garage grouping by custody, plus a recency pull-up.
 *
 * A car held by a shop (Ernie's Upholstery client cars, a storage lot, a service
 * provider) is shown with that organization's other cars, using the recorded
 * organization_vehicles links. A car the viewer worked on in the last week, proven
 * by an EXIF photo date or a work session, is pulled out of its group to the top.
 * Nothing here is a hard-coded list of vehicles or organizations.
 */
import { supabase } from '../lib/supabase';

/** Links that mean an organization physically holds or works on the car. */
export const CUSTODY_RELATIONSHIPS = [
  'work_location', 'storage', 'service_provider', 'upholstery', 'painter', 'fabricator', 'current_consignment',
] as const;

/** Lower rank wins when one car has several custody links. */
const CUSTODY_RANK: Record<string, number> = Object.fromEntries(CUSTODY_RELATIONSHIPS.map((type, i) => [type, i]));

export const RECENT_WORK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CustodyOrg {
  id: string;
  name: string;
  relationship_type: string;
}

export interface GarageActivityContext {
  custody: Map<string, CustodyOrg>;
  /** Latest real work evidence per vehicle (ISO), within the recency window. */
  recentWork: Map<string, string>;
  warnings: string[];
}

export interface OrgVehicleLinkRow {
  vehicle_id: string;
  organization_id: string;
  relationship_type: string;
  status?: string | null;
  auto_tagged?: boolean | null;
  user_confirmed?: boolean | null;
  user_rejected?: boolean | null;
  end_date?: string | null;
  service_status?: string | null;
  organizations?: { business_name?: string | null; name?: string | null; legal_name?: string | null } | null;
}

/** One custody organization per vehicle, from recorded links only. */
export function pickCustodyOrgs(rows: OrgVehicleLinkRow[], now = new Date()): Map<string, CustodyOrg> {
  const today = now.toISOString().slice(0, 10);
  const best = new Map<string, { rank: number; row: OrgVehicleLinkRow }>();
  for (const row of rows) {
    const rank = CUSTODY_RANK[row.relationship_type];
    if (rank === undefined) continue;
    if (row.status && row.status !== 'active') continue;
    if (row.user_rejected) continue;
    // A GPS/receipt guess stays out until a person confirms it.
    if (row.auto_tagged && !row.user_confirmed) continue;
    if (row.end_date && row.end_date <= today) continue;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org || !(org.business_name || org.name || org.legal_name)) continue;
    const current = best.get(row.vehicle_id);
    const inService = row.service_status === 'currently_in_service' ? 0 : 1;
    const key = rank * 2 + inService;
    if (!current || key < current.rank) best.set(row.vehicle_id, { rank: key, row });
  }
  const result = new Map<string, CustodyOrg>();
  for (const [vehicleId, { row }] of best) {
    const org = (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations)!;
    result.set(vehicleId, {
      id: row.organization_id,
      name: (org.business_name || org.name || org.legal_name)!,
      relationship_type: row.relationship_type,
    });
  }
  return result;
}

interface PhotoEvidence { vehicle_id: string; taken_at: string | null; is_duplicate?: boolean | null; vision_gate_status?: string | null }
interface SessionEvidence {
  vehicle_id: string; session_date?: string | null; start_time?: string | null; end_time?: string | null;
  metadata?: { auto_resolution?: { status?: string } | null } | null;
}

const REJECTED_GATES = new Set(['rejected_personal', 'rejected_misattributed']);

/** Latest EXIF photo date or work-session time per vehicle inside the window. */
export function latestWorkEvidence(
  photos: PhotoEvidence[], sessions: SessionEvidence[], now = new Date(),
): Map<string, string> {
  const nowMs = now.getTime();
  const since = nowMs - RECENT_WORK_DAYS * DAY_MS;
  const latest = new Map<string, number>();
  const note = (vehicleId: string, value: string | null | undefined) => {
    if (!value) return;
    const t = Date.parse(value);
    // Camera clocks can be wrong; a date past tomorrow is not evidence.
    if (!Number.isFinite(t) || t < since || t > nowMs + DAY_MS) return;
    if (t > (latest.get(vehicleId) ?? 0)) latest.set(vehicleId, t);
  };
  for (const p of photos) {
    if (p.is_duplicate || (p.vision_gate_status && REJECTED_GATES.has(p.vision_gate_status))) continue;
    note(p.vehicle_id, p.taken_at);
  }
  for (const s of sessions) {
    // The system closes a session when no photo remains to back it.
    if (s.metadata?.auto_resolution?.status === 'closed_obsolete') continue;
    note(s.vehicle_id, s.end_time ?? s.start_time ?? s.session_date);
  }
  return new Map([...latest].map(([id, t]) => [id, new Date(t).toISOString()]));
}

export function isRecentlyWorked(vehicle: { recent_work_at?: string | null }, now = new Date()): boolean {
  if (!vehicle.recent_work_at) return false;
  const t = Date.parse(vehicle.recent_work_at);
  return Number.isFinite(t) && t >= now.getTime() - RECENT_WORK_DAYS * DAY_MS;
}

export interface GarageBuckets<V> {
  recent: V[];
  orgGroups: { org: CustodyOrg; vehicles: V[] }[];
  rest: V[];
}

/**
 * Recently worked cars first (newest work first), then one group per custody
 * organization (largest group first, then name), then everything else.
 * Input order is preserved inside each group.
 */
export function bucketGarage<V extends { recent_work_at?: string | null; custody_org?: CustodyOrg | null }>(
  vehicles: V[], now = new Date(),
): GarageBuckets<V> {
  const recent: V[] = [];
  const rest: V[] = [];
  const groups = new Map<string, { org: CustodyOrg; vehicles: V[] }>();
  for (const vehicle of vehicles) {
    if (isRecentlyWorked(vehicle, now)) { recent.push(vehicle); continue; }
    const org = vehicle.custody_org;
    if (!org) { rest.push(vehicle); continue; }
    const group = groups.get(org.id) ?? { org, vehicles: [] };
    group.vehicles.push(vehicle);
    groups.set(org.id, group);
  }
  recent.sort((a, b) => Date.parse(b.recent_work_at!) - Date.parse(a.recent_work_at!));
  const orgGroups = [...groups.values()]
    .sort((a, b) => b.vehicles.length - a.vehicles.length || a.org.name.localeCompare(b.org.name));
  return { recent, orgGroups, rest };
}

/** Reads custody links and recent work evidence. Never throws; failures become warnings. */
export async function readGarageActivity(
  userId: string, vehicleIds: string[], cancelled: () => boolean, now = new Date(),
): Promise<GarageActivityContext> {
  const warnings: string[] = [];
  const links: OrgVehicleLinkRow[] = [];
  const photos: PhotoEvidence[] = [];
  const sessions: SessionEvidence[] = [];
  const sinceIso = new Date(now.getTime() - RECENT_WORK_DAYS * DAY_MS).toISOString();
  let linksFailed = false;
  let evidenceFailed = false;
  for (let offset = 0; offset < vehicleIds.length && !cancelled(); offset += 100) {
    const chunk = vehicleIds.slice(offset, offset + 100);
    try {
      const [linkRes, photoRes, sessionRes] = await Promise.all([
        supabase.from('organization_vehicles')
          .select('vehicle_id, organization_id, relationship_type, status, auto_tagged, user_confirmed, user_rejected, end_date, service_status, organizations(business_name, name, legal_name)')
          .in('vehicle_id', chunk)
          .in('relationship_type', [...CUSTODY_RELATIONSHIPS])
          .eq('status', 'active'),
        supabase.from('vehicle_images')
          .select('vehicle_id, taken_at, is_duplicate, vision_gate_status')
          .in('vehicle_id', chunk)
          .eq('user_id', userId)
          .gte('taken_at', sinceIso)
          .order('taken_at', { ascending: false })
          .limit(2000),
        supabase.from('work_sessions')
          .select('vehicle_id, session_date, start_time, end_time, metadata')
          .in('vehicle_id', chunk)
          .eq('user_id', userId)
          .gte('session_date', sinceIso.slice(0, 10)),
      ]);
      if (linkRes.error) linksFailed = true; else links.push(...((linkRes.data ?? []) as unknown as OrgVehicleLinkRow[]));
      if (photoRes.error) evidenceFailed = true; else photos.push(...((photoRes.data ?? []) as PhotoEvidence[]));
      if (sessionRes.error) evidenceFailed = true; else sessions.push(...((sessionRes.data ?? []) as unknown as SessionEvidence[]));
    } catch {
      linksFailed = true;
      evidenceFailed = true;
    }
  }
  if (linksFailed) warnings.push('Custody groups are unavailable. Vehicles are listed without them.');
  if (evidenceFailed) warnings.push('Recent work evidence is unavailable. Vehicles are not pulled to the top.');
  return { custody: pickCustodyOrgs(links, now), recentWork: latestWorkEvidence(photos, sessions, now), warnings };
}

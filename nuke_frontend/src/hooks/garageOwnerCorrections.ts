import type { GarageVehicle, RelationshipType } from './useVehiclesDashboard';

export interface GarageOwnerCorrection {
  id: string;
  vehicle_id: string | null;
  correction: {
    relationship?: {
      roles: string[];
      ownership_denied: boolean;
      title_status: string;
      disputed: boolean;
      start_date: string | null;
      end_date: string | null;
    };
    cover_image_id?: string;
    unresolved_vehicle?: { label: string; stated_roles: string[] };
  };
  observed_at: string;
  cover_image_url: string | null;
  source_excerpt?: string | null;
}

export interface UnresolvedGarageSource {
  id: string;
  label: string;
  stated_roles: string[];
  source_excerpt: string | null;
  observed_at: string;
}

/** Raw subject testimony stays outside physical-vehicle and asset measures. */
export function unresolvedGarageSources(corrections: GarageOwnerCorrection[]): UnresolvedGarageSource[] {
  return corrections.flatMap(c => {
    const source = c.correction.unresolved_vehicle;
    if (c.vehicle_id !== null || !source) return [];
    return [{ id: c.id, label: source.label, stated_roles: source.stated_roles,
      source_excerpt: c.source_excerpt ?? null, observed_at: c.observed_at }];
  });
}

const GROUPS: Record<string, RelationshipType> = {
  owner_current: 'OWNER', owner_past: 'PREVIOUSLY OWNED',
  shared_interest: 'SHARED INTEREST', claimed_interest: 'CLAIMED INTEREST',
  consignment: 'CONSIGNED', business_handling: 'BUSINESS HANDLING',
  sales_representative: 'SALES REPRESENTATIVE', transfer_pending: 'TRANSFER PENDING',
};

/** All active statements survive. A fork is review, never latest-ingest wins. */
export function applyGarageOwnerCorrections(
  vehicles: GarageVehicle[], corrections: GarageOwnerCorrection[], now = new Date(),
): GarageVehicle[] {
  const byVehicle = new Map<string, GarageOwnerCorrection[]>();
  for (const c of corrections) {
    if (!c.vehicle_id) continue;
    const rows = byVehicle.get(c.vehicle_id) ?? [];
    rows.push(c); byVehicle.set(c.vehicle_id, rows);
  }
  return vehicles.map(vehicle => {
    const rows = byVehicle.get(vehicle.id) ?? [];
    const relationships = rows.filter(r => r.correction.relationship);
    const covers = rows.filter(r => r.correction.cover_image_id);
    const result = { ...vehicle };
    if (covers.length) {
      result.resolved_image_url = covers.length === 1 ? covers[0].cover_image_url : null;
      // An unavailable/rejected chosen frame cannot resurrect the old rejected cover.
      if (!result.resolved_image_url) result.primary_image_url = null;
    }
    if (relationships.length > 1) {
      result.relationship_type = 'RELATIONSHIP REVIEW';
      result.relationship_source = 'owner_statement';
      result.relationship_detail = 'CONFLICTING ACCOUNT STATEMENTS';
      result.ownership_start_date = null; result.ownership_end_date = null;
    } else if (relationships.length === 1) {
      const statement = relationships[0];
      const claim = statement.correction.relationship!;
      const roles = claim.roles.filter(role => GROUPS[role]);
      result.relationship_roles = roles.map(role => GROUPS[role]);
      // Display grouping retains the other roles; it grants neither title nor access.
      result.relationship_type = GROUPS[roles[0]] ?? 'RELATIONSHIP REVIEW';
      if (claim.ownership_denied && roles.some(role => role === 'owner_current' || role === 'owner_past')) {
        result.relationship_type = 'RELATIONSHIP REVIEW';
      }
      if (result.relationship_type === 'OWNER' && (claim.disputed ||
          claim.title_status === 'transfer_pending' ||
          (claim.start_date && claim.start_date > now.toISOString().slice(0, 10)))) {
        result.relationship_type = 'CLAIMED INTEREST';
      }
      result.relationship_source = 'owner_statement';
      result.relationship_id = statement.id;
      result.ownership_start_date = claim.start_date;
      result.ownership_end_date = claim.end_date;
      result.relationship_detail = [
        claim.ownership_denied ? 'PERSONAL OWNERSHIP REJECTED' : null,
        claim.title_status === 'not_in_name' ? 'TITLE NOT IN ACCOUNT HOLDER NAME' : null,
        claim.title_status === 'reported_in_name' ? 'TITLE IN NAME — ACCOUNT STATED' : null,
        claim.title_status === 'transfer_pending' ? 'TITLE TRANSFER PENDING' : null,
        claim.disputed ? 'DISPUTED INTEREST' : null,
      ].filter(Boolean).join(' · ') || 'ACCOUNT STATED';
    }
    return result;
  });
}

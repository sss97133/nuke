/**
 * Per-lot seller attribution for BaT (owner direction 2026-10-19: a BaT seller is only that lot's seller).
 *
 * extract-bat-core reads one lot page at a time. The page names one seller. If that seller is a monitored
 * dealer (bat_seller_monitors), this lot, and only this lot, belongs to the dealer. Other lots of the same
 * vehicle (resales by someone else) must stay unattributed.
 *
 * Pure functions, no I/O, so the decision is testable without a database.
 */
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";

export interface BatEventRow {
  id: string;
  source_url: string | null;
  source_listing_id: string | null;
  source_organization_id: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MonitorRow {
  organization_id: string | null;
  seller_username: string | null;
}

/** BaT handles compare case-insensitively, ignoring surrounding space and a leading "@". */
export function normalizeHandle(raw: string | null | undefined): string | null {
  const h = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  return h || null;
}

/**
 * Pick the monitor whose handle IS this lot's seller. The query uses ILIKE, where "_" and "%" are wildcards,
 * so a handle such as "a_b" would also match "axb"; the exact comparison happens here.
 */
export function monitorForSeller(
  lotSellerHandle: string | null | undefined,
  monitors: MonitorRow[],
): MonitorRow | null {
  const want = normalizeHandle(lotSellerHandle);
  if (!want) return null;
  const hits = monitors.filter((m) => m.organization_id && normalizeHandle(m.seller_username) === want);
  // One handle should map to one organization. If it maps to several, refuse to guess.
  const orgs = new Set(hits.map((m) => m.organization_id));
  return orgs.size === 1 ? hits[0] : null;
}

export interface AttributionDecision {
  /** Event ids to stamp with the monitor's organization and the seller identity. */
  attributeEventIds: string[];
  reason: "attribute" | "no_lot_seller" | "seller_not_monitored" | "no_event_for_this_lot" | "already_attributed";
}

/**
 * Which vehicle_events rows get the monitored dealer?
 * Only the row of the lot being read (same listing URL key), and only when it has no organization yet.
 * `events` may hold every BaT row of the vehicle; the other lots are ignored by construction.
 */
export function decideLotAttribution(input: {
  lotSellerHandle: string | null | undefined;
  monitors: MonitorRow[];
  lotUrl: string;
  events: BatEventRow[];
}): AttributionDecision {
  if (!normalizeHandle(input.lotSellerHandle)) return { attributeEventIds: [], reason: "no_lot_seller" };
  if (!monitorForSeller(input.lotSellerHandle, input.monitors)) {
    return { attributeEventIds: [], reason: "seller_not_monitored" };
  }
  const lotKey = normalizeListingUrlKey(input.lotUrl);
  const thisLot = input.events.filter((e) => {
    if (!lotKey) return false;
    return normalizeListingUrlKey(e.source_url) === lotKey || normalizeListingUrlKey(e.source_listing_id) === lotKey;
  });
  if (thisLot.length === 0) return { attributeEventIds: [], reason: "no_event_for_this_lot" };
  const open = thisLot.filter((e) => !e.source_organization_id);
  if (open.length === 0) return { attributeEventIds: [], reason: "already_attributed" };
  return { attributeEventIds: open.map((e) => e.id), reason: "attribute" };
}

/**
 * Merge a patch into existing event metadata. The patch wins on its own keys; every other key survives
 * (seller_username, buyer_username, lot_number, images ...). Replaces nothing it was not asked to.
 */
export function mergeEventMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  return { ...base, ...patch };
}

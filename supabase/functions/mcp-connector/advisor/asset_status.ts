// get_asset input checks and listing status. Public test: a bad asset_id
// leaked raw Postgres ("invalid input syntax for type uuid"), and an ended
// reserve-not-met auction was reported as status "active".

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAssetUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/** Error text for a missing/invalid asset_id, or null when it is a UUID. */
export function assetIdProblem(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "asset_id is required";
  if (!UUID_RE.test(s)) {
    return `invalid asset_id "${s.slice(0, 64)}": expected a Nuke asset UUID (use find_asset to look one up by VIN, URL, or year/make/model)`;
  }
  return null;
}

function lc(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

export type ListingStatus = "sold" | "ended_reserve_not_met" | "ended_unsold" | "live_auction" | "active" | string | null;

/**
 * Status that matches the auction facts. vehicles.status stays "active" after
 * a no-sale; trust auction_status / reserve_status / sale_status /
 * auction_end_date over it.
 */
export function effectiveListingStatus(row: Record<string, unknown>, nowMs = Date.now()): ListingStatus {
  const raw = row.status == null ? null : String(row.status);
  const auction = lc(row.auction_status);
  const reserve = lc(row.reserve_status);
  const sale = lc(row.sale_status);
  const endMs = row.auction_end_date ? Date.parse(String(row.auction_end_date)) : NaN;
  const ended = (Number.isFinite(endMs) && endMs <= nowMs) ||
    /ended|closed|complete|finished|unsold|not_sold|no_sale|sold/.test(auction);
  const reserveNotMet = /not[_\s-]?met|rnm/.test(reserve) || /reserve[_\s-]?not[_\s-]?met/.test(`${auction} ${sale}`);

  if (/^sold$|^completed$/.test(sale) || auction === "sold" || row.sale_date || row.bat_sale_date) {
    if (!reserveNotMet) return "sold";
  }
  if (ended && reserveNotMet) return "ended_reserve_not_met";
  if (ended && (/unsold|not_sold|no_sale|bid_to/.test(`${auction} ${sale}`) || lc(raw) === "active")) {
    return "ended_unsold";
  }
  if (!ended && Number.isFinite(endMs) && (auction === "active" || auction === "live" || lc(raw) === "active")) {
    return "live_auction";
  }
  return raw;
}

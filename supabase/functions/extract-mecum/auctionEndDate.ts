/**
 * Lot sale date for auction_events.auction_end_date: the published auction day start when it parses, else the run day
 * at UTC midnight. Same rule as the listing episode's ended_at, so the two never disagree.
 */
export function mecumAuctionEndDate(
  vehicle: { auction_date?: string | null; auction_day_start?: string | null },
  sale?: { run_day?: string | null } | null,
): string | null {
  const ad = vehicle.auction_date ?? "";
  const runDay = /^\d{4}-\d{2}-\d{2}/.test(ad) ? ad.slice(0, 10) : (sale?.run_day ?? null);
  const ds = vehicle.auction_day_start;
  if (ds && !isNaN(Date.parse(ds.replace(" ", "T") + "Z"))) return new Date(ds.replace(" ", "T") + "Z").toISOString();
  return runDay && !isNaN(Date.parse(runDay + "T00:00:00Z")) ? new Date(runDay + "T00:00:00Z").toISOString() : null;
}

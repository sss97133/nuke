// What batch-extract-snapshots may write to a vehicle, as the database enforces it. Two BEFORE UPDATE triggers on vehicles
// refuse a whole row when one field breaks them, and the function treated the refusal as a failed row:
//
// 1. guard_vehicle_sale_price (2026-09-27, vehicles_sale_price_requires_sold_status): a sale_price above 0 is refused unless
//    the row's sale_status or auction_outcome is 'sold'. "A price alone is a bid, an ask or an estimate, never a sale."
//    The Barrett-Jackson parser returns a price for every snapshot (hammerPrice, else the RSC "price" field).
// 2. enforce_vin_uniqueness: a VIN already on another vehicle is refused with unique_violation (23505) and the message
//    "VIN <vin> already exists on vehicle <id>". The retry written for the native unique index looked for the words
//    "unique constraint", which this message does not contain, so a VIN conflict failed the row.
//
// Measured 2026-10-14 on 239 live rows from three slices of the pending Barrett-Jackson queue, with the function's own
// parser: 65 rows (27%) would write a price to a vehicle not marked sold, and 90 would write a VIN, all 90 of them already
// on another vehicle (a www and non-www twin, or the same car under a Mecum row). 110 rows (46%) would have had their whole
// update refused, 46 of them with other fields that would have landed.

/** guard_vehicle_sale_price's test: money moved only if the vehicle says so. */
export function salePriceWritable(vehicle: { sale_status?: string | null; auction_outcome?: string | null }): boolean {
  return vehicle.sale_status === 'sold' || vehicle.auction_outcome === 'sold';
}

/** A unique violation from the vehicles update: the VIN trigger (23505, "already exists on vehicle") or a unique index. */
export function isUniqueViolation(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /unique constraint|already exists on vehicle/i.test(String(err.message ?? ''));
}

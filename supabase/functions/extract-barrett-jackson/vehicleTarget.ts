// Which vehicle a Barrett-Jackson lot is written to.
//
// A caller that already knows the vehicle (a re-land of an auction result that has no vehicle_events episode) passes its
// id. That id wins over the URL, queue and VIN lookups, and it must exist: a forced id never falls through to inserting
// a new vehicle (2026-10-16: a re-land resolved by discovery_url alone would mint a duplicate car whenever the
// vehicle's discovery_url is another URL). The identity guard in saveVehicle still refuses a lot that is a different
// car from the forced vehicle.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request's vehicle_id when it is a uuid; anything else is no forced vehicle. */
export function forcedVehicleId(body: unknown): string | undefined {
  const v = (body as { vehicle_id?: unknown } | null)?.vehicle_id;
  return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : undefined;
}

export type VehicleTarget =
  | { kind: "forced"; id: string }
  | { kind: "found"; id: string }
  | { kind: "new" };

/**
 * The vehicle to write: the forced id, else the queue row's vehicle, else the vehicle whose discovery_url is the lot,
 * else the VIN match, else a new vehicle. A forced id is never "new".
 */
export function pickVehicleTarget(c: {
  forced?: string;
  queue?: string | null;
  url?: string | null;
  vin?: string | null;
}): VehicleTarget {
  if (c.forced) return { kind: "forced", id: c.forced };
  const found = c.queue || c.url || c.vin;
  return found ? { kind: "found", id: found } : { kind: "new" };
}

/** A forced vehicle that does not exist is refused, never replaced by a new one. */
export class ForcedVehicleMissing extends Error {
  constructor(public vehicleId: string) {
    super(`forced vehicle ${vehicleId} does not exist`);
  }
}

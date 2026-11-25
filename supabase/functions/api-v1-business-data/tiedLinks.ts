/**
 * Which organization links a business's manager may read through api-v1-business-data.
 *
 * The function reads with the project secret key, so RLS does not apply. Before this gate, GET /vehicles returned every
 * link of the caller's organization with the car's year, make, model, VIN and color, and /summary counted them. Any
 * signed-in user can make an organization, own it and link any car id (the insert policy checks only the stamped
 * linker), so that read handed out a stranger's private car by id.
 *
 * The rule is the one sold_vehicle_proof and organization_vehicle_books use (caller_manages_tied_org_link,
 * 20261126121500): the caller is already checked as an active owner or manager of the organization, so a link is kept
 * when its car is publicly readable (vehicle_publicly_readable: public, and not deleted unless merged) or when
 * organization_vehicle_link_grants(car, linker) admits it. Anything else, including a link whose car row is missing or
 * a grants call that fails, is dropped. The gate's own columns are removed before the rows are returned.
 */

export type LinkedVehicle = {
  id: string;
  is_public: boolean | null;
  deleted_at: string | null;
  merged_into_vehicle_id: string | null;
  [k: string]: unknown;
};

export type LinkRow = {
  vehicle_id: string | null;
  linked_by_user_id: string | null;
  vehicles: LinkedVehicle | null;
  [k: string]: unknown;
};

/** organization_vehicle_link_grants(p_vehicle_id, p_linker) through the secret-key client; null on any error. */
export type GrantsCall = (vehicleId: string, linker: string | null) => Promise<boolean | null>;

/** The columns the gate needs, appended to a select of organization_vehicles with a vehicles:vehicle_id embed. */
export const GATE_LINK_COLUMNS = "vehicle_id, linked_by_user_id";
export const GATE_VEHICLE_COLUMNS = "is_public, deleted_at, merged_into_vehicle_id";

export function vehiclePubliclyReadable(v: LinkedVehicle | null): boolean {
  return !!v && v.is_public === true && (v.deleted_at == null || v.merged_into_vehicle_id != null);
}

/** The rows the caller may read, in their order, without the gate's columns. Grants calls run only for cars the
 *  public cannot read, a few at a time. */
export async function keepReadableOrTiedLinks<T extends LinkRow>(
  rows: T[],
  grants: GrantsCall,
  concurrency = 10,
): Promise<Omit<T, "vehicle_id" | "linked_by_user_id">[]> {
  const keep = rows.map((r) => vehiclePubliclyReadable(r.vehicles));
  const pending = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => !keep[i] && r.vehicles && r.vehicle_id);
  for (let k = 0; k < pending.length; k += concurrency) {
    const batch = pending.slice(k, k + concurrency);
    const answers = await Promise.all(batch.map(({ r }) => grants(r.vehicle_id as string, r.linked_by_user_id)));
    batch.forEach(({ i }, j) => {
      keep[i] = answers[j] === true;
    });
  }
  return rows.filter((_, i) => keep[i]).map((r) => {
    const { vehicle_id: _v, linked_by_user_id: _l, vehicles, ...rest } = r;
    let embed: Record<string, unknown> | null = null;
    if (vehicles) {
      const { is_public: _p, deleted_at: _d, merged_into_vehicle_id: _m, ...shown } = vehicles;
      embed = shown;
    }
    return { ...rest, vehicles: embed } as Omit<T, "vehicle_id" | "linked_by_user_id">;
  });
}

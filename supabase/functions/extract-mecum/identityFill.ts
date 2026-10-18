/**
 * Identity is fill-only on a resolved vehicle: year, make, model and VIN are written only where the vehicle's own value is
 * empty, and a lot that states a different year, make or VIN (case, spacing and punctuation ignored) is not this vehicle.
 * Model is fill-only but never a disagreement (the same car is "Series 61" and "Series 61 Coupe" on different pages).
 */

const KEYS = ["year", "make", "model", "vin"] as const;

/** Whether a lot's year, make or VIN is the vehicle's own, ignoring case, spacing and punctuation. */
export function sameIdentityValue(field: string, have: unknown, lot: unknown): boolean {
  const norm = (v: unknown) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (field === "year") return Number(have) === Number(lot);
  return norm(have) === norm(lot);
}

const empty = (v: unknown) => v === null || v === undefined || v === "";

/**
 * A vehicles update refused because the lot's VIN is already on another vehicle: enforce_vin_uniqueness raises 23505 with
 * "VIN <vin> already exists on vehicle <id>", and the native unique indexes name `vin` in the constraint. Returns the
 * holder's id when the message names one ("" when it does not), or null when the error is not a VIN conflict.
 */
export function vinConflictHolder(err: { code?: string | null; message?: string | null } | null | undefined): string | null {
  if (!err) return null;
  const message = String(err.message ?? "");
  const named = /already exists on vehicle\s+([0-9a-f-]{8,36})/i.exec(message);
  if (named) return named[1];
  if (/already exists on vehicle/i.test(message)) return "";
  if (err.code === "23505" && /\bvin\b|vehicles_vin/i.test(message)) return "";
  return null;
}

/** `update` without the identity fields the vehicle already has, and the fields where the lot disagrees. */
export function fillOnlyIdentity(
  existing: Record<string, unknown> | null | undefined,
  update: Record<string, unknown>,
): { update: Record<string, unknown>; disagree: string[] } {
  const out = { ...update };
  const disagree: string[] = [];
  for (const k of KEYS) {
    const have = existing?.[k];
    if (empty(have)) continue;
    const lot = out[k];
    if (!empty(lot) && k !== "model" && !sameIdentityValue(k, have, lot)) disagree.push(k);
    delete out[k];
  }
  return { update: out, disagree };
}

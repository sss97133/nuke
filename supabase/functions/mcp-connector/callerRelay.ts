// What a write tool may do for the credential that called it (2026-11-25).
//
// The connector holds the service key. Three write tools reachable with write:observations (any signed-up user's
// OAuth login, and an API key's default scopes) used it on the caller's behalf without asking whose record the call
// named: submit_vehicle_event sent the envelope to api-v1-events with the service key, which skips that function's own
// per-VIN scope check and lets correction_of supersede any observation on the vehicle; ingest_photos inserted
// vehicle_images on any named or hint-matched vehicle, with documented_by_user_id taken from the arguments, and
// uploaded with upsert:true at a guessable path; submit_observation passed structured_data.owner_confirmed through.
// These helpers decide, for a caller that is not the service key: forward its own credential, require
// user_can_edit_vehicle before anything lands on a vehicle, and name the caller, never an argument, as the person.
import type { CallerContext } from "./ownerStatements.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

/** The service key, as the connector's authenticate() reports it. Nothing else is trusted to act for someone else. */
export function isServiceCaller(caller: CallerContext | undefined): boolean {
  return caller?.userId === "service-role";
}

/** The caller's own account id, when the credential carries one. An agent key with no user has none. */
export function callerUserId(caller: CallerContext | undefined): string | null {
  return caller?.userId && UUID.test(caller.userId) ? caller.userId : null;
}

/**
 * Headers that carry this caller's own identity to another function: the service key for the service key, otherwise
 * the caller's own OAuth login or API key on X-API-Key (apiKeyAuth.authenticateRequest reads both the same way), so the
 * target applies its own scope check and records the caller. null when there is nothing of the caller's to forward.
 */
export function callerRelayHeaders(caller: CallerContext | undefined, serviceKey: string): Record<string, string> | null {
  if (isServiceCaller(caller)) return { Authorization: `Bearer ${serviceKey}` };
  const own = caller?.oauthToken ?? caller?.apiKey;
  return own ? { "X-API-Key": own } : null;
}

/** May this caller put something on this vehicle? The service key may; a person must pass user_can_edit_vehicle. */
export async function callerMayEditVehicle(rpc: Rpc, caller: CallerContext | undefined, vehicleId: string | null): Promise<boolean> {
  if (isServiceCaller(caller)) return true;
  const userId = callerUserId(caller);
  if (!userId || !vehicleId || !UUID.test(vehicleId)) return false;
  try {
    const { data, error } = await rpc("user_can_edit_vehicle", { p_vehicle_id: vehicleId, p_user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** The body submit_observation sends to ingest-observation, and whether an owner sign-off was dropped. */
export async function scopedObservation(rpc: Rpc, caller: CallerContext | undefined, args: Record<string, unknown>):
  Promise<{ body: Record<string, unknown>; ownerConfirmedDropped: boolean }> {
  const structured = { ...((args.structured_data && typeof args.structured_data === "object" && !Array.isArray(args.structured_data))
    ? args.structured_data as Record<string, unknown> : {}) };
  const body: Record<string, unknown> = {
    vehicle_id: args.vehicle_id,
    source_slug: args.source_slug,
    kind: args.kind,
    content_text: args.content_text || null,
    structured_data: structured,
    confidence_score: args.confidence_score || 0.5,
    source_url: args.source_url || null,
  };
  if (isServiceCaller(caller)) {
    body.submitted_by_user_id = args.submitted_by_user_id || null;
    return { body, ownerConfirmedDropped: false };
  }
  // An owner's sign-off adds 0.30 to the confidence in ingest-observation: only someone who can edit the car signs.
  let ownerConfirmedDropped = false;
  if (structured.owner_confirmed !== undefined) {
    const vehicleId = typeof args.vehicle_id === "string" ? args.vehicle_id : null;
    if (structured.owner_confirmed !== true || !(await callerMayEditVehicle(rpc, caller, vehicleId))) {
      ownerConfirmedDropped = structured.owner_confirmed === true;
      delete structured.owner_confirmed;
    }
  }
  body.observer_raw = { via: "mcp-connector", user_id: callerUserId(caller) };
  return { body, ownerConfirmedDropped };
}

/** For ingest_photos: whose photos these are, which vehicle they may land on, and how they are stored. */
export async function scopedPhotoIngest(rpc: Rpc, caller: CallerContext | undefined, args: Record<string, unknown>,
  resolvedVehicleId: string | null): Promise<{
    documentedBy: string | null; vehicleId: string | null; vehicleRefused: boolean; source: string; upsert: boolean;
    storageName: (filename: string) => string;
  }> {
  const rawSource = typeof args.source === "string" && args.source ? args.source : "ai_ingest";
  if (isServiceCaller(caller)) {
    const documentedBy = typeof args.user_id === "string" && args.user_id ? args.user_id : null;
    return { documentedBy, vehicleId: resolvedVehicleId, vehicleRefused: false, source: rawSource, upsert: true,
      storageName: (filename) => filename };
  }
  const may = resolvedVehicleId ? await callerMayEditVehicle(rpc, caller, resolvedVehicleId) : false;
  return {
    documentedBy: callerUserId(caller),
    vehicleId: may ? resolvedVehicleId : null,
    vehicleRefused: !!resolvedVehicleId && !may,
    // The source is a path segment: a caller's word is kept only when it is a plain slug.
    source: /^[a-z0-9_-]{1,40}$/.test(rawSource) ? rawSource : "ai_ingest",
    // Never replace an object that is already stored: a fresh name each time, and no upsert.
    upsert: false,
    storageName: (filename) => `${crypto.randomUUID()}_${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`,
  };
}

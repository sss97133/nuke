import { readIdentifierClaims } from "./identifierClaims.ts";

/** Lands typed, quoted identifier claims for a vehicle through the land_identifier_claims RPC. Never throws:
 * identifier capture must not break extraction. Returns the RPC result or an error string. */
export async function landIdentifierClaims(supabase: any, input: {
  vehicleId: string | null | undefined; text: string | null | undefined; sourceUrl?: string | null; extractor: string;
}): Promise<unknown> {
  if (!input.vehicleId || !input.text) return { status: "skipped" };
  try {
    const read = readIdentifierClaims(input.text);
    const { data, error } = await supabase.rpc("land_identifier_claims", {
      p_vehicle_id: input.vehicleId, p_read: read, p_source_url: input.sourceUrl ?? null, p_extractor: input.extractor,
    });
    if (error) { console.warn(`[identifiers] ${input.extractor}: ${error.message}`); return { status: "error", error: error.message }; }
    return data;
  } catch (e) { console.warn(`[identifiers] ${input.extractor}: ${e}`); return { status: "error", error: String(e) }; }
}

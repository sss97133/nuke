/**
 * The VIN a lookup request names. GET /api-v1-vin-lookup/{vin} carries it in the path. POST with a JSON body
 * {"vin": "..."} is what the published Nuke MCP server (nuke-mcp-server 1.0.3, decode_vin) sends; before
 * 2026-11-11 this function answered that with 405 on every VIN. Returns null when no VIN is named.
 */
export function requestedVin(method: string, pathname: string, body: unknown): string | null {
  if (method === "POST") {
    const v = body && typeof body === "object" ? (body as Record<string, unknown>).vin : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last && last !== "api-v1-vin-lookup" ? decodeURIComponent(last) : null;
}

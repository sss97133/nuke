// Nuke Asset Advisor — curated read-only MCP surface (path /mcp/advisor or surface=advisor).
export {
  ADVISOR_TOOLS,
  ADVISOR_TOOL_NAMES,
  ADVISOR_SERVER_INFO,
  ADVISOR_INSTRUCTIONS,
  type AdvisorToolDef,
} from "./tools.ts";
export {
  createAdvisorHandlers,
  type AdvisorDeps,
  type AdvisorToolResult,
} from "./handlers.ts";
export {
  AGENT_CITATION_RULES,
  ENVELOPE_OUTPUT_SCHEMA,
  assertEnvelopeShape,
  citationFromObservation,
  extractEventTime,
  loadBestRecoveredSaleClocks,
  makeEnvelope,
  notRecordedClaim,
  recordedClaim,
  resolveClaimConfidence,
  resolveEventSaleClock,
  type AdvisorEnvelope,
  type Claim,
  type Citation,
  type RecoveredSaleClock,
} from "./evidence.ts";
export { initAdvisorHandlers, handleAdvisorJsonRpc } from "./protocol.ts";

/** True when the request targets the Asset Advisor surface. */
export function isAdvisorSurface(req: Request): boolean {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/advisor") || path.endsWith("/mcp/advisor")) return true;
  const header = (req.headers.get("x-nuke-surface") || "").toLowerCase();
  if (header === "advisor") return true;
  const q = (url.searchParams.get("surface") || "").toLowerCase();
  return q === "advisor";
}

// ── Lightweight anon rate limit (per-isolate; best-effort on edge) ───────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ANON = 60; // requests / minute / IP on advisor surface
const hits = new Map<string, number[]>();

export function checkAdvisorRateLimit(req: Request): { ok: true } | { ok: false; retryAfterSec: number } {
  // Authenticated callers (API key / bearer) skip the anon bucket; mcp-connector auth handles them.
  if (req.headers.get("X-API-Key") || req.headers.get("Authorization")) {
    return { ok: true };
  }
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon";
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const prev = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (prev.length >= RATE_MAX_ANON) {
    const retryAfterSec = Math.max(1, Math.ceil((prev[0]! + RATE_WINDOW_MS - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  prev.push(now);
  hits.set(ip, prev);
  // Bound map size
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || v[v.length - 1]! < windowStart) hits.delete(k);
    }
  }
  return { ok: true };
}

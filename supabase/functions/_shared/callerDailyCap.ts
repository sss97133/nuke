// Per-user daily call cap for a function that spends money per call and is open to any signed-in account
// (sign-up is open, so signed in is anyone). The cap is a rule row in edge_function_caller_caps; the count is
// rate_limits through rate_limit_increment, keyed <function>:user:<user id>:<UTC day start>. The service key is not
// capped. A caller with no user id, a missing or unreadable rule row, or a counter error is refused: this is a spend
// control, so it fails closed (2026-11-25).
import { authenticateWriter } from "./writeGuard.ts";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
type CapRow = { calls_per_user_per_day: number } | null;
export type CapDeps = {
  readCap: (fn: string) => Promise<CapRow>;
  rpc: Rpc;
  now?: () => number;
  caller?: (req: Request) => Promise<{ service: boolean; userId: string | null }>;
};

const DAY = 86_400;

async function defaultCaller(req: Request) {
  const v = await authenticateWriter(req);
  if (!v.ok) return { service: false, userId: null };
  if (v.caller.kind === "service_role") return { service: true, userId: null };
  const userId = v.caller.kind === "user" || v.caller.kind === "api_key" ? v.caller.userId : null;
  return { service: false, userId };
}

/** null when the call may proceed; otherwise the refusal to return. */
export async function enforceCallerDailyCap(
  req: Request,
  fn: string,
  deps: CapDeps,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const refuse = (status: number, error: string, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...headers, ...extra, "Content-Type": "application/json" } });
  const who = await (deps.caller ?? defaultCaller)(req);
  if (who.service) return null;
  if (!who.userId) return refuse(403, "this call needs an account");
  let cap: CapRow;
  try {
    cap = await deps.readCap(fn);
  } catch {
    cap = null;
  }
  if (!cap || !(cap.calls_per_user_per_day > 0)) return refuse(503, "daily limit unavailable; try again later");
  const nowS = Math.floor((deps.now ?? Date.now)() / 1000);
  const dayStart = nowS - (nowS % DAY);
  const { data, error } = await deps.rpc("rate_limit_increment", {
    p_key: `${fn}:user:${who.userId}:${dayStart}`,
    p_window_start: new Date(dayStart * 1000).toISOString(),
    p_expires_at: new Date((dayStart + DAY) * 1000).toISOString(),
  });
  if (error || typeof data !== "number") return refuse(503, "daily limit unavailable; try again later");
  if (data > cap.calls_per_user_per_day) {
    return refuse(429, `daily limit of ${cap.calls_per_user_per_day} reached`, { "Retry-After": String(dayStart + DAY - nowS) });
  }
  return null;
}

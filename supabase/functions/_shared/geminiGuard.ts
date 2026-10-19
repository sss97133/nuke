// Spend guard for every Gemini (generativelanguage.googleapis.com) call.
//
// geminiFetch() is a drop-in for fetch(): same arguments, same Response. Before each call it
//   1. refuses while a recent 402/429/403 from Google put the guard in cooldown (10 min), so no caller can
//      loop on a quota or billing error;
//   2. reads the daily cap from platform_config 'gemini_spend_guard' ({ daily_cap, paused }, default 500);
//   3. counts today's calls in llm_cost_tracking (provider 'google', one row per call, UTC date) and refuses at the cap;
//   4. records the call, then makes it.
// A refusal is a synthetic Response (429, header x-gemini-guard) so existing `!response.ok` handling keeps working.
// If the count cannot be read the call is refused (503): unknown spend is not allowed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { projectSecretKey } from "./supabaseKeys.ts";

const CONFIG_KEY = "gemini_spend_guard";
export const DEFAULT_DAILY_CAP = 500;
const COOLDOWN_MS = 10 * 60_000;
const CONFIG_TTL_MS = 60_000;

type GuardConfig = { daily_cap: number; paused: boolean };
type Db = { from: (t: string) => any; noLocalCooldown?: boolean };

let db: Db | null = null;
let blockedUntil = 0;
let cached: { at: number; value: GuardConfig } | null = null;

function client(): Db {
  if (!db) db = createClient(Deno.env.get("SUPABASE_URL")!, projectSecretKey()!) as unknown as Db;
  return db;
}

/** Test seam: replace the database client and reset isolate state. */
export function __setGuardDb(next: Db | null) { db = next; blockedUntil = 0; cached = null; }

export function parseConfig(raw: unknown): GuardConfig {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cap = Number(v.daily_cap);
  return { daily_cap: Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : DEFAULT_DAILY_CAP, paused: v.paused === true };
}

export function modelOf(url: string): string {
  return /\/models\/([^:/?]+)/.exec(url)?.[1] ?? "unknown";
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function refusal(status: number, reason: string, detail: string): Response {
  console.warn(`[gemini-guard] refused: ${reason} (${detail})`);
  return new Response(JSON.stringify({ error: { code: status, message: `gemini_guard_${reason}`, detail } }), {
    status,
    headers: { "content-type": "application/json", "x-gemini-guard": reason },
  });
}

async function readConfig(): Promise<GuardConfig> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  const { data, error } = await client().from("platform_config").select("config_value").eq("config_key", CONFIG_KEY).maybeSingle();
  if (error) throw new Error(`config read failed: ${error.message}`);
  const value = parseConfig(data?.config_value);
  cached = { at: Date.now(), value };
  return value;
}

/** `caller` names the function making the call (stored in llm_cost_tracking.caller). */
export async function geminiFetch(url: string | URL, init: RequestInit | undefined, caller: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const target = String(url);
  if (Date.now() < blockedUntil) return refusal(429, "cooldown", "upstream refused recently");

  const model = modelOf(target);
  let rowId: string | null = null;
  try {
    const cfg = await readConfig();
    if (cfg.paused) return refusal(429, "paused", "platform_config gemini_spend_guard.paused");
    const day = utcDay();
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const blocks = await client()
      .from("llm_cost_tracking")
      .select("id", { count: "exact", head: true })
      .eq("provider", "google_block")
      .gte("created_at", since);
    if (blocks.error) throw new Error(`cooldown read failed: ${blocks.error.message}`);
    if ((blocks.count ?? 0) > 0) return refusal(429, "cooldown", "upstream refused in the last 10 minutes");
    const { count, error } = await client()
      .from("llm_cost_tracking")
      .select("id", { count: "exact", head: true })
      .eq("provider", "google")
      .eq("date", day);
    if (error) throw new Error(`count failed: ${error.message}`);
    if ((count ?? 0) >= cfg.daily_cap) return refusal(429, "daily_cap", `${count}/${cfg.daily_cap} on ${day}`);
    const ins = await client()
      .from("llm_cost_tracking")
      .insert({ provider: "google", model, caller, date: day })
      .select("id")
      .maybeSingle();
    if (ins.error) throw new Error(`record failed: ${ins.error.message}`);
    rowId = ins.data?.id ?? null;
  } catch (e) {
    return refusal(503, "unavailable", e instanceof Error ? e.message : String(e));
  }

  const started = Date.now();
  const response = await fetchImpl(url, init);
  if (response.status === 402 || response.status === 429 || response.status === 403) {
    if (!client().noLocalCooldown) blockedUntil = Date.now() + COOLDOWN_MS;
    console.warn(`[gemini-guard] upstream ${response.status} from ${caller}/${model}: cooling down ${COOLDOWN_MS / 60_000} min`);
    // A shared marker so other isolates stop too (every call checks for one before going out).
    await client().from("llm_cost_tracking").insert({ provider: "google_block", model, caller, date: utcDay(), task: String(response.status) });
  }
  if (rowId) {
    // best effort: duration only; the call row already counts toward the cap
    client().from("llm_cost_tracking").update({ duration_ms: Date.now() - started, task: String(response.status) }).eq("id", rowId).then(() => {}, () => {});
  }
  return response;
}

/** Test helper: a database that has no cap, no cooldown and accepts every record. For suites that assert exact fetch counts. */
export function allowAllGuardDb(): Db {
  return {
    noLocalCooldown: true,
    from() {
      const q: any = {};
      for (const m of ["select", "eq", "gte", "insert", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { id: "test-row", config_value: { daily_cap: 1e9 } }, error: null });
      q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ count: 0, data: null, error: null }).then(ok, bad);
      return q;
    },
  };
}

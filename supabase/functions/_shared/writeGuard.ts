/**
 * writeGuard — no edge function that writes to the database runs for an anonymous caller.
 *
 * Who gets through:
 *   (a) a project secret key (`sb_secret_…`), or the service_role JWT the gateway mints for one, or
 *       the legacy service_role key only while the platform still accepts it: cron, CI, scripts,
 *       function-to-function calls;
 *   (b) a signed-in user's JWT (role `authenticated`) — writes users trigger from nuke.ag;
 *   (c) with { apiKeys }: an `X-API-Key: nk_live_…` key, validated the same way apiKeyAuth.ts does;
 *   (d) with { allowAnonymous }: one narrow, function-argued exception (today only the public
 *       share-page verdict in ingest-observation). The function passes the predicate; the guard
 *       still records that the caller was anonymous.
 * Everything else — no token, the public anon key, a forged or expired JWT — is refused with 401.
 *
 * Why the anon key is refused: it ships in nuke.ag's JavaScript bundle, so it proves nothing.
 * Why signatures are checked here instead of trusting the gateway: CI deploys every function
 * with --no-verify-jwt, and even a gateway-verified anon JWT would still be anonymous.
 *
 * How a bearer token is judged, in order:
 *   1. exact match with an opaque key this function holds (SUPABASE_SECRET_KEYS, or a
 *      legacy-named env whose value is not a JWT)                              → service_role
 *   2. any other `sb_secret_` key (created after this worker started, or deleted): a one-row
 *      PostgREST HEAD with it as the apikey decides                             → service_role or refused
 *   3. any other `sb_` key (a publishable key)                                    → refused
 *   4. decode: not a JWT, expired, role `anon`, or an unknown role               → refused
 *   5. signature: ES256/RS256 against the project JWKS (SUPABASE_JWKS env or
 *      /auth/v1/.well-known/jwks.json). The JWT the gateway mints for a secret key on a function
 *      call lands here.
 *   6. otherwise the platform is the authority: GoTrue /auth/v1/user for a user token, a one-row
 *      PostgREST HEAD for a service token. Still failing → refused.
 *   HS256 tokens (the legacy anon and service_role keys, and anything else signed with the legacy
 *   JWT secret) always go to step 6. The legacy JWT secret is public (git history) and copies of it and
 *   of the legacy keys stay in function secrets after the dashboard revokes them, so neither a local
 *   signature check nor a match with the env proves anything; the platform's answer follows the
 *   dashboard. 2026-10-14 key switch-over.
 * When the bearer is refused and the `apikey` header holds a secret key, that key is judged too (the
 * Supabase guide sends secret keys on `apikey`); nothing else on `apikey` counts.
 *
 * Usage — first statement of the handler; OPTIONS passes through untouched so the function's
 * own CORS preflight keeps working:
 *   import { requireWriteAuth } from "../_shared/writeGuard.ts";
 *   const denied = await requireWriteAuth(req);
 *   if (denied) return denied;
 *
 * Coverage is enforced by scripts/guardrails/check-write-guard.mjs (runs in supabase-deploy.yml).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashApiKey } from "./apiKeyAuth.ts";
import { knownSecretKeys, projectPublishableKey, projectSecretKey } from "./supabaseKeys.ts";

const REMOTE_TIMEOUT_MS = 6000;
const JWKS_TTL_MS = 10 * 60 * 1000;

export type WriteCaller =
  | { kind: "service_role"; via: "secret-key" | "jwt" | "remote" }
  | { kind: "user"; userId: string; via: "jwt" | "remote" }
  | { kind: "api_key"; userId: string | null; agentId: string | null; scopes: string[] }
  | { kind: "anonymous"; via: "exception" };

export type WriteAuthResult =
  | { ok: true; caller: WriteCaller }
  | { ok: false; status: 401 | 403; reason: string };

/** Test seams. Production callers never set these. */
export interface WriteGuardDeps {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  /** unix seconds */
  now?: () => number;
}

export interface WriteGuardOptions {
  /** Also accept `X-API-Key: nk_live_…` keys (checked through check_api_key_rate_limit). */
  apiKeys?: { endpoint: string; requiredScopes?: string[] };
  /** Called only for a caller that would otherwise be refused. Return true to let it through. */
  allowAnonymous?: (req: Request) => boolean | Promise<boolean>;
  /** Extra headers on the 401 (a function's wider CORS allow-list, for example). */
  headers?: Record<string, string>;
  deps?: WriteGuardDeps;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// ── JWT primitives ─────────────────────────────────────────────────────────────

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode without verifying. Null for anything that is not a three-part JWT with JSON parts. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: b64urlToBytes(parts[2]) };
  } catch {
    return null;
  }
}

/** Constant-time comparison for opaque keys. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Jwks {
  keys: Array<Record<string, unknown> & { kid?: string; alg?: string; kty?: string }>;
}

let jwksCache: { at: number; jwks: Jwks } | null = null;

async function loadJwks(deps: Required<WriteGuardDeps>): Promise<Jwks | null> {
  const fromEnv = deps.env("SUPABASE_JWKS");
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      const keys = Array.isArray(parsed) ? parsed : parsed?.keys;
      if (Array.isArray(keys) && keys.length) return { keys };
    } catch { /* fall through to the endpoint */ }
  }
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.jwks;
  const base = deps.env("SUPABASE_URL");
  if (!base) return null;
  try {
    const res = await deps.fetch(`${base}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const jwks = (await res.json()) as Jwks;
    if (!Array.isArray(jwks?.keys)) return null;
    jwksCache = { at: Date.now(), jwks };
    return jwks;
  } catch {
    return null;
  }
}

/** true = signature valid, false = invalid, null = no usable key for this alg/kid. */
async function verifyAsymmetric(jwt: DecodedJwt, jwks: Jwks): Promise<boolean | null> {
  const alg = String(jwt.header.alg ?? "");
  const kid = jwt.header.kid ? String(jwt.header.kid) : null;
  const jwk = jwks.keys.find((k) => (!kid || k.kid === kid) && (!k.alg || k.alg === alg));
  if (!jwk) return null;
  const data = new TextEncoder().encode(jwt.signingInput);
  try {
    if (alg === "ES256") {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, jwt.signature, data);
    }
    if (alg === "RS256") {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, data);
    }
  } catch {
    return false;
  }
  return null;
}

/**
 * true / false when a local check ran; null when only the platform can judge the token.
 * HS256 is never judged locally: whether the legacy JWT secret is still trusted is decided in the
 * dashboard, and a copy of it in this function's env would not change when it is revoked.
 */
async function verifySignatureLocally(jwt: DecodedJwt, deps: Required<WriteGuardDeps>): Promise<boolean | null> {
  const alg = String(jwt.header.alg ?? "");
  if (alg === "ES256" || alg === "RS256") {
    const jwks = await loadJwks(deps);
    return jwks ? await verifyAsymmetric(jwt, jwks) : null;
  }
  return null;
}

// ── Remote authority (the platform itself) ─────────────────────────────────────

async function remoteUserId(token: string, deps: Required<WriteGuardDeps>): Promise<string | null> {
  const base = deps.env("SUPABASE_URL");
  const apikey = projectPublishableKey(deps.env) ?? projectSecretKey(deps.env);
  if (!base || !apikey) return null;
  try {
    const res = await deps.fetch(`${base}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: string };
    return typeof body?.id === "string" && body.id ? body.id : null;
  } catch {
    return null;
  }
}

async function remoteServiceCheck(token: string, deps: Required<WriteGuardDeps>): Promise<boolean> {
  const base = deps.env("SUPABASE_URL");
  if (!base) return false;
  try {
    // PostgREST verifies the signature before it answers anything; a forged key gets 401 here.
    const res = await deps.fetch(`${base}/rest/v1/observation_sources?select=id&limit=1`, {
      method: "HEAD",
      headers: { apikey: token, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Token judgement ────────────────────────────────────────────────────────────

export async function judgeToken(token: string, deps: Required<WriteGuardDeps>): Promise<WriteAuthResult> {
  // A secret key is opaque, so matching one the platform injected is the whole check. A key deleted
  // in the dashboard disappears from SUPABASE_SECRET_KEYS and stops matching.
  for (const key of knownSecretKeys(deps.env)) {
    if (sameKey(token, key)) return { ok: true, caller: { kind: "service_role", via: "secret-key" } };
  }
  if (token.startsWith("sb_secret_")) {
    // Not injected here: a key made after this worker started, a deleted key, or a guess.
    return (await remoteServiceCheck(token, deps))
      ? { ok: true, caller: { kind: "service_role", via: "remote" } }
      : { ok: false, status: 401, reason: "secret key rejected by the platform" };
  }
  if (token.startsWith("sb_")) return { ok: false, status: 401, reason: "not a secret key" };

  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, status: 401, reason: "token is not a JWT" };

  const exp = typeof jwt.payload.exp === "number" ? jwt.payload.exp : null;
  if (exp !== null && exp <= deps.now()) return { ok: false, status: 401, reason: "token expired" };

  const role = typeof jwt.payload.role === "string" ? jwt.payload.role : "";
  if (role === "anon") return { ok: false, status: 401, reason: "anon key" };
  if (role !== "service_role" && role !== "authenticated") {
    return { ok: false, status: 401, reason: `role '${role || "none"}' cannot write` };
  }

  const local = await verifySignatureLocally(jwt, deps);
  if (local === true) {
    if (role === "service_role") return { ok: true, caller: { kind: "service_role", via: "jwt" } };
    const sub = typeof jwt.payload.sub === "string" ? jwt.payload.sub : "";
    if (!sub) return { ok: false, status: 401, reason: "user token without sub" };
    return { ok: true, caller: { kind: "user", userId: sub, via: "jwt" } };
  }

  // No local verdict (no secret / JWKS for this alg) or a failed one: the platform decides.
  console.warn(`[writeGuard] local signature check ${local === null ? "unavailable" : "failed"}; asking the platform (role=${role})`);
  if (role === "service_role") {
    return (await remoteServiceCheck(token, deps))
      ? { ok: true, caller: { kind: "service_role", via: "remote" } }
      : { ok: false, status: 401, reason: "service token rejected by the platform" };
  }
  const userId = await remoteUserId(token, deps);
  return userId
    ? { ok: true, caller: { kind: "user", userId, via: "remote" } }
    : { ok: false, status: 401, reason: "user token rejected by the platform" };
}

async function judgeApiKey(
  rawHeader: string,
  opts: NonNullable<WriteGuardOptions["apiKeys"]>,
  deps: Required<WriteGuardDeps>,
): Promise<WriteAuthResult> {
  const rawKey = rawHeader.startsWith("nk_live_") ? rawHeader.slice(8) : rawHeader;
  const url = deps.env("SUPABASE_URL");
  const serviceKey = projectSecretKey(deps.env);
  if (!url || !serviceKey) return { ok: false, status: 401, reason: "api key check unavailable" };
  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase.rpc("check_api_key_rate_limit", {
    p_key_hash: await hashApiKey(rawKey),
    p_endpoint: opts.endpoint,
  });
  if (error) return { ok: false, status: 401, reason: `api key check failed: ${error.message}` };
  const result = data as {
    allowed?: boolean; user_id?: string; scopes?: string[]; agent_registration_id?: string | null; error?: string;
  };
  if (!result?.allowed) return { ok: false, status: 401, reason: `api key ${result?.error ?? "rejected"}` };
  const scopes = result.scopes ?? [];
  if (opts.requiredScopes?.length) {
    const missing = opts.requiredScopes.filter((s) => !scopes.includes(s));
    if (missing.length) return { ok: false, status: 403, reason: `api key missing scopes: ${missing.join(", ")}` };
  }
  return {
    ok: true,
    caller: { kind: "api_key", userId: result.user_id ?? null, agentId: result.agent_registration_id ?? null, scopes },
  };
}

function withDefaults(deps?: WriteGuardDeps): Required<WriteGuardDeps> {
  return {
    env: deps?.env ?? ((name) => Deno.env.get(name)),
    fetch: deps?.fetch ?? fetch,
    now: deps?.now ?? (() => Math.floor(Date.now() / 1000)),
  };
}

/**
 * Bearer token first; the `apikey` header second. supabase-js copies its key into both; the new
 * secret keys are meant to travel on `apikey` alone, which lands here.
 */
export function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const t = auth.replace(/^bearer\s+/i, "").trim();
    if (t) return t;
  }
  const apikey = req.headers.get("apikey")?.trim();
  return apikey || null;
}

/** Decide who the caller is. Never throws; a thrown dependency reads as a refusal. */
export async function authenticateWriter(req: Request, opts: WriteGuardOptions = {}): Promise<WriteAuthResult> {
  const deps = withDefaults(opts.deps);
  try {
    if (opts.apiKeys) {
      const raw = req.headers.get("x-api-key")?.trim();
      if (raw) {
        const viaKey = await judgeApiKey(raw, opts.apiKeys, deps);
        if (viaKey.ok) return viaKey;
        // A bad API key does not block a token that is independently valid.
        console.warn(`[writeGuard] ${viaKey.reason}`);
      }
    }
    const token = extractToken(req);
    const verdict: WriteAuthResult = token
      ? await judgeToken(token, deps)
      : { ok: false, status: 401, reason: "no token" };
    if (verdict.ok) return verdict;
    const apikey = req.headers.get("apikey")?.trim();
    if (apikey && apikey !== token && apikey.startsWith("sb_secret_")) {
      const viaApikey = await judgeToken(apikey, deps);
      if (viaApikey.ok) return viaApikey;
    }
    if (opts.allowAnonymous && (await opts.allowAnonymous(req))) {
      return { ok: true, caller: { kind: "anonymous", via: "exception" } };
    }
    return verdict;
  } catch (e) {
    return { ok: false, status: 401, reason: `guard error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The 401/403 the guard sends. Exported so functions with their own flow can reuse the shape. */
export function writeAuthResponse(verdict: { status: 401 | 403; reason: string }, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      message: "Anonymous calls are not accepted here: sign in, or call with the service key.",
      reason: verdict.reason,
    }),
    {
      status: verdict.status,
      headers: { ...CORS, ...headers, "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="nuke"' },
    },
  );
}

/**
 * Returns null when the caller may proceed, otherwise the response to send back.
 * OPTIONS is never judged — the function's own CORS preflight answers it.
 */
export async function requireWriteAuth(req: Request, opts: WriteGuardOptions = {}): Promise<Response | null> {
  if (req.method === "OPTIONS") return null;
  const verdict = await authenticateWriter(req, opts);
  if (verdict.ok) return null;
  const path = (() => { try { return new URL(req.url).pathname; } catch { return "?"; } })();
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  console.warn(`[writeGuard] refused ${req.method} ${path} from ${ip}: ${verdict.reason}`);
  return writeAuthResponse(verdict, opts.headers);
}

/**
 * For a function with a service-only path: true when the caller is the service role, judged exactly as
 * requireWriteAuth judges it. Use it instead of comparing the bearer with an env key: the gateway hands
 * functions a minted JWT, not the key the caller sent, and a legacy key in the env proves nothing.
 */
export async function isServiceCaller(req: Request, opts: WriteGuardOptions = {}): Promise<boolean> {
  const verdict = await authenticateWriter(req, opts);
  return verdict.ok && verdict.caller.kind === "service_role";
}

/**
 * For functions that act AS the platform owner: send mail as Nuke, read the owner's books.
 * "Signed in" is not enough there, because sign-up is open and auto-confirmed. Call it after
 * requireWriteAuth. Returns null for the service key or the company owner
 * (parent_company.owner_user_id), otherwise a 403 to send back. It fails closed: if the owner
 * can't be looked up, only the service key passes. OPTIONS is never judged. 2026-09-29.
 */
export async function requireOwnerOrService(req: Request, opts: WriteGuardOptions = {}): Promise<Response | null> {
  if (req.method === "OPTIONS") return null;
  const verdict = await authenticateWriter(req, opts);
  if (verdict.ok && verdict.caller.kind === "service_role") return null;
  const callerId = verdict.ok && (verdict.caller.kind === "user" || verdict.caller.kind === "api_key")
    ? verdict.caller.userId
    : null;
  let ownerId: string | null = null;
  if (callerId) {
    const deps = withDefaults(opts.deps);
    const url = deps.env("SUPABASE_URL");
    const key = projectSecretKey(deps.env);
    try {
      const r = await deps.fetch(`${url}/rest/v1/parent_company?legal_name=eq.NUKE%20LTD&select=owner_user_id&limit=1`, {
        headers: { apikey: key ?? "", Authorization: `Bearer ${key ?? ""}` },
      });
      if (r.ok) {
        const rows = await r.json();
        ownerId = Array.isArray(rows) && typeof rows[0]?.owner_user_id === "string" ? rows[0].owner_user_id : null;
      }
    } catch {
      ownerId = null;
    }
  }
  if (callerId && ownerId && callerId === ownerId) return null;
  const path = (() => { try { return new URL(req.url).pathname; } catch { return "?"; } })();
  console.warn(`[writeGuard] owner-only refused ${req.method} ${path}: ${callerId ? "not the owner" : "no user"}`);
  return new Response(JSON.stringify({ error: "forbidden", reason: "owner only" }), {
    status: 403,
    headers: { ...CORS, ...(opts.headers ?? {}), "Content-Type": "application/json" },
  });
}

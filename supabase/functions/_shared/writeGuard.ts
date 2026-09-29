/**
 * writeGuard — no edge function that writes to the database runs for an anonymous caller.
 *
 * Who gets through:
 *   (a) the project's service_role key — cron (get_service_role_key_for_cron()), CI, scripts,
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
 *   1. exact match with SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY env         → service_role
 *   2. decode: not a JWT, expired, role `anon`, or an unknown role               → refused
 *   3. signature: HS256 against the project JWT secret (JWT_SIGNING_SECRET env), or
 *      ES256/RS256 against the project JWKS (SUPABASE_JWKS env or /auth/v1/.well-known/jwks.json)
 *   4. if step 3 can't run or fails, the platform is the authority: GoTrue /auth/v1/user for a
 *      user token, a one-row PostgREST HEAD for a service token. Still failing → refused.
 *   The platform-injected SUPABASE_SERVICE_ROLE_KEY is NOT always byte-equal to the dashboard
 *   key that cron and CI send (measured 2026-09-27: different digests), which is why step 1
 *   alone would break every scheduled job and steps 3–4 exist.
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

const SERVICE_KEY_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"];
const JWT_SECRET_ENV = ["SUPABASE_JWT_SECRET", "JWT_SIGNING_SECRET", "VITE_SUPABASE_JWT_SECRET"];
const REMOTE_TIMEOUT_MS = 6000;
const JWKS_TTL_MS = 10 * 60 * 1000;

export type WriteCaller =
  | { kind: "service_role"; via: "env-match" | "jwt" | "remote" }
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

async function verifyHs256(jwt: DecodedJwt, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify("HMAC", key, jwt.signature, new TextEncoder().encode(jwt.signingInput));
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

/** true / false when a local check ran; null when nothing local could judge the token. */
async function verifySignatureLocally(jwt: DecodedJwt, deps: Required<WriteGuardDeps>): Promise<boolean | null> {
  const alg = String(jwt.header.alg ?? "");
  if (alg === "HS256") {
    for (const name of JWT_SECRET_ENV) {
      const secret = deps.env(name);
      if (secret) return await verifyHs256(jwt, secret);
    }
    return null;
  }
  if (alg === "ES256" || alg === "RS256") {
    const jwks = await loadJwks(deps);
    return jwks ? await verifyAsymmetric(jwt, jwks) : null;
  }
  return null;
}

// ── Remote authority (the platform itself) ─────────────────────────────────────

async function remoteUserId(token: string, deps: Required<WriteGuardDeps>): Promise<string | null> {
  const base = deps.env("SUPABASE_URL");
  const apikey = deps.env("SUPABASE_ANON_KEY") ?? deps.env("SUPABASE_SERVICE_ROLE_KEY");
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
  for (const name of SERVICE_KEY_ENV) {
    const known = deps.env(name);
    if (known && token === known) return { ok: true, caller: { kind: "service_role", via: "env-match" } };
  }

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
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? deps.env("SERVICE_ROLE_KEY");
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

/** Bearer token first; the `apikey` header second (cron and CI send the service key in both). */
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
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? deps.env("SERVICE_ROLE_KEY");
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

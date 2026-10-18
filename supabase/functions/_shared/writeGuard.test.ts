/**
 * writeGuard unit tests — run with:
 *   deno test --node-modules-dir=none --allow-env --allow-net supabase/functions/_shared/writeGuard.test.ts
 * (--allow-net only so esm.sh imports resolve; every remote call below is a stub.)
 * Every key below is a disposable test string.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { knownSecretKeys, projectSecretKey } from "./supabaseKeys.ts";
import {
  authenticateWriter,
  decodeJwt,
  isServiceCaller,
  requireAdminOrService,
  requireOwnerOrService,
  requireWriteAuth,
  type WriteGuardDeps,
} from "./writeGuard.ts";

const LEGACY_SECRET = "test-legacy-hmac-secret-01";
const DEFAULT_KEY = "sb_secret_test_default_01";
const CRON_KEY = "sb_secret_test_cron_01";
const INJECTED_KEY = "sb_secret_test_injected_01";
const PUBLISHABLE_KEY = "sb_publishable_test_01";
const NOW = 1_800_000_000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** A token signed with the legacy JWT secret, as the legacy anon and service_role keys are. */
async function hs256(payload: Record<string, unknown>, secret = LEGACY_SECRET): Promise<string> {
  const input = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

// The project's current signing key (ES256): user sessions and the gateway's minted tokens.
const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const JWKS = JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] });
async function es256(payload: Record<string, unknown>, key: CryptoKey = signer.privateKey): Promise<string> {
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: "k1" })}.${enc(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

const LEGACY_SERVICE_JWT = await hs256({ iss: "supabase", ref: "x", role: "service_role", iat: NOW - 10, exp: NOW + 10_000 });

// The function environment as measured on 2026-10-14: the platform puts a secret key under the legacy name,
// the JSON maps hold the named keys, and user-set secrets still hold the legacy JWT and the legacy JWT secret.
const baseEnv: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: INJECTED_KEY,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: DEFAULT_KEY, cron: CRON_KEY }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE_KEY }),
  SUPABASE_JWKS: JWKS,
  SERVICE_ROLE_KEY: LEGACY_SERVICE_JWT,
  JWT_SIGNING_SECRET: LEGACY_SECRET,
};

interface DepOverrides {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  now?: () => number;
}

function deps(overrides: DepOverrides = {}): WriteGuardDeps {
  const env = overrides.env ?? baseEnv;
  return {
    env: (n) => env[n],
    now: overrides.now ?? (() => NOW),
    // Default stub: the platform rejects everything, as it rejects the legacy keys since 2026-10-14.
    fetch: overrides.fetch ?? (() => Promise.resolve(new Response("", { status: 401 }))),
  };
}

/** A platform stub that accepts one token on a PostgREST HEAD (as the apikey) and records every call. */
function platformAccepting(token: string, calls: string[] = []): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const ok = String(url).includes("/rest/v1/observation_sources") && init?.method === "HEAD" && headers.apikey === token;
    return Promise.resolve(new Response("", { status: ok ? 200 : 401 }));
  }) as typeof fetch;
}

function req(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("https://example.supabase.co/functions/v1/some-writer", { method, headers });
}

Deno.test("no token → 401", async () => {
  const res = await requireWriteAuth(req(), { deps: deps() });
  assertEquals(res?.status, 401);
  const body = await res!.json();
  assertEquals(body.error, "unauthorized");
  assertEquals(body.reason, "no token");
});

Deno.test("OPTIONS is never judged", async () => {
  assertEquals(await requireWriteAuth(req({}, "OPTIONS"), { deps: deps() }), null);
});

// ── 1. secret keys this function holds ─────────────────────────────────────────

Deno.test("a named secret key (the cron key) on the bearer → service_role via secret-key", async () => {
  const v = await authenticateWriter(req({ Authorization: `Bearer ${CRON_KEY}` }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "secret-key" } });
});

Deno.test("the secret key the platform injects under the legacy name → service_role via secret-key", async () => {
  const v = await authenticateWriter(req({ Authorization: `Bearer ${INJECTED_KEY}`, apikey: INJECTED_KEY }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "secret-key" } });
});

Deno.test("a secret key on the apikey header only → service_role", async () => {
  const v = await authenticateWriter(req({ apikey: DEFAULT_KEY }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "secret-key" } });
});

// ── 2–3. other sb_ keys ────────────────────────────────────────────────────────

Deno.test("a secret key this worker doesn't hold → the platform decides", async () => {
  const fresh = "sb_secret_test_made_later_01";
  const calls: string[] = [];
  const ok = await authenticateWriter(req({ Authorization: `Bearer ${fresh}` }), { deps: deps({ fetch: platformAccepting(fresh, calls) }) });
  assertEquals(ok, { ok: true, caller: { kind: "service_role", via: "remote" } });
  assertEquals(calls, ["HEAD https://example.supabase.co/rest/v1/observation_sources?select=id&limit=1"]);
  const refused = await authenticateWriter(req({ Authorization: "Bearer sb_secret_test_guess_01" }), { deps: deps() });
  assertEquals(refused, { ok: false, status: 401, reason: "secret key rejected by the platform" });
});

Deno.test("the publishable key → 401, even signed into both headers", async () => {
  const v = await authenticateWriter(req({ Authorization: `Bearer ${PUBLISHABLE_KEY}`, apikey: PUBLISHABLE_KEY }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "not a secret key" });
});

// ── legacy credentials: never accepted ──────────────────────────────────────────

Deno.test("the legacy service JWT, byte-equal to SERVICE_ROLE_KEY in the env → refused, and the platform is not asked", async () => {
  const calls: string[] = [];
  const v = await authenticateWriter(req({ Authorization: `Bearer ${LEGACY_SERVICE_JWT}` }), {
    deps: deps({ fetch: platformAccepting(LEGACY_SERVICE_JWT, calls) }),
  });
  assertEquals(v, { ok: false, status: 401, reason: "HS256 token: the legacy JWT secret is revoked" });
  assertEquals(calls, []);
});

Deno.test("a service JWT signed with the legacy secret, which sits in JWT_SIGNING_SECRET → refused", async () => {
  const forged = await hs256({ role: "service_role", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${forged}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "HS256 token: the legacy JWT secret is revoked" });
});

Deno.test("an HS256 user token → refused without asking GoTrue", async () => {
  const user = await hs256({ role: "authenticated", sub: "u-remote", exp: NOW + 3600 });
  const calls: string[] = [];
  const gotrue = ((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({ id: "u-remote" }), { status: 200 }));
  }) as typeof fetch;
  const v = await authenticateWriter(req({ Authorization: `Bearer ${user}` }), { deps: deps({ fetch: gotrue }) });
  assertEquals(v, { ok: false, status: 401, reason: "HS256 token: the legacy JWT secret is revoked" });
  assertEquals(calls, []);
});

Deno.test("SERVICE_ROLE_KEY is never read: an opaque value there is not a key this guard holds", async () => {
  const env = { ...baseEnv, SERVICE_ROLE_KEY: "sb_secret_test_deleted_01" };
  const v = await authenticateWriter(req({ Authorization: "Bearer sb_secret_test_deleted_01" }), { deps: deps({ env }) });
  assertEquals(v, { ok: false, status: 401, reason: "secret key rejected by the platform" });
});

Deno.test("the public anon JWT → 401 even with a valid signature", async () => {
  const anon = await hs256({ iss: "supabase", ref: "x", role: "anon", iat: NOW - 10, exp: NOW + 10_000 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${anon}`, apikey: anon }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "anon key" });
});

Deno.test("an ES256 user token the JWKS cannot check: GoTrue confirms → user via remote, with the publishable key", async () => {
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const user = await es256({ role: "authenticated", sub: "u-remote", exp: NOW + 3600 }, other.privateKey);
  const calls: string[] = [];
  const gotrue = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push(`${init?.method ?? "GET"} ${u} apikey=${headers.apikey}`);
    if (u.endsWith("/auth/v1/user") && headers.Authorization === `Bearer ${user}`) {
      return Promise.resolve(new Response(JSON.stringify({ id: "u-remote" }), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 401 }));
  }) as typeof fetch;
  const ok = await authenticateWriter(req({ Authorization: `Bearer ${user}` }), { deps: deps({ fetch: gotrue }) });
  assertEquals(ok, { ok: true, caller: { kind: "user", userId: "u-remote", via: "remote" } });
  assertEquals(calls, [`GET https://example.supabase.co/auth/v1/user apikey=${PUBLISHABLE_KEY}`]);
  const refused = await authenticateWriter(req({ Authorization: `Bearer ${user}` }), { deps: deps() });
  assertEquals(refused, { ok: false, status: 401, reason: "user token rejected by the platform" });
});

// ── decode ─────────────────────────────────────────────────────────────────────

Deno.test("expired user JWT → 401", async () => {
  const stale = await es256({ role: "authenticated", sub: "u", exp: NOW - 1 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${stale}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "token expired" });
});

Deno.test("user JWT without sub → 401", async () => {
  const nosub = await es256({ role: "authenticated", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${nosub}` }), { deps: deps() });
  assertEquals(v.ok, false);
});

Deno.test("garbage bearer → 401 'not a JWT'", async () => {
  const v = await authenticateWriter(req({ Authorization: "Bearer nope" }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "token is not a JWT" });
});

Deno.test("unknown role → 401", async () => {
  const odd = await es256({ role: "supabase_admin", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${odd}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "role 'supabase_admin' cannot write" });
});

// ── signatures against the project JWKS ─────────────────────────────────────────

Deno.test("the service JWT the gateway mints for a secret key (ES256) → service_role via jwt", async () => {
  const minted = await es256({ role: "service_role", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${minted}` }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "jwt" } });
});

Deno.test("a signed-in user's ES256 JWT → user with its sub", async () => {
  const user = await es256({ aud: "authenticated", role: "authenticated", sub: "user-123", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${user}`, apikey: PUBLISHABLE_KEY }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "user", userId: "user-123", via: "jwt" } });
});

Deno.test("an ES256 service JWT signed with another key → platform asked → 401", async () => {
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const forged = await es256({ role: "service_role", exp: NOW + 3600 }, other.privateKey);
  const v = await authenticateWriter(req({ Authorization: `Bearer ${forged}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "service token rejected by the platform" });
});

// ── the apikey header when the bearer is refused ─────────────────────────────────

Deno.test("refused bearer + a secret key on apikey → service_role from the apikey", async () => {
  const v = await authenticateWriter(req({ Authorization: `Bearer ${LEGACY_SERVICE_JWT}`, apikey: CRON_KEY }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "secret-key" } });
});

Deno.test("refused bearer + a user JWT on apikey → still refused: only a secret key counts there", async () => {
  const forged = await hs256({ role: "service_role", exp: NOW + 3600 });
  const user = await es256({ role: "authenticated", sub: "user-123", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${forged}`, apikey: user }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "HS256 token: the legacy JWT secret is revoked" });
});

// ── exceptions and helpers ─────────────────────────────────────────────────────

Deno.test("allowAnonymous exception lets a refused caller through, marked anonymous", async () => {
  const v = await authenticateWriter(req(), { deps: deps(), allowAnonymous: () => true });
  assertEquals(v, { ok: true, caller: { kind: "anonymous", via: "exception" } });
  const denied = await authenticateWriter(req(), { deps: deps(), allowAnonymous: () => false });
  assertEquals(denied.ok, false);
});

Deno.test("isServiceCaller: secret keys and minted service JWTs yes; users and legacy keys no", async () => {
  const minted = await es256({ role: "service_role", exp: NOW + 3600 });
  const user = await es256({ role: "authenticated", sub: "user-123", exp: NOW + 3600 });
  assertEquals(await isServiceCaller(req({ Authorization: `Bearer ${CRON_KEY}` }), { deps: deps() }), true);
  assertEquals(await isServiceCaller(req({ Authorization: `Bearer ${minted}` }), { deps: deps() }), true);
  assertEquals(await isServiceCaller(req({ Authorization: `Bearer ${user}` }), { deps: deps() }), false);
  assertEquals(await isServiceCaller(req({ Authorization: `Bearer ${LEGACY_SERVICE_JWT}` }), { deps: deps() }), false);
  assertEquals(await isServiceCaller(req(), { deps: deps() }), false);
});

Deno.test("decodeJwt rejects non-JWT shapes", () => {
  assertEquals(decodeJwt("a.b"), null);
  assertEquals(decodeJwt(""), null);
  assertEquals(decodeJwt("x.y.z"), null);
});

// ── requireOwnerOrService (2026-09-29) ─────────────────────────────────────────────
const OWNER = "0b9f107a-0000-4000-8000-000000000001";
const ownerLookup = (owner: string | null, status = 200, seen: string[] = []): typeof fetch => ((input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input);
  if (u.includes("/rest/v1/parent_company")) {
    seen.push(((init?.headers ?? {}) as Record<string, string>).apikey ?? "");
    return Promise.resolve(new Response(JSON.stringify(owner ? [{ owner_user_id: owner }] : []), { status }));
  }
  return Promise.resolve(new Response("", { status: 401 }));
}) as typeof fetch;

Deno.test("owner-only: a secret key passes", async () => {
  const res = await requireOwnerOrService(req({ authorization: `Bearer ${CRON_KEY}` }), { deps: deps({ fetch: ownerLookup(OWNER) }) });
  assertEquals(res, null);
});

Deno.test("owner-only: the owner's own sign-in passes; the lookup uses the injected secret key", async () => {
  const token = await es256({ role: "authenticated", sub: OWNER, exp: NOW + 600 });
  const seen: string[] = [];
  const res = await requireOwnerOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: ownerLookup(OWNER, 200, seen) }) });
  assertEquals(res, null);
  assertEquals(seen, [INJECTED_KEY]);
});

Deno.test("owner-only: any other signed-in user → 403", async () => {
  const token = await es256({ role: "authenticated", sub: "someone-else", exp: NOW + 600 });
  const res = await requireOwnerOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: ownerLookup(OWNER) }) });
  assertEquals(res?.status, 403);
  assertEquals((await res!.json()).reason, "owner only");
});

Deno.test("owner-only: owner lookup fails → the owner is refused too (fails closed)", async () => {
  const token = await es256({ role: "authenticated", sub: OWNER, exp: NOW + 600 });
  const res = await requireOwnerOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: ownerLookup(OWNER, 500) }) });
  assertEquals(res?.status, 403);
});

Deno.test("owner-only: no token → 403; OPTIONS → not judged", async () => {
  assertEquals((await requireOwnerOrService(req(), { deps: deps({ fetch: ownerLookup(OWNER) }) }))?.status, 403);
  assertEquals(await requireOwnerOrService(req({}, "OPTIONS"), { deps: deps() }), null);
});

// ── requireAdminOrService (2026-10-14) ─────────────────────────────────────────────
const ADMIN = "0b9f107a-0000-4000-8000-0000000000a1";
const adminLookup = (admins: string[], status = 200, seen: string[] = []): typeof fetch => ((input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input);
  if (u.includes("/rest/v1/admin_users")) {
    seen.push(((init?.headers ?? {}) as Record<string, string>).apikey ?? "");
    const id = new URL(u).searchParams.get("user_id")?.replace(/^eq\./, "") ?? "";
    const active = new URL(u).searchParams.get("is_active") === "eq.true";
    return Promise.resolve(new Response(JSON.stringify(active && admins.includes(id) ? [{ user_id: id }] : []), { status }));
  }
  return Promise.resolve(new Response("", { status: 401 }));
}) as typeof fetch;

Deno.test("admin-only: a secret key passes without a lookup", async () => {
  const seen: string[] = [];
  const res = await requireAdminOrService(req({ authorization: `Bearer ${CRON_KEY}` }), { deps: deps({ fetch: adminLookup([], 200, seen) }) });
  assertEquals(res, null);
  assertEquals(seen, []);
});

Deno.test("admin-only: an active admin's sign-in passes; the lookup uses the injected secret key", async () => {
  const token = await es256({ role: "authenticated", sub: ADMIN, exp: NOW + 600 });
  const seen: string[] = [];
  const res = await requireAdminOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: adminLookup([ADMIN], 200, seen) }) });
  assertEquals(res, null);
  assertEquals(seen, [INJECTED_KEY]);
});

Deno.test("admin-only: any other signed-in user, an anonymous sign-in included → 403", async () => {
  for (const extra of [{}, { is_anonymous: true }]) {
    const token = await es256({ role: "authenticated", sub: "0b9f107a-0000-4000-8000-0000000000f9", exp: NOW + 600, ...extra });
    const res = await requireAdminOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: adminLookup([ADMIN]) }) });
    assertEquals(res?.status, 403);
    assertEquals((await res!.json()).reason, "admins only");
  }
});

Deno.test("admin-only: admin lookup fails → the admin is refused too (fails closed)", async () => {
  const token = await es256({ role: "authenticated", sub: ADMIN, exp: NOW + 600 });
  const res = await requireAdminOrService(req({ authorization: `Bearer ${token}` }), { deps: deps({ fetch: adminLookup([ADMIN], 500) }) });
  assertEquals(res?.status, 403);
});

Deno.test("admin-only: no token or the publishable key → 403; OPTIONS → not judged", async () => {
  assertEquals((await requireAdminOrService(req(), { deps: deps({ fetch: adminLookup([ADMIN]) }) }))?.status, 403);
  assertEquals((await requireAdminOrService(req({ authorization: `Bearer ${PUBLISHABLE_KEY}` }), { deps: deps({ fetch: adminLookup([ADMIN]) }) }))?.status, 403);
  assertEquals(await requireAdminOrService(req({}, "OPTIONS"), { deps: deps() }), null);
});

// ── supabaseKeys: which key a function sends, which keys it accepts ──────────────────
const envOf = (e: Record<string, string>) => (n: string) => e[n];

Deno.test("projectSecretKey: a `functions` key first, then the platform's secret key, then `default`", () => {
  const named = (keys: Record<string, string>) => JSON.stringify(keys);
  assertEquals(projectSecretKey(envOf({ ...baseEnv, SUPABASE_SECRET_KEYS: named({ default: DEFAULT_KEY, functions: "sb_secret_test_functions_01" }) })),
    "sb_secret_test_functions_01");
  assertEquals(projectSecretKey(envOf(baseEnv)), INJECTED_KEY);
  assertEquals(projectSecretKey(envOf({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_JWT })), DEFAULT_KEY);
  assertEquals(projectSecretKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_JWT })), LEGACY_SERVICE_JWT);
  // The deleted user-set secret is never a fallback.
  assertEquals(projectSecretKey(envOf({ SERVICE_ROLE_KEY: "sb_secret_test_deleted_01" })), undefined);
});

Deno.test("knownSecretKeys: every named secret key and the platform's secret key; never a JWT or SERVICE_ROLE_KEY", () => {
  assertEquals(knownSecretKeys(envOf(baseEnv)).sort(), [CRON_KEY, DEFAULT_KEY, INJECTED_KEY].sort());
  assertEquals(knownSecretKeys(envOf({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE_JWT })).sort(), [CRON_KEY, DEFAULT_KEY].sort());
  assertEquals(knownSecretKeys(envOf({ SERVICE_ROLE_KEY: "sb_secret_test_deleted_01" })), []);
});

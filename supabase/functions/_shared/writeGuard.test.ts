/**
 * writeGuard unit tests — run with:
 *   deno test --allow-env --allow-net supabase/functions/_shared/writeGuard.test.ts
 * (--allow-net only so esm.sh imports resolve; every remote call below is a stub.)
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authenticateWriter, decodeJwt, requireWriteAuth, type WriteGuardDeps } from "./writeGuard.ts";

const SECRET = "test-jwt-secret-that-is-long-enough-for-hmac";
const SERVICE_KEY_IN_ENV = "service-key-string-as-injected-by-the-platform";
const NOW = 1_800_000_000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function hs256(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const input = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

const baseEnv: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY_IN_ENV,
  SUPABASE_ANON_KEY: "anon-key-for-apikey-header",
  JWT_SIGNING_SECRET: SECRET,
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
    // Default stub: the platform rejects everything, so only local judgement can pass.
    fetch: overrides.fetch ?? (() => Promise.resolve(new Response("", { status: 401 }))),
  };
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

Deno.test("service key byte-equal to env → service_role via env-match", async () => {
  const v = await authenticateWriter(req({ Authorization: `Bearer ${SERVICE_KEY_IN_ENV}` }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "env-match" } });
});

Deno.test("service key in the apikey header only → allowed", async () => {
  const v = await authenticateWriter(req({ apikey: SERVICE_KEY_IN_ENV }), { deps: deps() });
  assertEquals(v.ok, true);
});

Deno.test("the public anon JWT → 401 even with a valid signature", async () => {
  const anon = await hs256({ iss: "supabase", ref: "x", role: "anon", iat: NOW - 10, exp: NOW + 10_000 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${anon}`, apikey: anon }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "anon key" });
});

Deno.test("service_role JWT that differs from env but is signed by the project secret → allowed via jwt", async () => {
  const svc = await hs256({ iss: "supabase", ref: "x", role: "service_role", iat: NOW - 10, exp: NOW + 10_000 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${svc}` }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "jwt" } });
});

Deno.test("signed-in user JWT → user with its sub", async () => {
  const user = await hs256({ aud: "authenticated", role: "authenticated", sub: "user-123", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${user}` }), { deps: deps() });
  assertEquals(v, { ok: true, caller: { kind: "user", userId: "user-123", via: "jwt" } });
});

Deno.test("forged service_role JWT (wrong secret) → platform asked → 401", async () => {
  const forged = await hs256({ role: "service_role", exp: NOW + 3600 }, "not-the-secret");
  const v = await authenticateWriter(req({ Authorization: `Bearer ${forged}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "service token rejected by the platform" });
});

Deno.test("expired user JWT → 401", async () => {
  const stale = await hs256({ role: "authenticated", sub: "u", exp: NOW - 1 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${stale}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "token expired" });
});

Deno.test("user JWT without sub → 401", async () => {
  const nosub = await hs256({ role: "authenticated", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${nosub}` }), { deps: deps() });
  assertEquals(v.ok, false);
});

Deno.test("garbage bearer → 401 'not a JWT'", async () => {
  const v = await authenticateWriter(req({ Authorization: "Bearer nope" }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "token is not a JWT" });
});

Deno.test("unknown role → 401", async () => {
  const odd = await hs256({ role: "supabase_admin", exp: NOW + 3600 });
  const v = await authenticateWriter(req({ Authorization: `Bearer ${odd}` }), { deps: deps() });
  assertEquals(v, { ok: false, status: 401, reason: "role 'supabase_admin' cannot write" });
});

Deno.test("no local secret: user token confirmed by GoTrue → allowed via remote", async () => {
  const env = { ...baseEnv };
  delete env.JWT_SIGNING_SECRET;
  const user = await hs256({ role: "authenticated", sub: "u-remote", exp: NOW + 3600 });
  const calls: string[] = [];
  const fetchStub = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.endsWith("/auth/v1/user") && (init?.headers as Record<string, string>)?.Authorization === `Bearer ${user}`) {
      return Promise.resolve(new Response(JSON.stringify({ id: "u-remote" }), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 401 }));
  }) as typeof fetch;
  const v = await authenticateWriter(req({ Authorization: `Bearer ${user}` }), { deps: deps({ env, fetch: fetchStub }) });
  assertEquals(v, { ok: true, caller: { kind: "user", userId: "u-remote", via: "remote" } });
  assertEquals(calls, ["GET https://example.supabase.co/auth/v1/user"]);
});

Deno.test("no local secret: service token confirmed by PostgREST HEAD → allowed via remote", async () => {
  const env = { ...baseEnv };
  delete env.JWT_SIGNING_SECRET;
  const svc = await hs256({ role: "service_role", exp: NOW + 3600 });
  const fetchStub = ((url: string | URL | Request, init?: RequestInit) => {
    const ok = String(url).includes("/rest/v1/observation_sources") && init?.method === "HEAD";
    return Promise.resolve(new Response("", { status: ok ? 200 : 401 }));
  }) as typeof fetch;
  const v = await authenticateWriter(req({ Authorization: `Bearer ${svc}` }), { deps: deps({ env, fetch: fetchStub }) });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "remote" } });
});

Deno.test("ES256 token verified against JWKS from env → allowed via jwt", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: "k1" })}.${enc({ role: "service_role", exp: NOW + 3600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(input)));
  const token = `${input}.${b64url(sig)}`;
  const env = { ...baseEnv, SUPABASE_JWKS: JSON.stringify({ keys: [{ ...pub, kid: "k1", alg: "ES256", use: "sig" }] }) };
  const v = await authenticateWriter(req({ Authorization: `Bearer ${token}` }), { deps: deps({ env }) });
  assertEquals(v, { ok: true, caller: { kind: "service_role", via: "jwt" } });
});

Deno.test("allowAnonymous exception lets a refused caller through, marked anonymous", async () => {
  const v = await authenticateWriter(req(), { deps: deps(), allowAnonymous: () => true });
  assertEquals(v, { ok: true, caller: { kind: "anonymous", via: "exception" } });
  const denied = await authenticateWriter(req(), { deps: deps(), allowAnonymous: () => false });
  assertEquals(denied.ok, false);
});

Deno.test("decodeJwt rejects non-JWT shapes", () => {
  assertEquals(decodeJwt("a.b"), null);
  assertEquals(decodeJwt(""), null);
  assertEquals(decodeJwt("x.y.z"), null);
});

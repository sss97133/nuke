/**
 * deal-jacket-pipeline caller tests — run with:
 *   deno test --node-modules-dir=none --allow-env --allow-read supabase/functions/deal-jacket-pipeline/handler.test.ts
 *
 * A signed-in stranger can neither move someone else's photo nor file one onto someone else's car: both are refused
 * with 403 before the function reads the body or makes any database or function call. The service key passes, and its
 * photo move goes through relink_testimony (the sanctioned mover), never a raw vehicle_images.vehicle_id update.
 * Every key and id below is a disposable test string; every remote call is a stub.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SECRET = "sb_secret_test_dj_01";
const OWNER = "0b9f107a-0000-4000-8000-0000000000a1";
const STRANGER = "0b9f107a-0000-4000-8000-0000000000f3";
const IMAGE = "11111111-0000-4000-8000-000000000001"; // someone else's photo
const CAR = "22222222-0000-4000-8000-000000000002"; // someone else's car
const NOW = Math.floor(Date.now() / 1000);

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
async function userToken(sub: string): Promise<string> {
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: "k1" })}.${enc({ role: "authenticated", sub, exp: NOW + 600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SECRET);
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: SECRET }));
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_test_dj_01" }));
Deno.env.set(
  "SUPABASE_JWKS",
  JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] }),
);

/** Records every outbound call; answers like the platform would for this flow. */
const calls: string[] = [];
const patchBodies: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const u = new URL(url);
  calls.push(`${method} ${u.pathname}`);
  if (method === "PATCH" && u.pathname === "/rest/v1/vehicle_images") patchBodies.push(String(init?.body ?? ""));
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (u.pathname === "/rest/v1/parent_company") return json([{ owner_user_id: OWNER }]);
  if (u.pathname === "/functions/v1/forensic-deal-jacket") return json({ forensic_summary: { trust: 1 } });
  if (u.pathname === "/rest/v1/vehicles" && method === "GET") return json([{ id: CAR }]);
  if (u.pathname === "/rest/v1/rpc/relink_testimony") return json(null);
  return json([]);
}) as typeof fetch;

const { handler } = await import("./index.ts");

const writes = () => calls.filter((c) => !c.startsWith("GET /rest/v1/parent_company"));

function post(body: unknown, auth: string): Request {
  return new Request("https://example.supabase.co/functions/v1/deal-jacket-pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const extraction = { vehicle: { year: 1973, make: "Pontiac", model: "Firebird", vin: "2U87X3N100001" } };

Deno.test("stranger moves another user's photo (manual, no vehicle_id, VIN text) → 403, nothing called", async () => {
  calls.length = 0;
  const res = await handler(post({ mode: "manual", image_id: IMAGE, extraction }, await userToken(STRANGER)));
  assertEquals(res.status, 403);
  assertEquals(writes(), []);
});

Deno.test("stranger files a photo onto another user's car (manual with vehicle_id; process) → 403, nothing called", async () => {
  for (const body of [{ mode: "manual", image_id: IMAGE, vehicle_id: CAR, extraction }, { mode: "process", image_id: IMAGE, vehicle_id: CAR }, { mode: "scan" }]) {
    calls.length = 0;
    const res = await handler(post(body, await userToken(STRANGER)));
    assertEquals(res.status, 403, JSON.stringify(body));
    assertEquals(writes(), []);
  }
});

Deno.test("no token → 401, nothing called", async () => {
  calls.length = 0;
  const res = await handler(new Request("https://example.supabase.co/functions/v1/deal-jacket-pipeline", { method: "POST", body: "{}" }));
  assertEquals(res.status, 401);
  assertEquals(calls, []);
});

Deno.test("service key, manual, VIN match → the move goes through relink_testimony, never a raw vehicle_id update", async () => {
  calls.length = 0;
  patchBodies.length = 0;
  const res = await handler(post({ mode: "manual", image_id: IMAGE, extraction }, SECRET));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.vehicle_id, CAR);
  assertEquals(out.vehicle_linked, true);
  assert(calls.includes("POST /rest/v1/rpc/relink_testimony"), calls.join("\n"));
  assert(calls.includes("POST /functions/v1/forensic-deal-jacket"), calls.join("\n"));
  // The one vehicle_images PATCH left is the components flag; none carries vehicle_id.
  assertEquals(patchBodies.length, 1);
  assert(!patchBodies.some((b) => b.includes("vehicle_id")), patchBodies.join("\n"));
});

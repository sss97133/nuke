// DRAFT — NOT DEPLOYED. Do not move into supabase/functions without Skylar's approval.
//
// garage-join — the public face of a garage join link for a browser, not the app. A person without the app opens
// https://nuke.ag/join/<token>; the web page calls GET .../garage-join?token=<token> to say "Fixture shop invites you
// as a technician" (or why the link no longer works) and offers the App Store. The app itself does NOT use this
// function: it calls the RPCs directly with the user's session (preview_garage_join_link is anon-callable).
//
// Reads only: it calls preview_garage_join_link with the PUBLISHABLE key, so the database decides what is private
// (nothing beyond garage name, role and validity). It writes nothing, so there is no requireWriteAuth; the
// check-write-guard guardrail only demands it of functions that write. It never sees a user's session.
//
// Abuse: tokens carry 244 random bits, so guessing is not the risk; the risk is load and probing. A per-IP window
// (in memory, per isolate; a floor, not a global limit) answers 429. The response never says more than the RPC does,
// and a wrong token and a malformed one answer the same.
//
// Env: SUPABASE_URL and the project publishable key (_shared/supabaseKeys.ts projectPublishableKey).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { projectPublishableKey } from "../_shared/supabaseKeys.ts";

const headers = { ...corsHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { n: number; t: number }>();

function limited(ip: string, now = Date.now()): boolean {
  const h = hits.get(ip);
  if (!h || now - h.t > WINDOW_MS) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n += 1;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > WINDOW_MS) hits.delete(k);
  return h.n > MAX_PER_WINDOW;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (limited(ip)) return json(429, { error: "rate_limited" });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  // Same answer as the RPC gives for an unknown token, without a database round trip.
  if (!TOKEN_RE.test(token)) return json(200, { garage_name: null, role: null, valid: false, reason: "not_found" });

  const key = projectPublishableKey();
  if (!key) return json(503, { error: "not_configured" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("preview_garage_join_link", { p_token: token });
  if (error) {
    // PGRST202 = the migration is not applied yet. Say so plainly; never fake a preview.
    if (error.code === "PGRST202") return json(503, { error: "garage_invites_not_available" });
    console.error("garage-join preview failed", error.code);
    return json(502, { error: "preview_failed" });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json(200, { garage_name: null, role: null, valid: false, reason: "not_found" });
  // Whitelist the four fields; whatever the RPC grows later does not leak through this door.
  return json(200, { garage_name: row.garage_name ?? null, role: row.role ?? null, valid: row.valid === true, reason: row.reason ?? "not_found" });
});

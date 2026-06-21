/**
 * connect-claude — the "Connect Claude" button backend.
 *
 * Nuke as an OAuth *client* to Anthropic: a signed-in Nuke user links their Claude
 * Max/Pro subscription so Nuke can run their analysis on their own plan. The
 * subscription→429→slow-or-upgrade funnel lives in
 * `_shared/claudeSubscriptionAuth.ts`; this function is just the HTTP surface.
 *
 * Routes (path-dispatched, mounted at /functions/v1/connect-claude):
 *   POST /start    → { authorize_url, state }   (browser opens authorize_url)
 *   POST /complete → { ok }                      body: { state, code }
 *   GET  /status   → { connected, expires_at, source }
 *   POST /disconnect → { ok }
 *
 * AUTH: the caller must present a Nuke user JWT (validated via supabase.auth.getUser),
 * so the linked subscription is bound to the right user. This is per-user account
 * linking — auth-sensitive by definition; do not relax the JWT check.
 *
 * ⚠️ Built on Anthropic's unsanctioned first-party OAuth client — see the warning
 * block in _shared/claudeSubscriptionAuth.ts before deploying.
 *
 * @owner external-agent-write-api
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  randomVerifier,
  challengeFromVerifier,
  buildAuthorizeUrl,
  exchangeCode,
  storeSubscriptionToken,
} from "../_shared/claudeSubscriptionAuth.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Resolve the calling user from their Nuke JWT. */
async function requireUser(req: Request, supabase: any): Promise<string | null> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id ?? null;
}

// PKCE verifiers are short-lived server state keyed by `state`. We stash them in
// oauth_login_sessions (already exists for oauth-server) to avoid minting a table:
// session_id=state, code_challenge=verifier, client_id sentinel marks our flow.
const FLOW_MARKER = "connect-claude";
const VERIFIER_TTL_SECONDS = 60 * 15;

async function stashVerifier(supabase: any, userId: string, state: string, verifier: string) {
  const { error } = await supabase.from("oauth_login_sessions").insert({
    session_id: state,
    client_id: FLOW_MARKER,
    redirect_uri: FLOW_MARKER,
    code_challenge: verifier,
    code_challenge_method: "S256",
    user_id: userId,
    email: "",
    expires_at: new Date(Date.now() + VERIFIER_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(`stash verifier: ${error.message}`);
}

async function popVerifier(supabase: any, userId: string, state: string): Promise<string | null> {
  const { data } = await supabase.from("oauth_login_sessions")
    .select("code_challenge, user_id, expires_at, completed_at")
    .eq("session_id", state)
    .eq("client_id", FLOW_MARKER)
    .maybeSingle();
  if (!data || data.completed_at) return null;
  if (data.user_id !== userId) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  await supabase.from("oauth_login_sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("session_id", state);
  return data.code_challenge as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/functions\/v1\/connect-claude/, "").replace(/\/$/, "") || "/";
  const supabase = svc();

  try {
    const userId = await requireUser(req, supabase);
    if (!userId) return json({ error: "unauthorized", error_description: "valid Nuke JWT required" }, 401);

    if (route === "/start" && req.method === "POST") {
      const verifier = randomVerifier();
      const challenge = await challengeFromVerifier(verifier);
      const state = randomVerifier(16);
      await stashVerifier(supabase, userId, state, verifier);
      return json({ authorize_url: buildAuthorizeUrl(state, challenge), state });
    }

    if (route === "/complete" && req.method === "POST") {
      const { state, code } = await req.json().catch(() => ({}));
      if (!state || !code) return json({ error: "invalid_request", error_description: "state and code required" }, 400);
      const verifier = await popVerifier(supabase, userId, String(state));
      if (!verifier) return json({ error: "invalid_grant", error_description: "unknown/expired state" }, 400);
      const bundle = await exchangeCode(String(code), verifier);
      await storeSubscriptionToken(supabase, userId, bundle);
      return json({ ok: true, expires_at: bundle.expires_at, scope: bundle.scope });
    }

    if (route === "/status" && (req.method === "GET" || req.method === "POST")) {
      const { data } = await supabase.from("user_ai_providers")
        .select("api_key_encrypted, is_active")
        .eq("user_id", userId)
        .eq("provider", "anthropic_subscription")
        .eq("is_active", true)
        .maybeSingle();
      if (!data?.api_key_encrypted) return json({ connected: false });
      let expires_at: number | null = null;
      try { expires_at = JSON.parse(atob(data.api_key_encrypted)).expires_at ?? null; } catch { /* ignore */ }
      return json({ connected: true, expires_at, source: "subscription" });
    }

    if (route === "/disconnect" && req.method === "POST") {
      await supabase.from("user_ai_providers")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("provider", "anthropic_subscription");
      return json({ ok: true });
    }

    return json({ error: "not_found", path: route }, 404);
  } catch (e) {
    console.error("[connect-claude] handler error:", e);
    return json({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);
  }
});

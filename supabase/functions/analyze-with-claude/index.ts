/**
 * analyze-with-claude — the user-facing entrypoint that runs analysis on the
 * USER'S own Claude, through the subscription→API funnel.
 *
 * This is the consumer the web settings card and the iOS app both call. It's the
 * one genuinely new piece: every other Claude-calling function is a service-role
 * batch job on the SYSTEM key (no user to bill). This one carries a user JWT,
 * resolves their identity, and runs through `runWithChain`:
 *
 *   their subscription → 429 → slow-down (caller retries) OR upgrade to API
 *   (their own key = their bill; platform key = debited from their prepaid credits)
 *
 * Net function count: adding this retires `imessage-router` (archived, superseded
 * by the local `imessage-bridge.mjs` — see TOOLS.md "Archived").
 *
 * Request (POST, user JWT required):
 *   { vehicle_id?: uuid, prompt: string, mode?: "slow"|"upgrade",
 *     model?: string, max_tokens?: number }
 * Response:
 *   { ok, source, text, chargedCents?, needsFunding?, rateLimited?, retryAfterSeconds? }
 *
 * @owner external-agent-write-api
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { runWithChain } from "../_shared/claudeSubscriptionAuth.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const DEFAULT_MODEL = "claude-opus-4-8";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Resolve the user from their Nuke JWT — this is whose subscription/credits run.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id ?? null;
  if (!userId) return json({ error: "unauthorized", error_description: "valid Nuke JWT required" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const userPrompt = String(body.prompt ?? "").trim();
  if (!userPrompt) return json({ error: "invalid_request", error_description: "prompt required" }, 400);

  const mode: "slow" | "upgrade" = body.mode === "upgrade" ? "upgrade" : "slow";
  const model = String(body.model ?? DEFAULT_MODEL);
  const maxTokens = Math.min(Number(body.max_tokens ?? 1024), 8192);

  // Ground the prompt in real vehicle data when a vehicle_id is given (facts-are-
  // sacred: we pass the stored row, we don't invent specs).
  let context = "";
  if (body.vehicle_id) {
    const { data: v } = await supabase
      .from("vehicles")
      .select("year, make, model, vin, mileage, engine, transmission, exterior_color")
      .eq("id", body.vehicle_id)
      .maybeSingle();
    if (v) {
      context = `Vehicle on record: ${JSON.stringify(v)}\n\n`;
    }
  }

  const payload = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: `${context}${userPrompt}` }],
  };

  try {
    const result = await runWithChain(supabase, userId, payload, { mode });

    if (result.needsFunding) {
      return json({
        ok: false,
        needsFunding: true,
        error: "insufficient_credits",
        error_description: "Your Claude plan is rate-limited and your prepaid balance can't cover an API upgrade. Add funds or retry later.",
        retryAfterSeconds: result.retryAfterSeconds,
      }, 402);
    }

    if (result.rateLimited && result.source === "subscription") {
      // Slow-down path: the caller decides whether to back off and retry.
      return json({
        ok: false,
        rateLimited: true,
        source: result.source,
        retryAfterSeconds: result.retryAfterSeconds,
        error_description: "Your Claude plan is rate-limited. Retry shortly, or re-run with mode='upgrade' to run on the API now.",
      }, 429);
    }

    if (!result.ok) {
      return json({ ok: false, source: result.source, status: result.status, body: result.body }, 502);
    }

    // Pull the text out of the Anthropic messages response.
    const text = Array.isArray(result.body?.content)
      ? result.body.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
      : "";

    return json({
      ok: true,
      source: result.source,                 // subscription | user_api_key | system_api_key
      text,
      chargedCents: result.chargedCents ?? 0, // > 0 only when platform key billed credits
    });
  } catch (e) {
    console.error("[analyze-with-claude] error:", e instanceof Error ? e.message : e);
    return json({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);
  }
});

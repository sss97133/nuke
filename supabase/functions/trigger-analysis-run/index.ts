/**
 * Trigger Analysis Run
 *
 * Fires the BYOK analysis drain from the app UI — so a user analyzes their own
 * vehicles with one click instead of opening the GitHub Actions tab.
 *
 * POST /functions/v1/trigger-analysis-run
 *   { minutes?: number, batch?: number, vehicle_id?: uuid }  // model from user settings
 *
 * vehicle_id (optional): analyze just that one vehicle — this is what the per-image
 * "Analyze" button targets. We verify the caller actually has images on that vehicle
 * before dispatching, so a user can only ever target their own data.
 *
 * The run is ALWAYS scoped to the authenticated user's own id — a caller can never
 * dispatch analysis for someone else's vehicles. It dispatches the existing
 * `byok-analysis-drain.yml` workflow via GitHub's workflow_dispatch API; that
 * workflow then resolves THIS user's chosen compute (nuke_hosted / subscription /
 * api key) through the broker, exactly like the scheduled run.
 *
 * SECRET REQUIRED: GITHUB_DISPATCH_TOKEN — a fine-grained PAT (or GitHub App token)
 * with `actions: write` on sss97133/nuke. Without it the function returns a clear
 * 503 instead of silently doing nothing.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REPO = "sss97133/nuke";
const WORKFLOW = "byok-analysis-drain.yml";
const REF = "main";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticate — the run is scoped to THIS user only.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Authentication required" });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json(401, { error: "Invalid authentication" });

    const ghToken = Deno.env.get("GITHUB_DISPATCH_TOKEN");
    if (!ghToken) {
      return json(503, {
        error:
          "On-demand analysis isn't wired up yet: set the GITHUB_DISPATCH_TOKEN secret " +
          "(a PAT with actions:write on " + REPO + "). The hourly schedule still runs without it.",
      });
    }

    // Clamp the budget so a button press can't launch an enormous run.
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Math.max(Number(body.batch) || 8, 1), 20);

    // Optional single-vehicle target (the per-image button). Verify ownership: the caller
    // must actually have images on that vehicle, else they could analyze someone else's.
    let vehicleId: string | null = null;
    if (body.vehicle_id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.vehicle_id))) {
        return json(400, { error: "vehicle_id is not a valid uuid" });
      }
      const { count, error: ce } = await supabase
        .from("vehicle_images")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", body.vehicle_id)
        .eq("user_id", user.id);
      if (ce) return json(500, { error: "ownership check failed: " + ce.message });
      if (!count) {
        return json(403, { error: "You don't have any images on that vehicle." });
      }
      vehicleId = String(body.vehicle_id);
    }
    // A targeted single-vehicle run is short; a fleet run gets the default budget.
    const minutes = Math.min(Math.max(Number(body.minutes) || (vehicleId ? 8 : 10), 1), 30);

    // Respect the user's stored settings: disabled => nothing to do; model passes through
    // the workflow input (the broker still overrides per-row, this is just the default).
    const { data: settings } = await supabase
      .from("user_analysis_settings")
      .select("enabled, model")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settings && settings.enabled === false) {
      return json(409, { error: "Analysis is turned off in your settings. Enable it first." });
    }

    const inputs: Record<string, string> = {
      user_id: user.id,
      minutes: String(minutes),
      batch: String(batch),
    };
    if (settings?.model) inputs.model = settings.model;
    if (vehicleId) inputs.vehicle_id = vehicleId;

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: REF, inputs }),
      },
    );

    if (res.status === 204) {
      return json(202, {
        ok: true,
        scope: vehicleId ? "vehicle" : "fleet",
        message: vehicleId
          ? "Analysis dispatched for this vehicle — it runs in the cloud, check back shortly."
          : "Analysis run dispatched. It runs in the cloud — check back on your vehicles shortly.",
      });
    }

    const detail = await res.text().catch(() => "");
    return json(502, {
      error: "GitHub rejected the dispatch",
      status: res.status,
      detail: detail.slice(0, 400),
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unexpected error" });
  }
});

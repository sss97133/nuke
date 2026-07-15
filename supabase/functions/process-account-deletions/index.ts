/**
 * PROCESS ACCOUNT DELETIONS — drains account_deletion_requests
 *
 * Companion worker for request_account_deletion() (App Store 5.1.1(v)
 * in-app account deletion). The RPC anonymizes the profiles row and
 * enqueues a 'pending' row; auth.users cannot be safely touched from SQL,
 * so this function (service role) finishes the job:
 *
 *   1. SELECT pending rows from account_deletion_requests
 *   2. For each: supabase.auth.admin.updateUserById(user_id,
 *      { ban_duration: '876000h' })  — ~100 years; sign-in disabled
 *   3. Mark the row processed (processed_at = now())
 *
 * Testimony (vehicle_images / vehicle_observations / vehicle_events) is
 * NEVER deleted — account deletion anonymizes identity, never substrate.
 *
 * Invocation: cron (10-15 min cadence is fine) or manual. Deployed with
 * --no-verify-jwt, so it gates itself: the bearer token must be the
 * service role key.
 *
 * POST /functions/v1/process-account-deletions
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 50;
const BAN_DURATION = "876000h"; // ~100 years

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: "Supabase env vars not configured" });
  }

  // Deployed --no-verify-jwt: require a service-grade key. This function
  // bans auth users — it must never be callable with anon/user tokens.
  // Exact match against the runtime-injected key is brittle across key
  // rotations/formats (legacy JWT vs sb_secret_*), so fall back to a
  // capability check: only a real service key can call the GoTrue admin API
  // (GoTrue verifies the signature server-side; a forged unsigned
  // role=service_role JWT fails).
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  if (bearer !== serviceKey) {
    const callerClient = createClient(supabaseUrl, bearer, {
      auth: { persistSession: false },
    });
    const { error: gateErr } = await callerClient.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (gateErr) {
      return json(401, { ok: false, error: "Unauthorized" });
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: pending, error: selErr } = await supabase
    .from("account_deletion_requests")
    .select("id, user_id, requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (selErr) {
    return json(500, { ok: false, error: `select failed: ${selErr.message}` });
  }

  const results: Array<{ user_id: string; ok: boolean; error?: string }> = [];

  for (const row of pending ?? []) {
    try {
      const { error: banErr } = await supabase.auth.admin.updateUserById(
        row.user_id,
        { ban_duration: BAN_DURATION },
      );

      if (banErr) {
        // Auth user already gone = nothing to ban; treat as processed.
        const userGone = /not.?found/i.test(banErr.message);
        if (!userGone) {
          console.error(`ban failed for ${row.user_id}: ${banErr.message}`);
          results.push({ user_id: row.user_id, ok: false, error: banErr.message });
          continue; // stays 'pending' — retried next run
        }
      }

      const { error: updErr } = await supabase
        .from("account_deletion_requests")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", row.id);

      if (updErr) {
        console.error(`mark-processed failed for ${row.user_id}: ${updErr.message}`);
        results.push({ user_id: row.user_id, ok: false, error: updErr.message });
        continue;
      }

      results.push({ user_id: row.user_id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`unexpected error for ${row.user_id}: ${msg}`);
      results.push({ user_id: row.user_id, ok: false, error: msg });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const failed = results.length - processed;

  return json(200, {
    ok: true,
    pending_found: pending?.length ?? 0,
    processed,
    failed,
    results,
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

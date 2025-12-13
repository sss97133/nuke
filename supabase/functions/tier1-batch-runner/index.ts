/**
 * Tier1 Batch Runner (Small Batches)
 * - Cloud-only: runs inside Supabase Edge Functions.
 * - Pulls a tiny batch (default 2) of pending images and invokes analyze-image (vision).
 * - Uses service role key from env.
 */

import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 5; // higher batch for faster drain
const PACE_MS = 250; // tighter pacing; relies on single retry
const LOOKBACK_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const envServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? Deno.env.get("SERVICE_ROLE_KEY");
    const envAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
      ?? Deno.env.get("ANON_KEY");

    const serviceRoleKey = (envServiceRoleKey && envServiceRoleKey.length > 60)
      ? envServiceRoleKey
      : undefined;
    const anonKey = (envAnonKey && envAnonKey.length > 60)
      ? envAnonKey
      : undefined;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
      ?? Deno.env.get("PROJECT_URL")
      ?? Deno.env.get("URL");
    if (!serviceRoleKey || !supabaseUrl) {
      return new Response(JSON.stringify({ error: "Missing service role key or SUPABASE_URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Fetch small batch of pending images
    const { data: rows, error: listError } = await supabase
      .from("vehicle_images")
      .select("id,image_url,vehicle_id,user_id")
      .or("ai_processing_status.is.null,ai_processing_status.not.in.(complete,duplicate_skipped)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (listError) {
      return new Response(JSON.stringify({ error: "List failed", message: listError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let success = 0;
    const failures: Array<{ id: string; status: number; body: string }> = [];

    for (const row of rows ?? []) {
      const body = {
        image_url: row.image_url,
        image_id: row.id,
        vehicle_id: row.vehicle_id,
        user_id: row.user_id,
      };

      const fnKey = anonKey || serviceRoleKey;
      const callOnce = async () =>
        await fetch(`${supabaseUrl}/functions/v1/analyze-image`, {
          method: "POST",
          headers: {
            "apikey": fnKey,
            "Authorization": `Bearer ${fnKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

      let resp = await callOnce();
      if (resp.status >= 500 || resp.status === 546) {
        // Retry once on transient/worker limit with a longer backoff
        await new Promise((r) => setTimeout(r, resp.status === 546 ? 1200 : 400));
        resp = await callOnce();
      }

      if (resp.ok) {
        success += 1;
      } else {
        const txt = await resp.text();
        failures.push({ id: row.id, status: resp.status, body: txt.slice(0, 500) });
      }

      // Pace to avoid worker limits
      await new Promise((r) => setTimeout(r, PACE_MS));
    }

    return new Response(
      JSON.stringify({
        processed: rows.length,
        success,
        failures,
        envDebug: {
          hasServiceRoleKey: Boolean(serviceRoleKey),
          hasAnonKey: Boolean(anonKey),
          hasSupabaseUrl: Boolean(supabaseUrl),
          serviceRoleKeyLength: serviceRoleKey?.length ?? 0,
          anonKeyLength: anonKey?.length ?? 0,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error running batch:", err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


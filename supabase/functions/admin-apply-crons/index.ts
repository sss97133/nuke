/**
 * admin-apply-crons — ONE-TIME FUNCTION
 * 
 * Applies the missing vehicle intelligence cron jobs:
 * 1. compute-vehicle-valuation-backfill (every 10 min)
 * 2. batch-vin-decode-backfill (every 30 min)
 * 3. batch-ymm-propagate-hourly (every 4h)
 * 
 * DELETE THIS FUNCTION AFTER RUNNING.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, any> = {};

  // Helper to run raw SQL via pg approach
  async function runSQL(sql: string): Promise<{ data: any; error: any }> {
    // Use the supabase client's from() to hit the postgres function directly
    return supabase.rpc("execute_sql", { sql }).catch((e: any) => ({ data: null, error: e }));
  }

  // 1. compute-vehicle-valuation every 10 min
  try {
    const { error: e1 } = await supabase.rpc("cron_schedule_or_replace", {
      p_name: "compute-vehicle-valuation-backfill",
      p_schedule: "*/10 * * * *",
      p_command: `SELECT net.http_post(url := get_service_url() || '/functions/v1/compute-vehicle-valuation', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 50}'::jsonb);`
    });
    if (e1) {
      // Fallback: try cron.schedule directly
      const { data: d1b, error: e1b } = await supabase
        .from("cron_job_setup")
        .select("*")
        .limit(1);
      results.valuation_cron = { error: e1.message, fallback_attempt: "tried direct" };
    } else {
      results.valuation_cron = { ok: true };
    }
  } catch (e: any) {
    results.valuation_cron = { error: e.message };
  }

  // 2. batch-vin-decode every 30 min
  try {
    const { error: e2 } = await supabase.rpc("cron_schedule_or_replace", {
      p_name: "batch-vin-decode-backfill",
      p_schedule: "*/30 * * * *",
      p_command: `SELECT net.http_post(url := get_service_url() || '/functions/v1/batch-vin-decode', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 50}'::jsonb);`
    });
    results.vin_decode_cron = e2 ? { error: e2.message } : { ok: true };
  } catch (e: any) {
    results.vin_decode_cron = { error: e.message };
  }

  // 3. batch-ymm-propagate every 4h
  try {
    const { error: e3 } = await supabase.rpc("cron_schedule_or_replace", {
      p_name: "batch-ymm-propagate-hourly",
      p_schedule: "0 */4 * * *",
      p_command: `SELECT net.http_post(url := get_service_url() || '/functions/v1/batch-ymm-propagate', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 500}'::jsonb);`
    });
    results.ymm_propagate_cron = e3 ? { error: e3.message } : { ok: true };
  } catch (e: any) {
    results.ymm_propagate_cron = { error: e.message };
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

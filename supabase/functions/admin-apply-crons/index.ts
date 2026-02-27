/**
 * admin-apply-crons - Applies vehicle intelligence cron jobs
 * Uses pg_cron directly via Deno postgres connection
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const results: Record<string, any> = {};
  
  // We'll use a raw fetch to the supabase postgres REST endpoint
  // that supports schema=cron
  const pgRestUrl = supabaseUrl.replace('.supabase.co', '.supabase.co');
  
  async function cronSchedule(name: string, schedule: string, command: string) {
    // Use PostgREST with explicit schema header for cron schema
    const resp = await fetch(`${pgRestUrl}/rest/v1/rpc/cron_setup_job`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_name: name, p_schedule: schedule, p_command: command }),
    });
    const text = await resp.text();
    if (!resp.ok) return { error: text };
    return { ok: true, data: text };
  }

  // 1. compute-vehicle-valuation every 10 min
  const cmd1 = `SELECT net.http_post(url := get_service_url() || '/functions/v1/compute-vehicle-valuation', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 50}'::jsonb);`;
  results.valuation = await cronSchedule("compute-vehicle-valuation-backfill", "*/10 * * * *", cmd1);

  // 2. batch-vin-decode every 30 min
  const cmd2 = `SELECT net.http_post(url := get_service_url() || '/functions/v1/batch-vin-decode', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 50}'::jsonb);`;
  results.vin_decode = await cronSchedule("batch-vin-decode-backfill", "*/30 * * * *", cmd2);

  // 3. batch-ymm-propagate every 4h
  const cmd3 = `SELECT net.http_post(url := get_service_url() || '/functions/v1/batch-ymm-propagate', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '{"batch_size": 500}'::jsonb);`;
  results.ymm = await cronSchedule("batch-ymm-propagate-hourly", "0 */4 * * *", cmd3);

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

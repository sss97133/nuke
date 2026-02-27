/**
 * admin-apply-crons — ONE-TIME USE
 * Applies vehicle intelligence cron jobs via direct Postgres connection.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL")!;
  const results: Record<string, any> = {};

  try {
    const { Pool } = await import("https://deno.land/x/postgres@v0.17.0/mod.ts");

    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();

    const cronJobs = [
      {
        name: "compute-vehicle-valuation-backfill",
        schedule: "*/10 * * * *",
        func: "compute-vehicle-valuation",
        body: '{"batch_size": 50}',
      },
      {
        name: "batch-vin-decode-backfill",
        schedule: "*/30 * * * *",
        func: "batch-vin-decode",
        body: '{"batch_size": 50}',
      },
      {
        name: "batch-ymm-propagate-hourly",
        schedule: "0 */4 * * *",
        func: "batch-ymm-propagate",
        body: '{"batch_size": 500}',
      },
    ];

    for (const job of cronJobs) {
      const cmd = `SELECT net.http_post(url := get_service_url() || '/functions/v1/${job.func}', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '${job.body}'::jsonb);`;

      // Unschedule existing (ignore errors)
      await conn.queryArray(`
        DO $x$ BEGIN
          IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${job.name}') THEN
            PERFORM cron.unschedule('${job.name}');
          END IF;
        END $x$;
      `).catch((e: any) => console.log(`unschedule ${job.name}: ${e.message}`));

      // Schedule
      const r = await conn.queryArray(
        `SELECT cron.schedule($1, $2, $3)`,
        [job.name, job.schedule, cmd]
      );
      results[job.name] = { ok: true, jobid: r.rows[0]?.[0] };
      console.log(`Scheduled ${job.name}:`, results[job.name]);
    }

    conn.release();
    await pool.end();

  } catch (e: any) {
    results.error = e.message;
    console.error("Error:", e.message);
  }

  return new Response(JSON.stringify({ ok: !results.error, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

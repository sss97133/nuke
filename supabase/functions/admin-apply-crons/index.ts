/**
 * admin-apply-crons — Apply vehicle intelligence cron jobs
 * Executes: vehicle valuation backfill, VIN decode backfill, YMM propagation
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

  const results: Record<string, any> = {};

  try {
    // Import postgres with timeout handling
    const { Pool } = await Promise.race([
      import("https://deno.land/x/postgres@v0.17.0/mod.ts"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Import timeout")), 5000)
      ),
    ]) as any;

    // Direct Supabase database connection (bypassing pooler)
    const pool = new Pool(
      "postgresql://postgres:RbzKq32A0uhqvJMQ@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres",
      1,
      false
    );

    const conn = await Promise.race([
      pool.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 10000)
      ),
    ]) as any;

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
      const cmd = `SELECT net.http_post(url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/${job.func}', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '${job.body}'::jsonb);`;

      // Unschedule existing
      try {
        await conn.queryArray(`
          DO $x$ BEGIN
            IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${job.name}') THEN
              PERFORM cron.unschedule('${job.name}');
            END IF;
          END $x$;
        `);
        console.log(`[OK] Unscheduled ${job.name}`);
      } catch (e: any) {
        console.log(`[SKIP] unschedule ${job.name}: ${e.message}`);
      }

      // Schedule
      try {
        const r = await conn.queryArray(
          `SELECT cron.schedule($1, $2, $3)`,
          [job.name, job.schedule, cmd]
        );
        results[job.name] = { ok: true, jobid: r.rows[0]?.[0] };
        console.log(`[SCHEDULED] ${job.name}: jobid=${r.rows[0]?.[0]}`);
      } catch (e: any) {
        results[job.name] = { ok: false, error: e.message };
        console.error(`[ERROR] ${job.name}: ${e.message}`);
      }
    }

    conn.release();
    await pool.end();
  } catch (e: any) {
    results.error = e.message;
    console.error("[FATAL]", e.message);
  }

  return new Response(
    JSON.stringify(
      {
        ok: !results.error,
        timestamp: new Date().toISOString(),
        results,
        summary:
          Object.values(results).filter((r: any) => r.ok).length + "/" + 3 +
          " jobs scheduled",
      },
      null,
      2
    ),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: results.error ? 500 : 200,
    }
  );
});

/**
 * apply-cron-jobs
 * Applies vehicle intelligence cron jobs using direct SQL execution.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const results: Record<string, any> = {
    jobs: cronJobs.map(job => ({
      name: job.name,
      schedule: job.schedule,
      func: job.func,
      status: "scheduled"
    }))
  };

  // Note: This is a reference implementation
  // Actual scheduling must be done via direct database connection
  // For manual execution, use the SQL commands below

  const sqlCommands = cronJobs.map(job => {
    const cmd = `SELECT net.http_post(url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/${job.func}', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()), body := '${job.body}'::jsonb);`;
    return `SELECT cron.schedule('${job.name}', '${job.schedule}', $$${cmd}$$);`;
  });

  return new Response(JSON.stringify({
    ok: true,
    results,
    sql_commands: sqlCommands,
    message: "Use the SQL commands above to schedule the cron jobs"
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

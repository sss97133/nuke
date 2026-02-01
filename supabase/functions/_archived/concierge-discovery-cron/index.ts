import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Extended list of villa agencies to scrape
const AGENCIES = [
  "sibarth",
  "elan",
  "wimco",
  "isabelle",
  // Add more as discovered
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const results: any[] = [];

  for (const agency of AGENCIES) {
    try {
      console.log(`Triggering scrape for ${agency}...`);

      const response = await fetch(`${supabaseUrl}/functions/v1/concierge-villa-discovery-worker`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agency }),
      });

      const result = await response.json();
      results.push({ agency, ...result });

      // Small delay between agencies
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e: any) {
      results.push({ agency, error: e.message });
    }
  }

  // Get final count
  const { count } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true })
    .eq("property_type", "villa");

  // Log run
  await supabase.from("discovery_jobs").insert({
    job_type: "villa_discovery_cron",
    status: "completed",
    progress: {
      agencies_processed: AGENCIES.length,
      results,
      total_villas: count,
      completed_at: new Date().toISOString(),
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      agencies_processed: AGENCIES.length,
      total_villas: count,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

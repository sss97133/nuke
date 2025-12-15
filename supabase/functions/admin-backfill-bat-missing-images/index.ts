import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ReqBody = {
  batch_size?: number;
  dry_run?: boolean;
};

function isBatListingUrl(raw: string | null | undefined): boolean {
  const s = String(raw || "").toLowerCase();
  return s.includes("bringatrailer.com/listing/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(25, Number(body.batch_size || 10)));
    const dryRun = body.dry_run === true;

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Pull recent BaT-like vehicles; we'll filter down to those that truly have 0 vehicle_images.
    const { data: vehicles, error: vErr } = await admin
      .from("vehicles")
      .select("id,created_at,listing_url,discovery_url,bat_auction_url,profile_origin,discovery_source")
      .or("profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%")
      .order("created_at", { ascending: false })
      .limit(200);
    if (vErr) throw new Error(vErr.message);

    const out: any = {
      success: true,
      dry_run: dryRun,
      batch_size: batchSize,
      scanned: vehicles?.length || 0,
      candidates: 0,
      invoked: 0,
      skipped: 0,
      failed: 0,
      sample: [] as any[],
      note:
        "Invokes import-bat-listing for BaT vehicles that currently have 0 rows in vehicle_images (fixes: UI shows images via fallback but DB is empty).",
    };

    for (const v of (vehicles || [])) {
      const url = (v.listing_url || v.discovery_url || v.bat_auction_url || null) as string | null;
      if (!url || !isBatListingUrl(url)) {
        out.skipped++;
        continue;
      }

      const { count, error: cErr } = await admin
        .from("vehicle_images")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", v.id);
      if (cErr) {
        out.failed++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, url, ok: false, error: cErr.message });
        continue;
      }
      if ((count || 0) > 0) {
        out.skipped++;
        continue;
      }

      out.candidates++;
      if (out.candidates > batchSize) break;

      if (dryRun) {
        out.invoked++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, url, would_invoke: true });
        continue;
      }

      try {
        const { data, error } = await admin.functions.invoke("import-bat-listing", {
          body: {
            url,
            allowFuzzyMatch: false,
            imageBatchSize: 50,
          },
        });
        if (error) throw error;
        out.invoked++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, url, invoked: true, result: data || null });
      } catch (e: any) {
        out.failed++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, url, invoked: false, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});



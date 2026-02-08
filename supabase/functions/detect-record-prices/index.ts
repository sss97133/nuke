/**
 * DETECT RECORD PRICES
 *
 * Scans clean_vehicle_prices for highest sale per make/model/generation.
 * Upserts new records to record_prices table, tracks previous records.
 * Runs daily via cron (called by compute-feed-scores orchestrator).
 *
 * POST /functions/v1/detect-record-prices
 * Body: {
 *   "make"?: string,    // Optional: limit to specific make
 *   "limit"?: number,   // Max groups to process (default 500)
 *   "dry_run"?: boolean // Preview without writing
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Bucket years into generations (5-year ranges).
 * E.g., 1967 → { year_start: 1965, year_end: 1969 }
 */
function getGenerationBucket(year: number): { year_start: number; year_end: number } {
  const bucketStart = Math.floor(year / 5) * 5;
  return { year_start: bucketStart, year_end: bucketStart + 4 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const filterMake = body.make || null;
    const maxGroups = Math.min(body.limit ?? 500, 2000);
    const dryRun = body.dry_run || false;

    // Query the max sale per make/model/year from sold vehicles
    let query = supabase
      .from("clean_vehicle_prices")
      .select("vehicle_id, make, model, year, best_price, updated_at")
      .eq("is_sold", true)
      .gt("best_price", 0)
      .order("best_price", { ascending: false });

    if (filterMake) {
      query = query.ilike("make", filterMake);
    }

    const { data: allSales, error: salesErr } = await query.limit(5000);

    if (salesErr) {
      throw new Error(`Query error: ${salesErr.message}`);
    }

    if (!allSales || allSales.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No sold vehicles found", records_updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group by make/model/generation and find max
    const groupMaxes: Record<string, {
      make: string;
      model: string;
      year_start: number;
      year_end: number;
      record_price: number;
      record_vehicle_id: string;
      record_sale_date: string;
    }> = {};

    for (const sale of allSales) {
      if (!sale.make || !sale.model || !sale.year) continue;
      const { year_start, year_end } = getGenerationBucket(sale.year);
      const key = `${sale.make}|${sale.model}|${year_start}-${year_end}`;

      if (!groupMaxes[key] || Number(sale.best_price) > groupMaxes[key].record_price) {
        groupMaxes[key] = {
          make: sale.make,
          model: sale.model,
          year_start,
          year_end,
          record_price: Number(sale.best_price),
          record_vehicle_id: sale.vehicle_id,
          record_sale_date: sale.updated_at,
        };
      }
    }

    const groups = Object.values(groupMaxes).slice(0, maxGroups);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          groups_found: groups.length,
          top_records: groups.sort((a, b) => b.record_price - a.record_price).slice(0, 20),
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch existing records
    const { data: existingRecords } = await supabase
      .from("record_prices")
      .select("id, make, model, year_start, year_end, record_price, record_sale_date, times_record_broken");

    const existingMap: Record<string, any> = {};
    for (const r of existingRecords || []) {
      const key = `${r.make}|${r.model}|${r.year_start}-${r.year_end}`;
      existingMap[key] = r;
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const newRecords: any[] = [];

    for (const group of groups) {
      const key = `${group.make}|${group.model}|${group.year_start}-${group.year_end}`;
      const existing = existingMap[key];

      if (!existing) {
        // New record
        const { error } = await supabase.from("record_prices").insert({
          make: group.make,
          model: group.model,
          year_start: group.year_start,
          year_end: group.year_end,
          record_price: group.record_price,
          record_vehicle_id: group.record_vehicle_id,
          record_sale_date: group.record_sale_date,
          times_record_broken: 1,
        });
        if (!error) {
          created++;
          newRecords.push(group);
        }
      } else if (group.record_price > Number(existing.record_price)) {
        // Record broken!
        const prevDate = existing.record_sale_date;
        const newDate = group.record_sale_date;
        let avgDays = existing.avg_time_between_records_days;

        if (prevDate && newDate) {
          const daysBetween = Math.round(
            (new Date(newDate).getTime() - new Date(prevDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          const totalBroken = (existing.times_record_broken || 1);
          avgDays = avgDays
            ? Math.round((avgDays * (totalBroken - 1) + daysBetween) / totalBroken)
            : daysBetween;
        }

        const { error } = await supabase
          .from("record_prices")
          .update({
            previous_record_price: existing.record_price,
            previous_record_date: existing.record_sale_date,
            record_price: group.record_price,
            record_vehicle_id: group.record_vehicle_id,
            record_sale_date: group.record_sale_date,
            times_record_broken: (existing.times_record_broken || 1) + 1,
            avg_time_between_records_days: avgDays,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (!error) {
          updated++;
          newRecords.push({
            ...group,
            previous_price: Number(existing.record_price),
            beat_by_pct: Math.round(((group.record_price - Number(existing.record_price)) / Number(existing.record_price)) * 100),
          });
        }
      } else {
        unchanged++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        groups_processed: groups.length,
        created,
        updated,
        unchanged,
        new_records: newRecords.slice(0, 20),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[detect-record-prices] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * compute-build-timeline
 *
 * Computes monthly "activity snapshots" for a vehicle build by combining:
 * - QB spending grouped by month
 * - Photo counts grouped by taken_at month
 * - Build manifest purchase dates
 *
 * Upserts into build_activity_snapshots table.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get QB transactions grouped by month
    const { data: qbRows, error: qbErr } = await sb.rpc("execute_sql", {
      query: `
        SELECT
          date_trunc('month', date)::date as month,
          sum(total_amount) as total_spend,
          sum(CASE WHEN category = 'vehicle_part' THEN total_amount ELSE 0 END) as part_spend,
          sum(CASE WHEN category = 'tool' THEN total_amount ELSE 0 END) as tool_spend,
          count(DISTINCT vendor_name) as vendor_count,
          jsonb_agg(DISTINCT jsonb_build_object('name', vendor_name, 'spend', total_amount))
            FILTER (WHERE vendor_name IS NOT NULL) as vendors
        FROM qb_transactions
        WHERE vehicle_id = '${vehicle_id}'
        GROUP BY date_trunc('month', date)
        ORDER BY month
      `,
    });
    if (qbErr) throw new Error(`QB query failed: ${qbErr.message}`);

    // 2. Get photo counts grouped by month
    const { data: photoRows, error: photoErr } = await sb.rpc("execute_sql", {
      query: `
        SELECT
          date_trunc('month', taken_at)::date as month,
          count(*) as photo_count
        FROM vehicle_images
        WHERE vehicle_id = '${vehicle_id}' AND taken_at IS NOT NULL
        GROUP BY date_trunc('month', taken_at)
        ORDER BY month
      `,
    });
    if (photoErr) throw new Error(`Photo query failed: ${photoErr.message}`);

    // 3. Get manifest purchase dates (from invoice_ref which has QB-ID date patterns)
    const { data: manifestRows, error: manErr } = await sb.rpc("execute_sql", {
      query: `
        SELECT
          date_trunc('month', updated_at)::date as month,
          count(*) as devices_purchased
        FROM vehicle_build_manifest
        WHERE vehicle_id = '${vehicle_id}' AND purchased = true
        GROUP BY date_trunc('month', updated_at)
        ORDER BY month
      `,
    });
    if (manErr) throw new Error(`Manifest query failed: ${manErr.message}`);

    // 4. Merge all months
    const monthMap = new Map<string, {
      total_spend: number;
      vehicle_part_spend: number;
      tool_spend: number;
      vendor_count: number;
      top_vendors: any[];
      photo_count: number;
      devices_purchased: number;
    }>();

    const ensureMonth = (m: string) => {
      if (!monthMap.has(m)) {
        monthMap.set(m, {
          total_spend: 0,
          vehicle_part_spend: 0,
          tool_spend: 0,
          vendor_count: 0,
          top_vendors: [],
          photo_count: 0,
          devices_purchased: 0,
        });
      }
      return monthMap.get(m)!;
    };

    for (const row of (qbRows || [])) {
      const m = ensureMonth(row.month);
      m.total_spend = parseFloat(row.total_spend) || 0;
      m.vehicle_part_spend = parseFloat(row.part_spend) || 0;
      m.tool_spend = parseFloat(row.tool_spend) || 0;
      m.vendor_count = parseInt(row.vendor_count) || 0;
      // Parse vendors and get top 5 by spend
      try {
        const vendors = typeof row.vendors === "string" ? JSON.parse(row.vendors) : (row.vendors || []);
        m.top_vendors = vendors
          .filter((v: any) => v.name)
          .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
          .slice(0, 5);
      } catch { /* ignore parse errors */ }
    }

    for (const row of (photoRows || [])) {
      const m = ensureMonth(row.month);
      m.photo_count = parseInt(row.photo_count) || 0;
    }

    for (const row of (manifestRows || [])) {
      const m = ensureMonth(row.month);
      m.devices_purchased = parseInt(row.devices_purchased) || 0;
    }

    // 5. Compute normalized scores
    const months = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const maxSpend = Math.max(...months.map(([, v]) => v.total_spend), 1);
    const maxPhotos = Math.max(...months.map(([, v]) => v.photo_count), 1);

    const snapshots = months.map(([month, data]) => {
      const spendingIntensity = data.total_spend / maxSpend;
      const photoDensity = data.photo_count / maxPhotos;
      // Activity score: weighted composite (spending 40%, photos 40%, devices 20%)
      const deviceScore = data.devices_purchased > 0 ? Math.min(data.devices_purchased / 5, 1) : 0;
      const activityScore = Math.round(
        (spendingIntensity * 40 + photoDensity * 40 + deviceScore * 20)
      );

      return {
        vehicle_id,
        month,
        total_spend: data.total_spend,
        vehicle_part_spend: data.vehicle_part_spend,
        tool_spend: data.tool_spend,
        vendor_count: data.vendor_count,
        top_vendors: data.top_vendors,
        photo_count: data.photo_count,
        devices_purchased: data.devices_purchased,
        spending_intensity: Math.round(spendingIntensity * 1000) / 1000,
        photo_density: Math.round(photoDensity * 1000) / 1000,
        activity_score: activityScore,
        computed_at: new Date().toISOString(),
      };
    });

    // 6. Upsert in batches
    let upserted = 0;
    const BATCH = 50;
    for (let i = 0; i < snapshots.length; i += BATCH) {
      const batch = snapshots.slice(i, i + BATCH);
      const { error: upsertErr } = await sb
        .from("build_activity_snapshots")
        .upsert(batch, { onConflict: "vehicle_id,month" });
      if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);
      upserted += batch.length;
    }

    // 7. Compute summary stats
    const totalSpend = snapshots.reduce((s, r) => s + r.total_spend, 0);
    const totalPhotos = snapshots.reduce((s, r) => s + r.photo_count, 0);
    const peakMonth = snapshots.reduce((best, r) =>
      r.activity_score > (best?.activity_score || 0) ? r : best, snapshots[0]);

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        months_computed: upserted,
        date_range: {
          first: months[0]?.[0],
          last: months[months.length - 1]?.[0],
        },
        totals: {
          spend: Math.round(totalSpend * 100) / 100,
          photos: totalPhotos,
        },
        peak_month: peakMonth
          ? { month: peakMonth.month, score: peakMonth.activity_score, spend: peakMonth.total_spend, photos: peakMonth.photo_count }
          : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

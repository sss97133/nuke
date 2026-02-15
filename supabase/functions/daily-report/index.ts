/**
 * Daily Report — End-of-day summary of system activity
 *
 * Gathers stats on:
 *   - Photos processed, matched, failed
 *   - Deal jackets extracted
 *   - Vehicles created/enriched
 *   - Extraction queue health
 *   - Engine bay analyses
 *   - Errors/failures
 *
 * Delivers via Telegram (and optionally email).
 * Called by: cron (daily at 9 PM), manual trigger
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { hours = 24, send_telegram = true, send_email = false, email_to, telegram_chat_id } = body;

    const report = await gatherReport(hours);
    const message = formatTelegramMessage(report, hours);

    const delivery: Record<string, any> = {};

    // Send via Telegram
    if (send_telegram) {
      delivery.telegram = await sendTelegram(message, telegram_chat_id);
    }

    // Send via email
    if (send_email && email_to) {
      delivery.email = await sendEmail({
        to: email_to,
        subject: `Nuke Daily Report — ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
        html: formatEmailHtml(report, hours),
      });
    }

    // Store report
    await supabase.from("daily_reports").insert({
      report_data: report,
      hours_covered: hours,
      generated_at: new Date().toISOString(),
      delivery_status: delivery,
    }).then(() => {}, () => {
      // Table might not exist yet, that's fine
    });

    return new Response(JSON.stringify({ report, delivery, generated_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Daily report error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── GATHER REPORT DATA ─────────────────────────────────────────────────────
async function gatherReport(hours: number) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel
  const [
    photosProcessed,
    vehiclesCreated,
    vehiclesEnriched,
    dealJackets,
    engineBay,
    queueHealth,
    photoTotals,
    vehicleTotals,
    portfolioStats,
    dealJacketFindings,
  ] = await Promise.all([
    // Photos processed in time window
    supabase
      .from("photo_sync_items")
      .select("sync_status", { count: "exact", head: false })
      .gte("classified_at", since)
      .then(({ data, count }) => {
        const statuses: Record<string, number> = {};
        (data || []).forEach((d: any) => {
          statuses[d.sync_status] = (statuses[d.sync_status] || 0) + 1;
        });
        return { total: count || 0, by_status: statuses };
      }),

    // Vehicles created
    supabase
      .from("vehicles")
      .select("source", { count: "exact", head: false })
      .gte("created_at", since)
      .is("deleted_at", null)
      .limit(5000)
      .then(({ data, count }) => {
        const sources: Record<string, number> = {};
        (data || []).forEach((d: any) => {
          sources[d.source || "unknown"] = (sources[d.source || "unknown"] || 0) + 1;
        });
        return { total: count || 0, by_source: sources };
      }),

    // Vehicles with updates (enriched)
    supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", since)
      .is("deleted_at", null)
      .then(({ count }) => ({ total: count || 0 })),

    // Deal jacket extraction activity
    supabase
      .from("vehicle_images")
      .select("id, components", { count: "exact", head: false })
      .eq("category", "documentation")
      .gte("updated_at", since)
      .not("components", "is", null)
      .then(({ data, count }) => {
        const extracted = (data || []).filter((d: any) =>
          d.components?.forensic_extracted_at &&
          new Date(d.components.forensic_extracted_at).toISOString() >= since
        ).length;
        return { updated: count || 0, newly_extracted: extracted };
      }),

    // Engine bay analyses
    supabase
      .from("vehicle_images")
      .select("id, components", { count: "exact", head: false })
      .eq("category", "engine_bay")
      .gte("updated_at", since)
      .not("components", "is", null)
      .then(({ data, count }) => {
        const analyzed = (data || []).filter((d: any) =>
          d.components?.engine_family
        ).length;
        return { updated: count || 0, with_analysis: analyzed };
      }),

    // Import queue health
    supabase.rpc("get_queue_summary").then(
      ({ data }) => data,
      () => null
    ).then(async (rpcData) => {
      if (rpcData) return rpcData;
      // Fallback: manual query
      const { count: pending } = await supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
      const { count: completed } = await supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "complete").gte("completed_at", since);
      const { count: failed } = await supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "failed");
      return { pending: pending || 0, completed_today: completed || 0, failed: failed || 0 };
    }),

    // Photo totals
    supabase
      .from("photo_sync_items")
      .select("sync_status", { count: "exact", head: false })
      .then(({ data }) => {
        const statuses: Record<string, number> = {};
        (data || []).forEach((d: any) => {
          statuses[d.sync_status] = (statuses[d.sync_status] || 0) + 1;
        });
        return statuses;
      }),

    // Vehicle totals
    supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .then(({ count }) => ({ total: count || 0 })),

    // User's personal portfolio stats (via owned + image-linked vehicles)
    (async () => {
      const userId = "0b9f107a-d124-49de-9ded-94698f63c1c4";
      // Get vehicles directly owned
      const { data: owned } = await supabase
        .from("vehicles")
        .select("id, year, make, model, sale_price, vin, origin_metadata")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .limit(200);
      // Get vehicle IDs from user's images
      const { data: imageLinks } = await supabase
        .from("vehicle_images")
        .select("vehicle_id")
        .eq("user_id", userId)
        .not("vehicle_id", "is", null)
        .limit(500);
      const imageVehicleIds = [...new Set((imageLinks || []).map(i => i.vehicle_id))];
      const ownedIds = new Set((owned || []).map(v => v.id));
      const extraIds = imageVehicleIds.filter(id => !ownedIds.has(id));
      let extraVehicles: any[] = [];
      if (extraIds.length > 0) {
        const { data } = await supabase
          .from("vehicles")
          .select("id, year, make, model, sale_price, vin, origin_metadata")
          .in("id", extraIds.slice(0, 100))
          .is("deleted_at", null);
        extraVehicles = data || [];
      }
      const allVehicles = [...(owned || []), ...extraVehicles];
      const withPrice = allVehicles.filter(v => v.sale_price > 0);
      const totalValue = withPrice.reduce((sum: number, v: any) => sum + (v.sale_price || 0), 0);
      const withVin = allVehicles.filter(v => v.vin);
      const withDealJacket = allVehicles.filter(v => v.origin_metadata?.deal_jacket_data);
      return {
        total_vehicles: allVehicles.length,
        with_price: withPrice.length,
        total_value: totalValue,
        avg_value: withPrice.length > 0 ? Math.round(totalValue / withPrice.length) : 0,
        with_vin: withVin.length,
        with_deal_jacket: withDealJacket.length,
        vehicles: allVehicles.slice(0, 20).map(v => ({
          id: v.id,
          name: [v.year, v.make, v.model].filter(Boolean).join(" "),
          price: v.sale_price,
          has_vin: !!v.vin,
          has_deal_jacket: !!v.origin_metadata?.deal_jacket_data,
        })),
      };
    })(),

    // Deal jacket extraction details (what was found)
    supabase
      .from("vehicle_images")
      .select("id, vehicle_id, ai_extractions, components")
      .eq("category", "documentation")
      .not("ai_extractions", "is", null)
      .gte("updated_at", since)
      .limit(50)
      .then(({ data }) => {
        const results = (data || []).map((d: any) => {
          const forensic = (d.ai_extractions || []).find((e: any) => e.type === "forensic_deal_jacket");
          if (!forensic?.result) return null;
          const r = forensic.result;
          return {
            image_id: d.id,
            vehicle_id: d.vehicle_id,
            vehicle_desc: [r.vehicle?.year, r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" ") || "unknown",
            sale_price: r.sale?.sale_price || 0,
            profit: r.profit?.reported_profit || 0,
            recon_total: r.reconditioning?.total || 0,
            vin: r.vehicle?.vin || null,
          };
        }).filter(Boolean);
        return { count: results.length, extractions: results };
      }),
  ]);

  return {
    period: { hours, since },
    photos: {
      processed_today: photosProcessed,
      totals: photoTotals,
    },
    portfolio: portfolioStats,
    deal_jacket_findings: dealJacketFindings,
    vehicles: {
      created_today: vehiclesCreated,
      enriched_today: vehiclesEnriched,
      total: vehicleTotals,
    },
    deal_jackets: dealJackets,
    engine_bay: engineBay,
    extraction_queue: queueHealth,
  };
}

// ─── FORMAT TELEGRAM MESSAGE ──────────────────────────────────────────────────
function formatTelegramMessage(report: any, hours: number): string {
  const photosToday = report.photos.processed_today;
  const vehiclesToday = report.vehicles.created_today;
  const enriched = report.vehicles.enriched_today;
  const dj = report.deal_jackets;
  const eb = report.engine_bay;
  const queue = report.extraction_queue;
  const photoTotals = report.photos.totals;

  const lines = [
    `*NUKE Daily Report* — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`,
    `_(last ${hours}h)_`,
    ``,
    `*Photos*`,
    `  Classified: ${photosToday.total}`,
  ];

  if (Object.keys(photosToday.by_status).length > 0) {
    for (const [status, count] of Object.entries(photosToday.by_status)) {
      lines.push(`    ${status}: ${count}`);
    }
  }

  lines.push(
    `  Pipeline totals: ${Object.entries(photoTotals).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    ``,
    `*Vehicles*`,
    `  Created: ${vehiclesToday.total}`,
  );

  if (Object.keys(vehiclesToday.by_source).length > 0) {
    for (const [source, count] of Object.entries(vehiclesToday.by_source)) {
      lines.push(`    ${source}: ${count}`);
    }
  }

  lines.push(
    `  Enriched: ${enriched.total}`,
    `  Total active: ${report.vehicles.total.total?.toLocaleString()}`,
  );

  // Portfolio section
  const portfolio = report.portfolio;
  if (portfolio) {
    lines.push(
      ``,
      `*Your Portfolio*`,
      `  Vehicles: ${portfolio.total_vehicles}`,
      `  With price: ${portfolio.with_price}`,
      `  Total value: $${(portfolio.total_value || 0).toLocaleString()}`,
      `  Avg value: $${(portfolio.avg_value || 0).toLocaleString()}`,
      `  With VIN: ${portfolio.with_vin}`,
      `  With deal jacket: ${portfolio.with_deal_jacket}`,
    );
    if (portfolio.vehicles?.length > 0) {
      lines.push(`  Inventory:`);
      for (const v of portfolio.vehicles.slice(0, 10)) {
        const price = v.price ? `$${v.price.toLocaleString()}` : "no price";
        const badges = [v.has_vin ? "VIN" : "", v.has_deal_jacket ? "DJ" : ""].filter(Boolean).join(",");
        lines.push(`    ${v.name || "Unknown"} — ${price}${badges ? ` [${badges}]` : ""}`);
      }
    }
  }

  // Deal jacket findings
  const djf = report.deal_jacket_findings;
  if (djf?.count > 0) {
    lines.push(
      ``,
      `*Deal Jacket Extractions (${djf.count} today)*`,
    );
    for (const ext of (djf.extractions || []).slice(0, 5)) {
      const parts = [`  ${ext.vehicle_desc}`];
      if (ext.sale_price) parts.push(`sale: $${ext.sale_price.toLocaleString()}`);
      if (ext.profit) parts.push(`profit: $${ext.profit.toLocaleString()}`);
      if (ext.vin) parts.push(`VIN: ${ext.vin.substring(0, 11)}...`);
      lines.push(parts.join(" | "));
    }
  }

  lines.push(
    ``,
    `*Deal Jackets*`,
    `  Updated: ${dj.updated}`,
    `  Newly extracted: ${dj.newly_extracted}`,
    ``,
    `*Engine Bay*`,
    `  Updated: ${eb.updated}`,
    `  With analysis: ${eb.with_analysis}`,
    ``,
    `*Extraction Queue*`,
    `  Pending: ${queue.pending || "n/a"}`,
    `  Completed today: ${queue.completed_today || "n/a"}`,
    `  Failed: ${queue.failed || "n/a"}`,
  );

  return lines.join("\n");
}

// ─── SEND TELEGRAM ───────────────────────────────────────────────────────────
async function sendTelegram(message: string, overrideChatId?: string) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = overrideChatId || Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("TELEGRAM_CHANNEL_ID") || "7587296683";
  console.log("Telegram: using chat_id =", chatId, "bot token prefix:", botToken?.substring(0, 10));

  if (!botToken) {
    return { sent: false, error: "TELEGRAM_BOT_TOKEN not set" };
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    const data = await resp.json();
    return { sent: data.ok, message_id: data.result?.message_id, error: data.ok ? undefined : data.description };
  } catch (err) {
    return { sent: false, error: String(err) };
  }
}

// ─── FORMAT EMAIL HTML ──────────────────────────────────────────────────────
function formatEmailHtml(report: any, hours: number): string {
  const photosToday = report.photos.processed_today;
  const vehiclesToday = report.vehicles.created_today;
  const enriched = report.vehicles.enriched_today;
  const dj = report.deal_jackets;
  const eb = report.engine_bay;
  const queue = report.extraction_queue;

  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="border-bottom: 2px solid #333; padding-bottom: 8px;">Nuke Daily Report</h2>
    <p style="color: #666;">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} &mdash; Last ${hours} hours</p>

    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr style="background: #f5f5f5;">
        <td style="padding: 8px; font-weight: bold;">Photos Classified</td>
        <td style="padding: 8px; text-align: right;">${photosToday.total}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Vehicles Created</td>
        <td style="padding: 8px; text-align: right;">${vehiclesToday.total}</td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 8px; font-weight: bold;">Vehicles Enriched</td>
        <td style="padding: 8px; text-align: right;">${enriched.total}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Deal Jackets Extracted</td>
        <td style="padding: 8px; text-align: right;">${dj.newly_extracted}</td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 8px; font-weight: bold;">Engine Bay Analyses</td>
        <td style="padding: 8px; text-align: right;">${eb.with_analysis}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Queue Completed</td>
        <td style="padding: 8px; text-align: right;">${queue.completed_today || "n/a"}</td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 8px; font-weight: bold;">Queue Pending</td>
        <td style="padding: 8px; text-align: right;">${queue.pending || "n/a"}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Total Active Vehicles</td>
        <td style="padding: 8px; text-align: right;">${report.vehicles.total.total?.toLocaleString()}</td>
      </tr>
    </table>

    <p style="color: #999; font-size: 12px; margin-top: 24px;">Generated by Nuke autonomous pipeline</p>
  </div>`;
}

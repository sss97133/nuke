import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BackfillInvoiceDraftsRequest {
  vehicle_id?: string;
  event_id?: string;
  limit?: number;
  dry_run?: boolean;
  rate_per_hour?: number;
  max_hours?: number;
  max_images?: number;
  include_documentation?: boolean;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function toYmd(raw: string | null | undefined): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Best-effort parse (supports "MM/DD/YYYY" and "Jan 2, 2025" in most runtimes)
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function escapeHtml(v: string): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type WorkCategory = "paint" | "body" | "drivetrain" | "suspension" | "mechanical" | "documentation" | "parts_order" | "other";

function inferCategoryFromTitle(title: string): WorkCategory {
  const t = String(title || "").toLowerCase();
  if (t.includes("parts order") || t.includes("ebay")) return "parts_order";
  if (t.includes("documentation")) return "documentation";
  if (t.includes("paint")) return "paint";
  if (t.includes("body")) return "body";
  if (t.includes("drivetrain") || t.includes("transmission") || t.includes("axle") || t.includes("diff")) return "drivetrain";
  if (t.includes("suspension") || t.includes("chassis")) return "suspension";
  if (t.includes("mechanical") || t.includes("engine") || t.includes("service")) return "mechanical";
  return "other";
}

function stripPhotoCount(title: string): string {
  return String(title || "").replace(/\s*\(\s*\d+\s+photos?\s*\)\s*$/i, "").trim();
}

function estimateHours(params: { category: WorkCategory; imageCount: number; maxHours: number }): number {
  const { category, imageCount, maxHours } = params;
  if (category === "documentation") return 0;
  if (category === "parts_order") return 0;

  const base = 1;
  const perPhoto = imageCount / 5; // 5 photos ~= 1 hour baseline
  const mult =
    category === "paint" ? 1.35 :
    category === "body" ? 1.25 :
    category === "drivetrain" ? 1.15 :
    category === "suspension" ? 1.10 :
    category === "mechanical" ? 1.10 :
    1.0;

  const hours = Math.ceil((base + perPhoto) * mult);
  return Math.max(1, Math.min(maxHours, hours));
}

function fmtMoneyUsd(amount: number): string {
  const v = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function buildInvoiceHtml(params: {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  vehicleLabel: string;
  workTitle: string;
  evidenceCount: number;
  laborHours: number;
  ratePerHour: number;
  total: number;
  imageUrls: string[];
}): string {
  const {
    invoiceNumber,
    invoiceDate,
    dueDate,
    vehicleLabel,
    workTitle,
    evidenceCount,
    laborHours,
    ratePerHour,
    total,
    imageUrls,
  } = params;

  const escapedVehicle = escapeHtml(vehicleLabel);
  const escapedWork = escapeHtml(workTitle);
  const laborTotal = laborHours * ratePerHour;

  const imgs = (imageUrls || [])
    .slice(0, 6)
    .map((u) => {
      const safe = escapeHtml(u);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer"><img src="${safe}" style="width:110px;height:110px;object-fit:cover;border:1px solid #ccc;"/></a>`;
    })
    .join("\n");

  return `
  <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid #000; padding-bottom:12px; margin-bottom:12px;">
      <div>
        <div style="font-size:18px; font-weight:800;">DRAFT INVOICE (evidence-backed)</div>
        <div style="font-size:12px; color:#555; margin-top:4px;">Invoice # <strong>${escapeHtml(invoiceNumber)}</strong></div>
        <div style="font-size:12px; color:#555;">Invoice date: <strong>${escapeHtml(invoiceDate)}</strong> • Due: <strong>${escapeHtml(dueDate)}</strong></div>
        <div style="font-size:12px; color:#555; margin-top:6px;">Vehicle: <strong>${escapedVehicle}</strong></div>
        <div style="font-size:12px; color:#555;">Work session: <strong>${escapedWork}</strong> (${Number(evidenceCount || 0)} photos)</div>
      </div>
      <div style="text-align:right; min-width:180px;">
        <div style="font-size:12px; color:#666;">Total</div>
        <div style="font-size:22px; font-weight:800;">${fmtMoneyUsd(total)}</div>
        <div style="font-size:11px; color:#a00; margin-top:6px;">NOTE: deterministic estimate (no receipt/line-item ledger yet). Replace with actuals.</div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="font-size:12px; font-weight:700; margin-bottom:6px;">Line items</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="border-bottom:2px solid #000;">
            <th style="text-align:left; padding:6px 4px;">Description</th>
            <th style="text-align:right; padding:6px 4px;">Qty</th>
            <th style="text-align:right; padding:6px 4px;">Unit</th>
            <th style="text-align:right; padding:6px 4px;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px dotted #ccc;">
            <td style="padding:6px 4px;"><strong>Labor</strong> — ${escapedWork}</td>
            <td style="padding:6px 4px; text-align:right;">${laborHours > 0 ? `${laborHours.toFixed(1)} hr` : "—"}</td>
            <td style="padding:6px 4px; text-align:right;">${laborHours > 0 ? `${fmtMoneyUsd(ratePerHour)}/hr` : "—"}</td>
            <td style="padding:6px 4px; text-align:right;"><strong>${fmtMoneyUsd(laborTotal)}</strong></td>
          </tr>
          <tr style="border-bottom:1px dotted #ccc;">
            <td style="padding:6px 4px;">Materials (TBD)</td>
            <td style="padding:6px 4px; text-align:right;">—</td>
            <td style="padding:6px 4px; text-align:right;">—</td>
            <td style="padding:6px 4px; text-align:right;">${fmtMoneyUsd(0)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid #000;">
            <td colspan="3" style="padding:8px 4px; text-align:right; font-weight:700;">Subtotal</td>
            <td style="padding:8px 4px; text-align:right; font-weight:700;">${fmtMoneyUsd(laborTotal)}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding:4px; text-align:right;">Tax</td>
            <td style="padding:4px; text-align:right;">${fmtMoneyUsd(0)}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding:8px 4px; text-align:right; font-weight:800; font-size:14px;">Total</td>
            <td style="padding:8px 4px; text-align:right; font-weight:800; font-size:14px;">${fmtMoneyUsd(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div style="margin-top:14px;">
      <div style="font-size:12px; font-weight:700; margin-bottom:6px;">Evidence (sample)</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${imgs || "<div style=\"font-size:12px;color:#666;\">No images available for this event/day.</div>"}
      </div>
    </div>
  </div>
  `.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Partial<BackfillInvoiceDraftsRequest>;
    const vehicleId = String(body.vehicle_id || "").trim();
    const eventId = String(body.event_id || "").trim();

    const limit = Math.max(1, Math.min(50, Number(body.limit || 5)));
    const dryRun = body.dry_run !== false; // default true
    const ratePerHour = Math.max(0, Math.min(1000, Number(body.rate_per_hour || 150)));
    const maxHours = Math.max(1, Math.min(24, Number(body.max_hours || 16)));
    const maxImages = Math.max(0, Math.min(12, Number(body.max_images || 6)));
    const includeDocumentation = Boolean(body.include_documentation);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SERVICE_ROLE_KEY") ??
      "";
    if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id || null;
    if (userError || !userId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let resolvedVehicleId = vehicleId;
    let events: Array<{ id: string; vehicle_id: string; event_date: string | null; title: string | null }> = [];

    if (eventId) {
      if (!isUuid(eventId)) {
        return new Response(JSON.stringify({ error: "event_id must be a UUID" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: ev, error: evErr } = await supabase
        .from("timeline_events")
        .select("id, vehicle_id, event_date, title")
        .eq("id", eventId)
        .maybeSingle();
      if (evErr || !ev) throw evErr || new Error("Event not found");
      resolvedVehicleId = String(ev.vehicle_id);
      events = [{ id: String(ev.id), vehicle_id: String(ev.vehicle_id), event_date: ev.event_date, title: ev.title }];
    } else {
      if (!isUuid(resolvedVehicleId)) {
        return new Response(JSON.stringify({ error: "vehicle_id must be a UUID" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // AuthZ: only allow owner (simple check)
    const { data: veh, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, owner_id, user_id, year, make, model, trim")
      .eq("id", resolvedVehicleId)
      .maybeSingle();
    if (vehErr || !veh) throw vehErr || new Error("Vehicle not found");
    const ownerId = veh.owner_id ? String(veh.owner_id) : null;
    const userIdCol = veh.user_id ? String(veh.user_id) : null;
    if (ownerId !== userId && userIdCol !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!eventId) {
      let q = supabase
        .from("timeline_events")
        .select("id, vehicle_id, event_date, title")
        .eq("vehicle_id", resolvedVehicleId)
        .not("event_date", "is", null)
        .order("event_date", { ascending: false })
        .limit(limit * 3); // grab extra, then filter

      const { data: evs, error: evsErr } = await q;
      if (evsErr) throw evsErr;
      const raw = (evs || []).map((r: any) => ({
        id: String(r.id),
        vehicle_id: String(r.vehicle_id),
        event_date: r.event_date as string | null,
        title: r.title as string | null,
      }));

      events = raw
        .filter((e) => Boolean(toYmd(e.event_date)))
        .filter((e) => includeDocumentation ? true : inferCategoryFromTitle(String(e.title || "")) !== "documentation")
        .slice(0, limit);
    }

    const eventIds = events.map((e) => e.id);
    const { data: existing } = await supabase
      .from("generated_invoices")
      .select("event_id")
      .in("event_id", eventIds);
    const existingSet = new Set((existing || []).map((r: any) => String(r.event_id)));

    const vehicleLabel = `${veh.year || ""} ${veh.make || ""} ${veh.model || ""}${veh.trim ? " " + veh.trim : ""}`.replace(/\s+/g, " ").trim() || "Vehicle";

    const results: any[] = [];
    const inserts: any[] = [];

    for (const ev of events) {
      const ymd = toYmd(ev.event_date);
      if (!ymd) continue;
      const title = String(ev.title || "Work Session");
      const category = inferCategoryFromTitle(title);
      const workTitle = stripPhotoCount(title) || "Work Session";

      const invoiceNumber = `INV-${ymd.replaceAll("-", "")}-${ev.id.slice(0, 6).toUpperCase()}`;
      const invoiceDate = ymd;
      const due = new Date(`${ymd}T00:00:00.000Z`);
      due.setUTCDate(due.getUTCDate() + 30);
      const dueDate = due.toISOString().slice(0, 10);

      // Evidence: prefer explicit links, fall back to day-range
      let evidenceCount = 0;
      let previewUrls: string[] = [];

      const { data: linkedImgs, error: linkedErr } = await supabase
        .from("vehicle_images")
        .select("id, image_url, taken_at, created_at")
        .eq("vehicle_id", resolvedVehicleId)
        .eq("timeline_event_id", ev.id)
        .order("taken_at", { ascending: true, nullsFirst: true })
        .limit(maxImages);
      if (linkedErr) {
        // ignore
      }
      if (Array.isArray(linkedImgs) && linkedImgs.length > 0) {
        evidenceCount = linkedImgs.length;
        previewUrls = linkedImgs.map((r: any) => String(r.image_url)).filter(Boolean);
      } else {
        const startIso = new Date(`${ymd}T00:00:00.000Z`).toISOString();
        const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();

        const byCreated = await supabase
          .from("vehicle_images")
          .select("id, image_url, taken_at, created_at")
          .eq("vehicle_id", resolvedVehicleId)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("created_at", { ascending: true })
          .limit(Math.max(maxImages, 24));

        const byTaken = await supabase
          .from("vehicle_images")
          .select("id, image_url, taken_at, created_at")
          .eq("vehicle_id", resolvedVehicleId)
          .gte("taken_at", startIso)
          .lt("taken_at", endIso)
          .order("taken_at", { ascending: true })
          .limit(Math.max(maxImages, 24));

        const seen = new Set<string>();
        const merged: any[] = [];
        for (const row of [...(byTaken.data || []), ...(byCreated.data || [])] as any[]) {
          const id = String(row?.id || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          merged.push(row);
        }
        merged.sort((a, b) => {
          const at = String(a?.taken_at || a?.created_at || "");
          const bt = String(b?.taken_at || b?.created_at || "");
          return at.localeCompare(bt);
        });

        evidenceCount = merged.length;
        previewUrls = merged.map((r) => String(r?.image_url || "")).filter(Boolean).slice(0, maxImages);
      }

      const laborHours = estimateHours({ category, imageCount: evidenceCount, maxHours });
      const subtotal = laborHours * ratePerHour;
      const total = subtotal; // tax TBD

      const html = buildInvoiceHtml({
        invoiceNumber,
        invoiceDate,
        dueDate,
        vehicleLabel,
        workTitle,
        evidenceCount,
        laborHours,
        ratePerHour,
        total,
        imageUrls: previewUrls,
      });

      const already = existingSet.has(ev.id);
      results.push({
        event_id: ev.id,
        event_date: ymd,
        title,
        invoice_number: invoiceNumber,
        evidence_count: evidenceCount,
        labor_hours: laborHours,
        subtotal,
        status: already ? "skipped_existing" : dryRun ? "dry_run" : "to_insert",
      });

      if (!already && !dryRun) {
        inserts.push({
          event_id: ev.id,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: dueDate,
          subtotal,
          tax_amount: 0,
          tax_rate: 0,
          total_amount: total,
          amount_paid: 0,
          amount_due: total,
          payment_status: "unpaid",
          status: "draft",
          html_content: html,
          created_by: userId,
        });
      }
    }

    let inserted: any[] = [];
    if (!dryRun && inserts.length > 0) {
      const { data: ins, error: insErr } = await supabase
        .from("generated_invoices")
        .insert(inserts)
        .select("id, event_id, invoice_number");
      if (insErr) throw insErr;
      inserted = ins || [];
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      vehicle_id: resolvedVehicleId,
      requested_limit: limit,
      considered: events.length,
      created: inserted.length,
      inserted,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[backfill-invoice-drafts] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


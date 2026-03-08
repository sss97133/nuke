/**
 * WIDGET: DEAL READINESS
 *
 * Checklist-based scoring of how close a deal is to closing.
 * Checks: deal jacket exists, buyer/seller assigned, documents present,
 * pricing set, deposit received, reconditioning complete.
 *
 * POST /functions/v1/widget-deal-readiness
 * { "vehicle_id": "uuid" }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

interface ChecklistItem {
  item: string;
  category: string;
  complete: boolean;
  weight: number;
  detail?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    // Get vehicle
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin, asking_price, sale_price, status")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Get deal jackets
    const { data: deals } = await supabase
      .from("deal_jackets")
      .select("*")
      .eq("vehicle_id", vehicle_id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Get documents
    const { data: docs } = await supabase
      .from("deal_documents")
      .select("document_type, deal_id")
      .eq("vehicle_id", vehicle_id);

    // Get images count
    const { count: imageCount } = await supabase
      .from("vehicle_images")
      .select("*", { count: "exact", head: true })
      .eq("vehicle_id", vehicle_id);

    const deal = deals?.[0];
    const docTypes = new Set((docs ?? []).map((d: any) => d.document_type));
    const checklist: ChecklistItem[] = [];

    // ── Deal structure checks ────────────────────────────────────────

    checklist.push({
      item: "Deal jacket created",
      category: "deal_structure",
      complete: !!deal,
      weight: 10,
    });

    checklist.push({
      item: "Deal type specified",
      category: "deal_structure",
      complete: !!deal?.deal_type,
      weight: 5,
      detail: deal?.deal_type || undefined,
    });

    checklist.push({
      item: "Sale price set",
      category: "deal_structure",
      complete: !!(deal?.total_selling_price || vehicle.asking_price || vehicle.sale_price),
      weight: 10,
      detail: deal?.total_selling_price
        ? `$${Number(deal.total_selling_price).toLocaleString()}`
        : vehicle.asking_price
          ? `Asking: $${Number(vehicle.asking_price).toLocaleString()}`
          : undefined,
    });

    // ── Contact checks ──────────────────────────────────────────────

    checklist.push({
      item: "Seller/source identified",
      category: "contacts",
      complete: !!deal?.acquired_from_id,
      weight: 8,
    });

    checklist.push({
      item: "Buyer identified",
      category: "contacts",
      complete: !!deal?.sold_to_id,
      weight: 10,
    });

    // ── Financial checks ────────────────────────────────────────────

    checklist.push({
      item: "Deposit received",
      category: "financial",
      complete: !!(deal?.deposit_amount && Number(deal.deposit_amount) > 0),
      weight: 10,
      detail: deal?.deposit_amount ? `$${Number(deal.deposit_amount).toLocaleString()}` : undefined,
    });

    checklist.push({
      item: "Payment received",
      category: "financial",
      complete: !!(deal?.payment_amount && Number(deal.payment_amount) > 0),
      weight: 10,
      detail: deal?.payment_method || undefined,
    });

    checklist.push({
      item: "Cost basis documented",
      category: "financial",
      complete: !!(deal?.initial_cost || deal?.total_initial_cost),
      weight: 5,
    });

    // ── Document checks ─────────────────────────────────────────────

    checklist.push({
      item: "Title on file",
      category: "documents",
      complete: docTypes.has("title"),
      weight: 10,
    });

    checklist.push({
      item: "Bill of sale",
      category: "documents",
      complete: docTypes.has("bill_of_sale"),
      weight: 8,
    });

    checklist.push({
      item: "Odometer disclosure",
      category: "documents",
      complete: docTypes.has("odometer_disclosure"),
      weight: 5,
    });

    // ── Vehicle readiness checks ────────────────────────────────────

    checklist.push({
      item: "VIN recorded",
      category: "vehicle",
      complete: !!(vehicle.vin && vehicle.vin.length >= 11),
      weight: 5,
    });

    checklist.push({
      item: "Photos uploaded (10+)",
      category: "vehicle",
      complete: (imageCount ?? 0) >= 10,
      weight: 4,
      detail: `${imageCount ?? 0} photos`,
    });

    // ── Calculate score ─────────────────────────────────────────────

    const totalWeight = checklist.reduce((s, c) => s + c.weight, 0);
    const completedWeight = checklist.reduce((s, c) => s + (c.complete ? c.weight : 0), 0);
    const score = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;

    const completedCount = checklist.filter((c) => c.complete).length;
    const totalCount = checklist.length;
    const completionPct = Math.round((completedCount / totalCount) * 100);

    const severity =
      score >= 60 ? "ok" : score >= 35 ? "warning" : "critical";

    const missingItems = checklist
      .filter((c) => !c.complete)
      .sort((a, b) => b.weight - a.weight);

    const headline = deal
      ? `Deal readiness ${completionPct}% (${completedCount}/${totalCount} items) — ${missingItems.length === 0 ? "ready to close" : `${missingItems.length} items remaining`}`
      : `No deal jacket — deal readiness cannot be evaluated`;

    const recommendations = missingItems.slice(0, 4).map((item, i) => ({
      action: item.item,
      priority: i + 1,
      rationale: `Category: ${item.category}. Weight: ${item.weight}/${totalWeight} of readiness score.`,
    }));

    // Group checklist by category
    const byCategory: Record<string, { complete: number; total: number; items: ChecklistItem[] }> = {};
    for (const item of checklist) {
      if (!byCategory[item.category]) {
        byCategory[item.category] = { complete: 0, total: 0, items: [] };
      }
      byCategory[item.category].total++;
      if (item.complete) byCategory[item.category].complete++;
      byCategory[item.category].items.push(item);
    }

    return json(200, {
      score,
      severity,
      headline,
      details: {
        completion_pct: completionPct,
        completed_items: completedCount,
        total_items: totalCount,
        missing_count: missingItems.length,
        checklist,
        by_category: Object.fromEntries(
          Object.entries(byCategory).map(([cat, data]) => [
            cat,
            { complete: data.complete, total: data.total, pct: Math.round((data.complete / data.total) * 100) },
          ])
        ),
        has_deal: !!deal,
        deal_id: deal?.id || null,
        document_types_present: [...docTypes],
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      },
      reasons: [headline],
      confidence: deal ? 0.8 : 0.3,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget deal-readiness error:", err);
    return json(500, { error: err.message });
  }
});

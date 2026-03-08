/**
 * WIDGET: BUYER QUALIFICATION SCORE
 *
 * Evaluates buyer readiness for a deal. Scores based on:
 * - Whether a buyer contact exists on the deal jacket
 * - Deposit status and speed
 * - Document completeness (bill of sale, title transfer)
 * - Payment history
 * - Communication signals (contact info completeness)
 *
 * POST /functions/v1/widget-buyer-qualification
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    // Get vehicle basics
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, asking_price, sale_price")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Get deal jackets for this vehicle
    const { data: deals } = await supabase
      .from("deal_jackets")
      .select("id, deal_type, sold_to_id, acquired_from_id, deposit_amount, deposit_date, sold_date, payment_method, payment_amount, payment_date, total_selling_price, gross_profit, consignment_rate, notes")
      .eq("vehicle_id", vehicle_id)
      .order("created_at", { ascending: false })
      .limit(5);

    // No deals = no buyer to qualify
    if (!deals?.length) {
      return json(200, {
        score: 50,
        severity: "info",
        headline: "No active deal — buyer qualification not applicable",
        details: {
          has_deal: false,
          vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        },
        reasons: ["No deal jacket found for this vehicle"],
        confidence: 0.3,
        recommendations: [],
      });
    }

    const deal = deals[0]; // Most recent deal
    let score = 0;
    const reasons: string[] = [];
    const recommendations: Array<{ action: string; priority: number; rationale: string }> = [];

    // 1. Buyer identified (0-20 points)
    let buyerScore = 0;
    let buyerContact: any = null;
    if (deal.sold_to_id) {
      const { data: buyer } = await supabase
        .from("deal_contacts")
        .select("full_name, email, phone_mobile, phone_home, phone_work, address, city, state")
        .eq("id", deal.sold_to_id)
        .single();

      if (buyer) {
        buyerContact = buyer;
        buyerScore = 10;
        reasons.push(`Buyer identified: ${buyer.full_name}`);

        // Contact completeness bonus
        const hasEmail = !!buyer.email;
        const hasPhone = !!(buyer.phone_mobile || buyer.phone_home || buyer.phone_work);
        const hasAddress = !!(buyer.address && buyer.city && buyer.state);

        if (hasEmail) buyerScore += 3;
        if (hasPhone) buyerScore += 3;
        if (hasAddress) buyerScore += 4;

        if (!hasEmail && !hasPhone) {
          recommendations.push({
            action: "Get buyer contact information (email and phone)",
            priority: 1,
            rationale: "No email or phone on file — communication will be difficult if issues arise.",
          });
        }
        if (!hasAddress) {
          recommendations.push({
            action: "Collect buyer's full address for title and registration",
            priority: 2,
            rationale: "Address needed for title transfer, registration, and shipping logistics.",
          });
        }
      }
    } else {
      reasons.push("No buyer assigned to deal");
      recommendations.push({
        action: "Identify and assign buyer contact to deal jacket",
        priority: 1,
        rationale: "Deal has no buyer contact — critical for closing.",
      });
    }
    score += buyerScore;

    // 2. Deposit status (0-25 points)
    let depositScore = 0;
    if (deal.deposit_amount && deal.deposit_amount > 0) {
      depositScore = 15;
      reasons.push(`Deposit received: $${Number(deal.deposit_amount).toLocaleString()}`);

      // Deposit as % of sale price
      const salePrice = deal.total_selling_price || vehicle.asking_price || 0;
      if (salePrice > 0) {
        const depositPct = (deal.deposit_amount / salePrice) * 100;
        if (depositPct >= 20) {
          depositScore = 25;
          reasons.push(`Strong deposit: ${Math.round(depositPct)}% of sale price`);
        } else if (depositPct >= 10) {
          depositScore = 20;
        } else {
          recommendations.push({
            action: `Increase deposit to at least 10-20% ($${Math.round(salePrice * 0.1).toLocaleString()}-$${Math.round(salePrice * 0.2).toLocaleString()})`,
            priority: 2,
            rationale: `Current deposit is only ${Math.round(depositPct)}% — higher deposit reduces walkaway risk.`,
          });
        }
      }

      // Deposit speed bonus
      if (deal.deposit_date) {
        depositScore = Math.min(25, depositScore + 2);
      }
    } else {
      reasons.push("No deposit received");
      recommendations.push({
        action: "Collect deposit to secure buyer commitment",
        priority: 1,
        rationale: "Deals without deposits have significantly higher fall-through rates.",
      });
    }
    score += depositScore;

    // 3. Payment progress (0-25 points)
    let paymentScore = 0;
    if (deal.payment_amount && deal.payment_amount > 0) {
      paymentScore = 20;
      reasons.push(`Payment received: $${Number(deal.payment_amount).toLocaleString()}`);
      if (deal.payment_date) paymentScore = 25;
    } else if (deal.sold_date) {
      paymentScore = 10;
      reasons.push("Sale completed but no payment recorded");
      recommendations.push({
        action: "Record payment transaction in deal jacket",
        priority: 2,
        rationale: "Sale date recorded but payment details missing — update for record keeping.",
      });
    }
    score += paymentScore;

    // 4. Deal documentation (0-20 points)
    const { data: docs } = await supabase
      .from("deal_documents")
      .select("document_type")
      .eq("vehicle_id", vehicle_id);

    let docScore = 0;
    const docTypes = new Set((docs ?? []).map((d: any) => d.document_type));
    const criticalDocs = ["bill_of_sale", "title", "odometer_disclosure"];
    const foundCritical = criticalDocs.filter((d) => docTypes.has(d));

    docScore = Math.min(20, foundCritical.length * 6 + (docTypes.size > 3 ? 2 : 0));

    if (foundCritical.length === criticalDocs.length) {
      reasons.push("All critical documents present");
    } else {
      const missing = criticalDocs.filter((d) => !docTypes.has(d));
      reasons.push(`Missing documents: ${missing.join(", ")}`);
      recommendations.push({
        action: `Obtain missing documents: ${missing.join(", ")}`,
        priority: missing.includes("title") ? 1 : 2,
        rationale: "Critical documents needed for legal transfer of ownership.",
      });
    }
    score += docScore;

    // 5. Deal completeness bonus (0-10 points)
    let completenessScore = 0;
    if (deal.deal_type) completenessScore += 2;
    if (deal.total_selling_price) completenessScore += 3;
    if (deal.payment_method) completenessScore += 3;
    if (deal.sold_date) completenessScore += 2;
    score += completenessScore;

    // Cap at 100
    score = Math.min(100, score);

    const severity =
      score >= 60 ? "ok" : score >= 35 ? "warning" : "critical";

    let headline: string;
    if (score >= 80) {
      headline = `Buyer qualification strong (${score}/100) — deal on track`;
    } else if (score >= 50) {
      headline = `Buyer qualification moderate (${score}/100) — ${recommendations.length} items need attention`;
    } else {
      headline = `Buyer qualification weak (${score}/100) — ${recommendations.length} critical items outstanding`;
    }

    // Sort recommendations by priority
    recommendations.sort((a, b) => a.priority - b.priority);

    return json(200, {
      score,
      severity,
      headline,
      details: {
        breakdown: {
          buyer_identified: { score: buyerScore, max: 20 },
          deposit_status: { score: depositScore, max: 25 },
          payment_progress: { score: paymentScore, max: 25 },
          documentation: { score: docScore, max: 20, types_present: [...docTypes] },
          deal_completeness: { score: completenessScore, max: 10 },
        },
        deal_id: deal.id,
        buyer: buyerContact
          ? { name: buyerContact.full_name, has_email: !!buyerContact.email, has_phone: !!(buyerContact.phone_mobile || buyerContact.phone_home) }
          : null,
        deposit: deal.deposit_amount ? { amount: Number(deal.deposit_amount), date: deal.deposit_date } : null,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      },
      reasons,
      confidence: deals.length > 0 ? 0.7 : 0.3,
      recommendations: recommendations.slice(0, 4),
    });
  } catch (err: any) {
    console.error("Widget buyer-qualification error:", err);
    return json(500, { error: err.message });
  }
});

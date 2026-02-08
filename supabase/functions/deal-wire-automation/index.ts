import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * deal-wire-automation
 *
 * Handles the deal lifecycle after an investor submits an inquiry:
 * 1. Records the deal offer
 * 2. Generates wire instructions
 * 3. Sends email with wire details + vehicle summary
 * 4. Updates deal status
 *
 * Actions:
 *   POST { action: "send_wire_instructions", deal_id }
 *   POST { action: "update_status", deal_id, status }
 *   POST { action: "get_deal", deal_id }
 */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const action = String((body as any)?.action || "");
    const dealId = String((body as any)?.deal_id || "");

    if (!action || !dealId) {
      return new Response(
        JSON.stringify({ error: "Provide action and deal_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch the deal
    const { data: deal, error: dealError } = await supabase
      .from("vehicle_deal_offers")
      .select("*")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch vehicle for context
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select(
        "id, year, make, model, trim, vin, mileage, color, nuke_estimate, asking_price, sale_price, condition_rating, overall_desirability_score",
      )
      .eq("id", deal.vehicle_id)
      .single();

    const vehicleTitle = vehicle
      ? `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""} ${vehicle.trim || ""}`.trim()
      : "Vehicle";

    // =====================================================================
    // ACTION: send_wire_instructions
    // =====================================================================
    if (action === "send_wire_instructions") {
      // Generate wire reference
      const wireRef = `NUKE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Wire instructions template
      const wireInstructions = {
        bank_name: "First Republic Bank",
        routing_number: "321081669",
        account_number: "XXXX-XXXX-4821",
        account_name: "Nuke Vehicle Platform LLC",
        swift_code: "FRBOUS6S",
        reference: wireRef,
        memo: `${vehicleTitle} - Deal ${dealId.slice(0, 8)}`,
        amount: deal.offer_amount,
        currency: "USD",
      };

      // Build email body
      const emailHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="border-bottom: 2px solid #000; padding-bottom: 16px; margin-bottom: 24px;">
            <div style="font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #666;">NUKE</div>
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Wire Transfer Instructions</div>
          </div>

          <div style="margin-bottom: 24px;">
            <div style="font-size: 18px; font-weight: 800; margin-bottom: 4px;">${vehicleTitle}</div>
            ${vehicle?.vin ? `<div style="font-size: 11px; color: #666;">VIN: ${vehicle.vin}</div>` : ""}
            ${vehicle?.mileage ? `<div style="font-size: 11px; color: #666;">${vehicle.mileage.toLocaleString()} miles</div>` : ""}
          </div>

          <div style="background: #f8f8f8; border: 2px solid #000; padding: 20px; margin-bottom: 24px;">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">
              Wire Details
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700; width: 140px;">Bank</td><td style="font-size: 11px;">${wireInstructions.bank_name}</td></tr>
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">Routing #</td><td style="font-size: 11px;">${wireInstructions.routing_number}</td></tr>
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">Account #</td><td style="font-size: 11px;">${wireInstructions.account_number}</td></tr>
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">Account Name</td><td style="font-size: 11px;">${wireInstructions.account_name}</td></tr>
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">SWIFT</td><td style="font-size: 11px;">${wireInstructions.swift_code}</td></tr>
              <tr style="border-top: 1px solid #ddd;"><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">Reference</td><td style="font-size: 11px; font-weight: 800;">${wireInstructions.reference}</td></tr>
              <tr><td style="padding: 6px 0; font-size: 11px; font-weight: 700;">Amount</td><td style="font-size: 14px; font-weight: 800;">$${Number(deal.offer_amount).toLocaleString()}</td></tr>
            </table>
          </div>

          <div style="font-size: 10px; color: #666; line-height: 1.6; margin-bottom: 24px;">
            <strong>Important:</strong> Include the reference number "${wireRef}" in your wire memo.
            Deposits are held in escrow until inspection and title transfer are complete.
            Contact us if you have questions about the wire process.
          </div>

          <div style="border-top: 1px solid #ddd; padding-top: 16px; font-size: 10px; color: #999; text-align: center;">
            Nuke Vehicle Platform &middot; Secure Transactions
          </div>
        </div>
      `;

      // Send via Supabase Auth (or log for now)
      // In production: integrate with SendGrid/Resend/etc
      console.log(`Wire instructions generated for deal ${dealId}:`);
      console.log(`  To: ${deal.buyer_email}`);
      console.log(`  Vehicle: ${vehicleTitle}`);
      console.log(`  Amount: $${deal.offer_amount}`);
      console.log(`  Wire Ref: ${wireRef}`);

      // Update deal record
      await supabase
        .from("vehicle_deal_offers")
        .update({
          wire_reference: wireRef,
          wire_instructions_sent_at: new Date().toISOString(),
          deal_status: "deposit_pending",
          metadata: {
            ...(deal.metadata || {}),
            wire_instructions: wireInstructions,
            email_html: emailHtml,
          },
        })
        .eq("id", dealId);

      return new Response(
        JSON.stringify({
          success: true,
          wire_reference: wireRef,
          wire_instructions: wireInstructions,
          email_preview: emailHtml,
          deal_status: "deposit_pending",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // ACTION: update_status
    // =====================================================================
    if (action === "update_status") {
      const newStatus = String((body as any)?.status || "");
      const validStatuses = [
        "inquiry", "offer_sent", "deposit_pending", "deposit_received",
        "under_contract", "financing", "inspection", "closed", "cancelled",
      ];

      if (!validStatuses.includes(newStatus)) {
        return new Response(
          JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const updateData: any = {
        deal_status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === "deposit_received") {
        updateData.deposit_status = "received";
        updateData.deposit_amount = deal.offer_amount;
      }

      if (newStatus === "closed") {
        updateData.deposit_status = "cleared";
      }

      if (newStatus === "cancelled") {
        updateData.deposit_status = deal.deposit_status === "received" ? "refunded" : "pending";
      }

      await supabase
        .from("vehicle_deal_offers")
        .update(updateData)
        .eq("id", dealId);

      return new Response(
        JSON.stringify({ success: true, deal_status: newStatus }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // ACTION: get_deal
    // =====================================================================
    if (action === "get_deal") {
      return new Response(
        JSON.stringify({
          deal,
          vehicle: vehicle
            ? {
                title: vehicleTitle,
                vin: vehicle.vin,
                mileage: vehicle.mileage,
                color: vehicle.color,
                nuke_estimate: vehicle.nuke_estimate,
                condition_rating: vehicle.condition_rating,
                desirability_score: vehicle.overall_desirability_score,
              }
            : null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("deal-wire-automation error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

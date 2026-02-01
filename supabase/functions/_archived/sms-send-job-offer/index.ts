/**
 * Send Job Offer via SMS
 *
 * POST {
 *   tech_phone_link_id: uuid,
 *   title: "Body work on 72 C10",
 *   shop_id: uuid,
 *   vehicle_id: uuid,
 *   pay_type: "hourly" | "flat" | "per_photo",
 *   pay_rate: 45.00,
 *   estimated_hours: 8,
 *   terms_url?: "https://...",
 *   expires_in_hours?: 24
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendSms(to: string, message: string): Promise<string | null> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromNumber) return null;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: fromNumber, Body: message }),
      }
    );
    const data = await response.json();
    return data.sid;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      tech_phone_link_id,
      title,
      shop_id,
      vehicle_id,
      pay_type,
      pay_rate,
      estimated_hours,
      terms_url,
      expires_in_hours = 48,
      offered_by,
    } = body;

    if (!tech_phone_link_id || !title || !pay_type || !pay_rate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get technician
    const { data: tech, error: techError } = await supabase
      .from("technician_phone_links")
      .select("id, phone_number, display_name")
      .eq("id", tech_phone_link_id)
      .single();

    if (techError || !tech) {
      return new Response(
        JSON.stringify({ error: "Technician not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Get shop name if provided
    let shopName = "a shop";
    if (shop_id) {
      const { data: shop } = await supabase
        .from("businesses")
        .select("business_name")
        .eq("id", shop_id)
        .single();
      if (shop) shopName = shop.business_name;
    }

    // Calculate estimated total
    const estimatedTotal = pay_type === "hourly" && estimated_hours
      ? pay_rate * estimated_hours
      : pay_rate;

    // Create job offer record
    const { data: offer, error: offerError } = await supabase
      .from("sms_job_offers")
      .insert({
        technician_phone_link_id: tech_phone_link_id,
        title,
        shop_id,
        vehicle_id,
        pay_type,
        pay_rate,
        estimated_hours,
        estimated_total: estimatedTotal,
        terms_url,
        offered_by,
        expires_at: new Date(Date.now() + expires_in_hours * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (offerError) {
      return new Response(
        JSON.stringify({ error: "Failed to create offer", details: offerError }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Format pay string
    let payStr = "";
    if (pay_type === "hourly") {
      payStr = `$${pay_rate}/hr`;
      if (estimated_hours) payStr += ` (~${estimated_hours}hrs, ~$${estimatedTotal})`;
    } else if (pay_type === "flat") {
      payStr = `$${pay_rate} flat`;
    } else if (pay_type === "per_photo") {
      payStr = `$${pay_rate}/photo`;
    }

    // Build message
    const message = `🔧 New job!\n${title} at ${shopName}\n${payStr}\nReply YES to accept, NO to pass.`;

    // Send SMS
    const messageSid = await sendSms(`+${tech.phone_number}`, message);

    // Update offer with message sid
    if (messageSid) {
      await supabase
        .from("sms_job_offers")
        .update({ status: "pending" })
        .eq("id", offer.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        offer_id: offer.id,
        message_sid: messageSid,
        sent_to: tech.display_name || tech.phone_number,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

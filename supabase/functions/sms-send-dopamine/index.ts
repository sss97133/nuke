/**
 * Send Dopamine Notifications via SMS
 *
 * Sends instant positive feedback for:
 * - Work logged
 * - Payment approved/sent/received
 * - Milestones achieved
 * - Weekly summaries
 *
 * POST {
 *   tech_phone_link_id: uuid,
 *   type: "work_logged" | "payment_approved" | "payment_sent" | "milestone" | "weekly_summary",
 *   data: { ... type-specific data }
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

async function getTemplate(key: string): Promise<string | null> {
  const { data } = await supabase
    .from("sms_message_templates")
    .select("template_text")
    .eq("template_key", key)
    .single();
  return data?.template_text || null;
}

function fillTemplate(template: string, vars: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tech_phone_link_id, type, data } = body;

    if (!tech_phone_link_id || !type) {
      return new Response(
        JSON.stringify({ error: "Missing tech_phone_link_id or type" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get technician
    const { data: tech, error: techError } = await supabase
      .from("technician_phone_links")
      .select("*")
      .eq("id", tech_phone_link_id)
      .single();

    if (techError || !tech) {
      return new Response(
        JSON.stringify({ error: "Technician not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    let message = "";
    let templateKey = "";

    switch (type) {
      case "work_logged":
        templateKey = "work_logged_full";
        message = fillTemplate(
          await getTemplate(templateKey) || "✅ {work_type} on {vehicle} logged! +${value} pending",
          {
            work_type: data.work_type || "Work",
            vehicle: data.vehicle || "your vehicle",
            value: data.value || "0",
          }
        );
        break;

      case "payment_approved":
        templateKey = "payout_approved";
        message = fillTemplate(
          await getTemplate(templateKey) || "💰 ${amount} approved! Sending to {method} now...",
          {
            amount: data.amount,
            method: tech.payment_method || "your account",
          }
        );
        break;

      case "payment_sent":
        templateKey = "payout_sent";
        const eta = data.eta || "soon";
        message = fillTemplate(
          await getTemplate(templateKey) || "✅ ${amount} sent to {handle}! Arrives {eta}",
          {
            amount: data.amount,
            handle: tech.payment_handle || tech.payment_method,
            eta,
          }
        );
        break;

      case "payment_received":
        templateKey = "payout_received";
        message = fillTemplate(
          await getTemplate(templateKey) || "🎉 ${amount} just landed! Nice work.",
          { amount: data.amount }
        );
        break;

      case "milestone":
        const milestoneType = data.milestone_type || "achievement";
        if (milestoneType.startsWith("photos_")) {
          templateKey = "milestone_photos";
          message = fillTemplate(
            await getTemplate(templateKey) || "🏆 MILESTONE: {count} photos logged!",
            { count: milestoneType.split("_")[1] }
          );
        } else if (milestoneType.startsWith("earned_")) {
          templateKey = "milestone_earned";
          message = fillTemplate(
            await getTemplate(templateKey) || "🏆 MILESTONE: ${amount} lifetime earnings!",
            { amount: milestoneType.split("_")[1] }
          );
        } else if (milestoneType.startsWith("streak_")) {
          templateKey = "milestone_streak";
          message = fillTemplate(
            await getTemplate(templateKey) || "🔥 {days} day streak!",
            { days: milestoneType.split("_")[1] }
          );
        }
        break;

      case "weekly_summary":
        templateKey = "weekly_summary";
        const streakMsg = data.streak > 0 ? `🔥 ${data.streak} day streak!` : "";
        message = fillTemplate(
          await getTemplate(templateKey) || "📊 This week: {photos} photos • {jobs} jobs • ${earned} earned.",
          {
            photos: data.photos || 0,
            jobs: data.jobs || 0,
            earned: data.earned || "0",
            streak_msg: streakMsg,
          }
        );
        break;

      default:
        return new Response(
          JSON.stringify({ error: "Unknown notification type" }),
          { status: 400, headers: corsHeaders }
        );
    }

    // Send SMS
    const phone = tech.phone_number.startsWith("+")
      ? tech.phone_number
      : `+${tech.phone_number}`;
    const messageSid = await sendSms(phone, message);

    // Log notification
    await supabase.from("payment_notifications").insert({
      technician_phone_link_id: tech_phone_link_id,
      notification_type: type,
      amount: data.amount || null,
      message_sent: message,
      message_sid: messageSid,
    });

    // Check for milestones after work_logged
    if (type === "work_logged") {
      const { data: milestones } = await supabase
        .rpc("check_technician_milestones", { p_tech_id: tech_phone_link_id });

      // Send milestone notifications for any new ones
      if (milestones?.length > 0) {
        for (const m of milestones) {
          if (m.just_achieved) {
            // Recursive call to send milestone notification
            await fetch(req.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tech_phone_link_id,
                type: "milestone",
                data: { milestone_type: m.milestone_type },
              }),
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_sid: messageSid,
        message_preview: message.substring(0, 50) + "...",
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

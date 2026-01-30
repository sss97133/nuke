/**
 * SMS Reminder Scheduler
 *
 * Called via cron or manually to:
 * 1. Check technicians who haven't submitted in a while
 * 2. Generate and queue personalized reminders
 * 3. Send scheduled reminders via Twilio
 *
 * Endpoint: POST /functions/v1/sms-reminder-scheduler
 * Actions: "generate" | "send" | "both"
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

interface TechnicianForReminder {
  id: string;
  phone_number: string;
  display_name: string | null;
  reminder_frequency: string;
  last_submission_at: string | null;
  last_reminder_sent_at: string | null;
  ai_personality: string;
  primary_shop_id: string | null;
  assigned_vehicles: string[];
}

// Generate reminders for technicians needing nudges
async function generateReminders(): Promise<number> {
  const now = new Date();
  let remindersCreated = 0;

  // Get active technicians who want reminders
  const { data: technicians } = await supabase
    .from("technician_phone_links")
    .select("*")
    .in("onboarding_status", ["verified", "active"])
    .neq("reminder_frequency", "none");

  if (!technicians?.length) return 0;

  for (const tech of technicians as TechnicianForReminder[]) {
    const lastSubmission = tech.last_submission_at
      ? new Date(tech.last_submission_at)
      : null;
    const lastReminder = tech.last_reminder_sent_at
      ? new Date(tech.last_reminder_sent_at)
      : null;

    // Skip if reminded recently (within 12 hours)
    if (lastReminder && now.getTime() - lastReminder.getTime() < 12 * 60 * 60 * 1000) {
      continue;
    }

    // Determine if they need a reminder based on frequency
    let shouldRemind = false;
    let reminderType = "daily_checkin";
    let scheduledFor = new Date();

    const hoursSinceSubmission = lastSubmission
      ? (now.getTime() - lastSubmission.getTime()) / (60 * 60 * 1000)
      : Infinity;

    switch (tech.reminder_frequency) {
      case "daily":
        // Remind if no submission in 24 hours
        shouldRemind = hoursSinceSubmission > 24;
        // Schedule for 9am local time (assuming PST for now)
        scheduledFor.setHours(9, 0, 0, 0);
        if (scheduledFor < now) scheduledFor.setDate(scheduledFor.getDate() + 1);
        break;

      case "twice_daily":
        // Remind if no submission in 10 hours
        shouldRemind = hoursSinceSubmission > 10;
        // Schedule for 9am or 2pm
        const hour = now.getHours();
        if (hour < 14) {
          scheduledFor.setHours(14, 0, 0, 0);
        } else {
          scheduledFor.setHours(9, 0, 0, 0);
          scheduledFor.setDate(scheduledFor.getDate() + 1);
        }
        break;

      case "per_session":
        // Only remind if they have active assignments and haven't submitted
        if (tech.assigned_vehicles?.length > 0 && hoursSinceSubmission > 8) {
          shouldRemind = true;
          reminderType = "vehicle_followup";
        }
        break;
    }

    if (!shouldRemind) continue;

    // Get template
    const { data: template } = await supabase
      .from("sms_message_templates")
      .select("template_text")
      .eq("template_key", reminderType)
      .eq("personality", tech.ai_personality || "friendly")
      .single();

    if (!template) continue;

    // Fill in variables
    let message = template.template_text;
    message = message.replace("{name}", tech.display_name || "Hey");

    // If vehicle followup, get vehicle info
    if (reminderType === "vehicle_followup" && tech.assigned_vehicles?.length > 0) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("year, make, model")
        .eq("id", tech.assigned_vehicles[0])
        .single();

      if (vehicle) {
        message = message.replace(
          "{vehicle}",
          `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        );
      }
    }

    // Create reminder
    const { error } = await supabase.from("sms_reminders").insert({
      technician_phone_link_id: tech.id,
      reminder_type: reminderType,
      message_template: message,
      scheduled_for: scheduledFor.toISOString(),
      status: "scheduled",
    });

    if (!error) remindersCreated++;
  }

  return remindersCreated;
}

// Send pending reminders
async function sendReminders(): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  let sent = 0;
  let failed = 0;

  // Get due reminders
  const { data: reminders } = await supabase
    .from("sms_reminders")
    .select(
      `
      *,
      technician_phone_links (phone_number, display_name)
    `
    )
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .limit(50);

  if (!reminders?.length) return { sent: 0, failed: 0 };

  for (const reminder of reminders) {
    const phone = (reminder as any).technician_phone_links?.phone_number;
    if (!phone) {
      await supabase
        .from("sms_reminders")
        .update({ status: "failed" })
        .eq("id", reminder.id);
      failed++;
      continue;
    }

    try {
      // Send via Twilio
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        },
        body: new URLSearchParams({
          To: phone,
          From: TWILIO_PHONE_NUMBER!,
          Body: reminder.message_template,
        }),
      });

      if (response.ok) {
        await supabase
          .from("sms_reminders")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", reminder.id);

        // Update last reminder time
        await supabase
          .from("technician_phone_links")
          .update({ last_reminder_sent_at: new Date().toISOString() })
          .eq("id", reminder.technician_phone_link_id);

        sent++;
      } else {
        const error = await response.text();
        console.error("Twilio error:", error);
        await supabase
          .from("sms_reminders")
          .update({ status: "failed" })
          .eq("id", reminder.id);
        failed++;
      }
    } catch (error) {
      console.error("Send error:", error);
      await supabase
        .from("sms_reminders")
        .update({ status: "failed" })
        .eq("id", reminder.id);
      failed++;
    }
  }

  return { sent, failed };
}

// Send a one-off message to a technician
async function sendDirect(
  techLinkId: string,
  message: string
): Promise<boolean> {
  const { data: tech } = await supabase
    .from("technician_phone_links")
    .select("phone_number")
    .eq("id", techLinkId)
    .single();

  if (!tech?.phone_number) return false;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
      body: new URLSearchParams({
        To: tech.phone_number,
        From: TWILIO_PHONE_NUMBER!,
        Body: message,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "both";

    const result: any = { action };

    if (action === "generate" || action === "both") {
      result.reminders_generated = await generateReminders();
    }

    if (action === "send" || action === "both") {
      const sendResult = await sendReminders();
      result.reminders_sent = sendResult.sent;
      result.reminders_failed = sendResult.failed;
    }

    if (action === "direct" && body.tech_link_id && body.message) {
      result.sent = await sendDirect(body.tech_link_id, body.message);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Scheduler error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

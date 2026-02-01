/**
 * Vault Request Access - Admin requests access to user's vaulted document
 *
 * When Nuke needs the original document (dispute, lender verification, audit):
 * 1. Admin/system creates access request with reason
 * 2. User receives push notification + SMS
 * 3. User approves/denies in native app
 * 4. If approved, user uploads encrypted document temporarily
 *
 * POST /functions/v1/vault-request-access
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Request expiry defaults
const DEFAULT_EXPIRY_HOURS = 72; // 3 days to respond
const MAX_EXPIRY_HOURS = 168; // 1 week max

// Types
interface AccessRequestInput {
  attestation_id: string;
  reason: string;
  context?: {
    dispute_id?: string;
    transaction_id?: string;
    audit_id?: string;
    lender_request?: boolean;
    urgency?: "low" | "normal" | "high";
  };
  expires_in_hours?: number;
}

// Send push notification
async function sendPushNotification(
  pushToken: string,
  platform: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<boolean> {
  // Use Expo Push API (works for both iOS and Android via Expo)
  // If using native builds, would need FCM/APNs directly

  const expoPushUrl = "https://exp.host/--/api/v2/push/send";

  try {
    const response = await fetch(expoPushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data,
        sound: "default",
        priority: "high",
        channelId: "vault-access-requests", // Android notification channel
      }),
    });

    if (!response.ok) {
      console.error("[Push] Expo push failed:", await response.text());
      return false;
    }

    const result = await response.json();
    console.log("[Push] Sent:", result);
    return true;
  } catch (e) {
    console.error("[Push] Error:", e);
    return false;
  }
}

// Send SMS notification
async function sendSmsNotification(
  phoneNumber: string,
  message: string
): Promise<boolean> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioFrom) {
    console.log("[SMS] Twilio not configured");
    return false;
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`,
          From: twilioFrom,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      console.error("[SMS] Send failed:", await response.text());
      return false;
    }

    return true;
  } catch (e) {
    console.error("[SMS] Error:", e);
    return false;
  }
}

// Check if user is admin/moderator
async function isAdminOrModerator(userId: string): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_type")
    .eq("id", userId)
    .single();

  return profile?.user_type === "admin" || profile?.user_type === "moderator";
}

// Get attestation with user details
async function getAttestationWithUser(attestationId: string): Promise<{
  attestation: {
    id: string;
    user_id: string;
    vin: string;
    document_type: string;
    title_number_masked: string | null;
    vehicle_id: string | null;
  };
  user: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
  };
  preferences: {
    notify_on_access_request: boolean;
    notify_via_sms: boolean;
    notify_via_push: boolean;
    push_token: string | null;
    push_token_platform: string | null;
  } | null;
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
  } | null;
} | null> {
  // Get attestation
  const { data: attestation, error } = await supabase
    .from("vault_attestations")
    .select("id, user_id, vin, document_type, title_number_masked, vehicle_id")
    .eq("id", attestationId)
    .single();

  if (error || !attestation) return null;

  // Get user profile
  const { data: user } = await supabase
    .from("profiles")
    .select("id, full_name, phone_number")
    .eq("id", attestation.user_id)
    .single();

  if (!user) return null;

  // Get user preferences
  const { data: preferences } = await supabase
    .from("vault_user_preferences")
    .select("notify_on_access_request, notify_via_sms, notify_via_push, push_token, push_token_platform")
    .eq("user_id", attestation.user_id)
    .single();

  // Get vehicle if linked
  let vehicle = null;
  if (attestation.vehicle_id) {
    const { data: v } = await supabase
      .from("vehicles")
      .select("year, make, model")
      .eq("id", attestation.vehicle_id)
      .single();
    vehicle = v;
  }

  return { attestation, user, preferences, vehicle };
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Authenticate request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice(7);
    const { data: { user: authUser } } = await supabase.auth.getUser(token);

    if (!authUser) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if requester is admin/moderator
    const isAdmin = await isAdminOrModerator(authUser.id);
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Only admins can request document access" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request
    const input: AccessRequestInput = await req.json();

    if (!input.attestation_id) {
      return new Response(
        JSON.stringify({ error: "attestation_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!input.reason || input.reason.length < 10) {
      return new Response(
        JSON.stringify({ error: "reason is required (min 10 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get attestation and user details
    const data = await getAttestationWithUser(input.attestation_id);
    if (!data) {
      return new Response(
        JSON.stringify({ error: "Attestation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { attestation, user, preferences, vehicle } = data;

    // Check for existing pending request
    const { data: existingRequest } = await supabase
      .from("vault_access_requests")
      .select("id, status, created_at")
      .eq("attestation_id", attestation.id)
      .eq("status", "pending")
      .single();

    if (existingRequest) {
      return new Response(
        JSON.stringify({
          error: "A pending request already exists for this document",
          existing_request_id: existingRequest.id,
          created_at: existingRequest.created_at,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate expiry
    const expiryHours = Math.min(
      input.expires_in_hours || DEFAULT_EXPIRY_HOURS,
      MAX_EXPIRY_HOURS
    );

    // Create access request
    const { data: request, error: insertError } = await supabase
      .from("vault_access_requests")
      .insert({
        attestation_id: attestation.id,
        requested_by: authUser.id,
        request_reason: input.reason,
        request_context: input.context || {},
        expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
      })
      .select("id, created_at, expires_at")
      .single();

    if (insertError) {
      console.error("[Request Access] Insert failed:", insertError);
      throw insertError;
    }

    console.log(`[Request Access] Created request ${request.id} for attestation ${attestation.id}`);

    // Send notifications based on user preferences
    const shouldNotify = preferences?.notify_on_access_request !== false; // Default true
    let notificationSent = false;
    let notificationChannel: string | null = null;

    if (shouldNotify) {
      const vehicleDesc = vehicle?.year && vehicle?.make
        ? `${vehicle.year} ${vehicle.make} ${vehicle.model || ""}`
        : `document (${attestation.document_type})`;

      // Try push notification first
      if (preferences?.notify_via_push !== false && preferences?.push_token) {
        const pushSent = await sendPushNotification(
          preferences.push_token,
          preferences.push_token_platform || "ios",
          "Document Access Request",
          `Nuke is requesting access to your ${vehicleDesc} ${attestation.document_type}.`,
          {
            type: "vault_access_request",
            request_id: request.id,
            attestation_id: attestation.id,
            reason: input.reason,
          }
        );

        if (pushSent) {
          notificationSent = true;
          notificationChannel = "push";
        }
      }

      // Also send SMS if enabled (or as fallback)
      if (preferences?.notify_via_sms !== false && user.phone_number) {
        const smsMessage =
          `Nuke requests access to your ${vehicleDesc} ${attestation.document_type}.\n\n` +
          `Reason: ${input.reason}\n\n` +
          `Open the Nuke Vault app to approve or deny.`;

        const smsSent = await sendSmsNotification(user.phone_number, smsMessage);

        if (smsSent) {
          notificationSent = true;
          notificationChannel = notificationChannel ? "both" : "sms";
        }
      }
    }

    // Update request with notification status
    if (notificationSent) {
      await supabase
        .from("vault_access_requests")
        .update({
          notification_sent_at: new Date().toISOString(),
          notification_channel: notificationChannel,
        })
        .eq("id", request.id);
    }

    // Audit log
    await supabase.from("pii_audit_log").insert({
      user_id: attestation.user_id,
      accessed_by: authUser.id,
      action: "vault_access_requested",
      resource_type: "vault_attestation",
      resource_id: attestation.id,
      access_reason: input.reason,
    });

    return new Response(
      JSON.stringify({
        success: true,
        request_id: request.id,
        attestation_id: attestation.id,
        user_id: attestation.user_id,
        expires_at: request.expires_at,
        notification: {
          sent: notificationSent,
          channel: notificationChannel,
        },
        message: notificationSent
          ? "Access request created and user notified"
          : "Access request created (no notification sent - check user preferences)",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Request Access] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

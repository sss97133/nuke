/**
 * SMS Work Intake - AI Assistant for Technician Photo Submissions
 *
 * Handles incoming SMS/MMS from Twilio:
 * 1. Receives photo + optional text
 * 2. Identifies vehicle and work type via AI
 * 3. Creates timeline event
 * 4. Responds with confirmation or follow-up questions
 *
 * Webhook URL: POST /functions/v1/sms-work-intake
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Twilio webhook sends form data
async function parseFormData(req: Request): Promise<Record<string, string>> {
  const formData = await req.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    data[key] = value.toString();
  }
  return data;
}

// Normalize phone number (remove + prefix for consistency)
function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '');
}

// Get or create technician link for this phone
async function getOrCreateTechLink(phone: string, inviterHint?: string) {
  const normalized = normalizePhone(phone);

  // Look up by normalized phone number
  const { data: existing } = await supabase
    .from("technician_phone_links")
    .select("*")
    .eq("phone_number", normalized)
    .single();

  if (existing) return existing;

  // New technician - create link
  const phoneHash = await hashPhone(normalized);
  const { data: newLink } = await supabase
    .from("technician_phone_links")
    .insert({
      phone_number: normalized,
      phone_hash: phoneHash,
      onboarding_status: "pending_verification",
    })
    .select()
    .single();

  return newLink;
}

async function hashPhone(phone: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phone);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Get conversation state
async function getConversation(techLinkId: string) {
  const { data } = await supabase
    .from("sms_conversations")
    .select("*")
    .eq("technician_phone_link_id", techLinkId)
    .single();

  if (data) return data;

  // Create new conversation
  const { data: newConv } = await supabase
    .from("sms_conversations")
    .insert({
      technician_phone_link_id: techLinkId,
      state: "idle",
      recent_messages: [],
    })
    .select()
    .single();

  return newConv;
}

// Get message template
async function getTemplate(
  key: string,
  personality = "friendly"
): Promise<string> {
  const { data } = await supabase
    .from("sms_message_templates")
    .select("template_text")
    .eq("template_key", key)
    .eq("personality", personality)
    .single();

  return data?.template_text || "";
}

// Fill in template variables
function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

// AI analysis of photo + text
async function analyzeSubmission(
  mediaUrls: string[],
  messageBody: string,
  context: {
    techName?: string;
    assignedVehicles?: any[];
    recentVehicles?: any[];
  }
): Promise<{
  vehicleHints: { year?: number; make?: string; model?: string; color?: string; vin?: string };
  workType: string;
  description: string;
  confidence: number;
  needsVehicleContext: boolean;
  needsWorkContext: boolean;
  isVinPhoto: boolean;
  detectedVin?: string;
}> {
  // Build context for AI
  const vehicleContext =
    context.assignedVehicles?.length > 0
      ? `Technician is currently assigned to: ${context.assignedVehicles.map((v: any) => `${v.year} ${v.make} ${v.model}`).join(", ")}`
      : context.recentVehicles?.length > 0
        ? `Recent vehicles worked on: ${context.recentVehicles.map((v: any) => `${v.year} ${v.make} ${v.model}`).join(", ")}`
        : "";

  const prompt = `You are analyzing a photo submission from an automotive technician documenting their work.

${vehicleContext}

Message from technician: "${messageBody || "(no text, just photo)"}"

Analyze the photo(s) and extract:
1. Check if this is a VIN plate/sticker photo - if so, read the VIN (17 characters)
2. Vehicle identification (year, make, model, color if visible)
3. Work type being performed (body_work, paint_prep, paint, mechanical, interior, electrical, suspension, engine, transmission, detailing, vin_photo, other)
4. Brief description of what's shown (1-2 sentences)
5. Confidence score (0.0-1.0)
6. Whether you need more context about which vehicle this is
7. Whether you need more context about what work is being done

Return JSON:
{
  "isVinPhoto": false,
  "detectedVin": null,
  "vehicleHints": { "year": null, "make": null, "model": null, "color": null },
  "workType": "body_work",
  "description": "Shows rust repair on driver side rocker panel",
  "confidence": 0.85,
  "needsVehicleContext": false,
  "needsWorkContext": false
}`;

  // Call Claude for analysis
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const imageContents = mediaUrls.map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  const result = await response.json();
  const text = result.content?.[0]?.text || "{}";

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse AI response:", e);
  }

  // Fallback
  return {
    vehicleHints: {},
    workType: "other",
    description: "Work photo received",
    confidence: 0.3,
    needsVehicleContext: true,
    needsWorkContext: true,
  };
}

// Try to match vehicle hints to existing vehicle
async function matchVehicle(
  hints: { year?: number; make?: string; model?: string },
  shopId?: string
): Promise<string | null> {
  if (!hints.year && !hints.make && !hints.model) return null;

  let query = supabase.from("vehicles").select("id").limit(5);

  if (hints.year) query = query.eq("year", hints.year);
  if (hints.make) query = query.ilike("make", `%${hints.make}%`);
  if (hints.model) query = query.ilike("model", `%${hints.model}%`);

  const { data } = await query;
  if (data?.length === 1) return data[0].id;

  return null;
}

// Send SMS notification (non-blocking)
async function sendSmsNotification(to: string, message: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromNumber) return;

  try {
    await fetch(
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
  } catch (e) {
    console.error("Failed to send notification:", e);
  }
}

// Notify shop owner/manager of work submission
async function notifyShopOwner(
  techLink: any,
  vehicleName: string,
  workType: string,
  imageUrl?: string
) {
  if (!techLink.primary_shop_id) return;

  // Get shop owner(s)
  const { data: owners } = await supabase
    .from("organization_contributors")
    .select("user_id, profiles!inner(phone_number)")
    .eq("organization_id", techLink.primary_shop_id)
    .eq("role", "owner");

  if (!owners?.length) return;

  const techName = techLink.display_name || "A tech";
  const message = `${techName} logged ${workType.replace(/_/g, " ")} on ${vehicleName}`;

  for (const owner of owners) {
    const phone = (owner as any).profiles?.phone_number;
    if (phone && phone !== techLink.phone_number) {
      await sendSmsNotification(phone, message);
    }
  }
}

// Create observation record for portfolio/behavior system
async function createObservation(
  vehicleId: string,
  techLink: any,
  submission: any
) {
  const observationData = {
    vehicle_id: vehicleId,
    source_slug: "sms_technician",
    kind: "work_performed",
    observed_at: submission.received_at || new Date().toISOString(),
    source_url: null,
    source_identifier: submission.message_sid,
    content_text: submission.detected_description,
    structured_data: {
      work_type: submission.detected_work_type,
      image_count: submission.media_urls?.length || 0,
      confidence: submission.confidence_score,
    },
    observer_raw: {
      technician_id: techLink.id,
      technician_name: techLink.display_name,
      phone_hash: techLink.phone_hash,
    },
    trust_score: techLink.onboarding_status === "active" ? 0.8 : 0.5,
  };

  await supabase.from("vehicle_observations").insert(observationData);
}

// Update contributor stats for portfolio building
async function updateContributorStats(techLink: any, workType: string) {
  if (!techLink.primary_shop_id || !techLink.user_id) return;

  // Update organization_contributors count
  await supabase.rpc("increment_contributor_count", {
    p_org_id: techLink.primary_shop_id,
    p_user_id: techLink.user_id,
  }).catch(() => {
    // RPC might not exist, update directly
    supabase
      .from("organization_contributors")
      .update({
        contribution_count: supabase.rpc("coalesce_increment", {
          current: "contribution_count",
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", techLink.primary_shop_id)
      .eq("user_id", techLink.user_id);
  });

  // Update tech specialties based on work type
  const currentSpecialties = techLink.specialties || [];
  if (!currentSpecialties.includes(workType)) {
    await supabase
      .from("technician_phone_links")
      .update({
        specialties: [...currentSpecialties, workType],
      })
      .eq("id", techLink.id);
  }
}

// Create timeline event from submission
async function createTimelineEvent(
  vehicleId: string,
  submission: any,
  techLink: any
) {
  // Get vehicle info for notifications
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("year, make, model")
    .eq("id", vehicleId)
    .single();

  const vehicleName = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : "vehicle";

  const eventData = {
    vehicle_id: vehicleId,
    event_type: "work_performed",
    event_title: `${submission.detected_work_type || "Work"} documented`,
    event_description: submission.detected_description,
    event_date: submission.received_at,
    source_type: "sms_submission",
    source_reference: submission.id,
    media_urls: submission.media_urls,
    created_by: techLink.user_id,
    metadata: {
      technician_phone_link_id: techLink.id,
      technician_name: techLink.display_name,
      ai_confidence: submission.confidence_score,
    },
  };

  const { data: event, error } = await supabase
    .from("vehicle_timeline")
    .insert(eventData)
    .select()
    .single();

  if (error) {
    console.error("Failed to create timeline event:", error);
    return null;
  }

  // Update submission with timeline event reference
  await supabase
    .from("sms_work_submissions")
    .update({
      timeline_event_id: event.id,
      processing_status: "logged",
    })
    .eq("id", submission.id);

  // === PORTFOLIO & NOTIFICATION HOOKS ===

  // 1. Create observation for behavior/portfolio system
  await createObservation(vehicleId, techLink, submission);

  // 2. Update contributor stats
  await updateContributorStats(techLink, submission.detected_work_type);

  // 3. Notify shop owner (non-blocking)
  notifyShopOwner(
    techLink,
    vehicleName,
    submission.detected_work_type,
    submission.media_urls?.[0]
  );

  // 4. Log behavior signal for org intelligence
  if (techLink.primary_shop_id) {
    await supabase.from("organization_behavior_signals").insert({
      business_id: techLink.primary_shop_id,
      signal_type: "work_documented",
      signal_source: "sms_submission",
      signal_data: {
        work_type: submission.detected_work_type,
        technician_id: techLink.id,
        vehicle_id: vehicleId,
      },
      weight: 1.0,
    }).catch(() => {}); // Ignore if table doesn't exist yet
  }

  return event;
}

// Generate TwiML response
function twimlResponse(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;

  return new Response(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Parse Twilio webhook data
    const data = await parseFormData(req);
    const fromPhone = data.From;
    const messageBody = data.Body || "";
    const messageSid = data.MessageSid;
    const numMedia = parseInt(data.NumMedia || "0", 10);

    // Extract media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = data[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    console.log(
      `SMS from ${fromPhone}: "${messageBody}" with ${numMedia} media`
    );

    // Get or create technician link
    const techLink = await getOrCreateTechLink(fromPhone);
    if (!techLink) {
      return twimlResponse(
        "Sorry, something went wrong. Please try again later."
      );
    }

    // Get conversation state
    const conversation = await getConversation(techLink.id);

    // ONBOARDING: New technician
    if (techLink.onboarding_status === "pending_verification") {
      if (!techLink.display_name) {
        // First message - welcome and ask for name
        const template = await getTemplate(
          "welcome",
          techLink.ai_personality || "friendly"
        );

        await supabase
          .from("sms_conversations")
          .update({
            state: "onboarding_name",
            last_message_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        return twimlResponse(template);
      }
    }

    // ONBOARDING: Getting name
    if (conversation.state === "onboarding_name") {
      const name = messageBody.trim().split(" ")[0]; // First word as name

      await supabase
        .from("technician_phone_links")
        .update({ display_name: name })
        .eq("id", techLink.id);

      const template = await getTemplate(
        "onboarding_payment",
        techLink.ai_personality || "friendly"
      );
      const response = fillTemplate(template, { name });

      await supabase
        .from("sms_conversations")
        .update({
          state: "onboarding_payment",
          context: { name },
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

      return twimlResponse(response);
    }

    // ONBOARDING: Getting payment method
    if (conversation.state === "onboarding_payment") {
      const body = messageBody.toLowerCase().trim();
      let paymentMethod = null;

      if (body.includes("venmo")) paymentMethod = "venmo";
      else if (body.includes("zelle")) paymentMethod = "zelle";
      else if (body.includes("paypal")) paymentMethod = "paypal";
      else if (body.includes("cashapp") || body.includes("cash app")) paymentMethod = "cashapp";
      else if (body.includes("check")) paymentMethod = "check";

      if (!paymentMethod) {
        return twimlResponse(
          "I didn't catch that. Venmo, Zelle, PayPal, CashApp, or check?"
        );
      }

      await supabase
        .from("technician_phone_links")
        .update({ payment_method: paymentMethod })
        .eq("id", techLink.id);

      // Ask for payment handle
      const methodLabels: Record<string, string> = {
        venmo: "Venmo @username",
        zelle: "Zelle email or phone",
        paypal: "PayPal email",
        cashapp: "CashApp $cashtag",
        check: "mailing address"
      };

      await supabase
        .from("sms_conversations")
        .update({
          state: "onboarding_payment_handle",
          context: { payment_method: paymentMethod },
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

      return twimlResponse(
        `Got it! What's your ${methodLabels[paymentMethod]}?`
      );
    }

    // ONBOARDING: Getting payment handle
    if (conversation.state === "onboarding_payment_handle") {
      const handle = messageBody.trim();

      await supabase
        .from("technician_phone_links")
        .update({
          payment_handle: handle,
          payment_verified: false, // Will verify on first payment
          onboarding_status: "verified",
          onboarding_step: "complete",
        })
        .eq("id", techLink.id);

      await supabase
        .from("sms_conversations")
        .update({
          state: "idle",
          context: {},
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

      const name = techLink.display_name || "friend";
      return twimlResponse(
        `Locked in! Payments go to ${handle}. You're all set ${name}! 🎉 Send work photos anytime.`
      );
    }

    // PROFILE PHOTO: User sends selfie anytime
    if (numMedia > 0 && messageBody.toLowerCase().includes("selfie") ||
        messageBody.toLowerCase().includes("profile pic") ||
        messageBody.toLowerCase().includes("my photo")) {
      // Save first image as avatar
      const avatarUrl = mediaUrls[0];
      await supabase
        .from("technician_phone_links")
        .update({ avatar_url: avatarUrl })
        .eq("id", techLink.id);

      return twimlResponse(
        `Looking good ${techLink.display_name || ""}! Profile pic saved. 📸`
      );
    }

    // WORK SUBMISSION: Has media
    if (numMedia > 0) {
      // For batch submissions (2+ photos), use the batch processor
      if (numMedia >= 2) {
        try {
          const batchResponse = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/work-intake-batch`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({
                techLinkId: techLink.id,
                mediaUrls,
                messageBody,
                source: "sms",
              }),
            }
          );
          const batchResult = await batchResponse.json();
          if (batchResult.success) {
            return twimlResponse(batchResult.message);
          }
        } catch (e) {
          console.error("Batch processing failed, falling back:", e);
        }
      }

      // Single photo or batch fallback - original flow
      // Create submission record
      const { data: submission } = await supabase
        .from("sms_work_submissions")
        .insert({
          technician_phone_link_id: techLink.id,
          from_phone: fromPhone,
          message_sid: messageSid,
          message_body: messageBody,
          media_urls: mediaUrls,
          processing_status: "processing",
        })
        .select()
        .single();

      // Update stats
      await supabase
        .from("technician_phone_links")
        .update({
          photos_submitted: (techLink.photos_submitted || 0) + numMedia,
          last_submission_at: new Date().toISOString(),
          onboarding_status: "active",
        })
        .eq("id", techLink.id);

      // Get assigned vehicles for context
      const { data: assignments } = await supabase
        .from("vehicle_tech_assignments")
        .select(
          `
          vehicle_id,
          vehicles (id, year, make, model)
        `
        )
        .eq("technician_phone_link_id", techLink.id)
        .eq("status", "active");

      const assignedVehicles = assignments?.map((a: any) => a.vehicles) || [];

      // Analyze with AI
      const analysis = await analyzeSubmission(mediaUrls, messageBody, {
        techName: techLink.display_name,
        assignedVehicles,
      });

      // Update submission with analysis
      await supabase
        .from("sms_work_submissions")
        .update({
          ai_processed_at: new Date().toISOString(),
          ai_interpretation: analysis,
          confidence_score: analysis.confidence,
          detected_vehicle_hints: analysis.vehicleHints,
          detected_work_type: analysis.workType,
          detected_description: analysis.description,
          processing_status: analysis.needsVehicleContext
            ? "needs_context"
            : "processed",
        })
        .eq("id", submission.id);

      // Try to match vehicle
      let vehicleId = await matchVehicle(
        analysis.vehicleHints,
        techLink.primary_shop_id
      );

      // If only one assigned vehicle and high confidence, use it
      if (!vehicleId && assignedVehicles.length === 1 && analysis.confidence > 0.5) {
        vehicleId = assignedVehicles[0].id;
      }

      if (vehicleId && !analysis.needsWorkContext) {
        // We have everything - create timeline event
        await supabase
          .from("sms_work_submissions")
          .update({ detected_vehicle_id: vehicleId })
          .eq("id", submission.id);

        const event = await createTimelineEvent(
          vehicleId,
          { ...submission, ...analysis, media_urls: mediaUrls },
          techLink
        );

        if (event) {
          const template = await getTemplate(
            "photo_received",
            techLink.ai_personality || "friendly"
          );
          const vehicle = assignedVehicles.find((v: any) => v.id === vehicleId);
          const vehicleName = vehicle
            ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
            : "your vehicle";

          const response = fillTemplate(template, {
            work_type: analysis.workType.replace(/_/g, " "),
            vehicle: vehicleName,
          });

          return twimlResponse(response);
        }
      }

      // Need more context - ask for VIN photo
      if (analysis.needsVehicleContext) {
        await supabase
          .from("sms_conversations")
          .update({
            state: "awaiting_vin",
            context: {
              pending_submission_id: submission.id,
              request_sent_at: new Date().toISOString(), // Track for responsiveness
            },
            last_message_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        return twimlResponse(
          "Nice work! Can you snap a pic of the VIN plate so I can link this to the right vehicle?"
        );
      }

      // Need work context
      if (analysis.needsWorkContext) {
        await supabase
          .from("sms_conversations")
          .update({
            state: "awaiting_work_type",
            context: { pending_submission_id: submission.id },
            last_message_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        const template = await getTemplate(
          "need_work_context",
          techLink.ai_personality || "friendly"
        );
        return twimlResponse(template);
      }

      // Generic confirmation
      return twimlResponse(
        `Got it! ${analysis.description} Adding to the timeline. 👍`
      );
    }

    // Track responsiveness when tech responds to a request
    async function trackResponsiveness(techLinkId: string, requestSentAt: string) {
      const responseTime = Date.now() - new Date(requestSentAt).getTime();
      const responseMinutes = Math.round(responseTime / 60000);

      // Update average response time
      const { data: techData } = await supabase
        .from("technician_phone_links")
        .select("metadata")
        .eq("id", techLinkId)
        .single();

      const metadata = techData?.metadata || {};
      const prevResponses = metadata.response_times || [];
      const newResponses = [...prevResponses.slice(-9), responseMinutes]; // Keep last 10
      const avgResponse = Math.round(
        newResponses.reduce((a: number, b: number) => a + b, 0) / newResponses.length
      );

      await supabase
        .from("technician_phone_links")
        .update({
          metadata: {
            ...metadata,
            response_times: newResponses,
            avg_response_minutes: avgResponse,
            last_response_minutes: responseMinutes,
            total_requests_answered: (metadata.total_requests_answered || 0) + 1,
          },
        })
        .eq("id", techLinkId);
    }

    // Handle VIN photo response
    if (conversation.state === "awaiting_vin" && numMedia > 0) {
      const pendingId = conversation.context?.pending_submission_id;
      const requestSentAt = conversation.context?.request_sent_at;

      // Track responsiveness
      if (requestSentAt) {
        await trackResponsiveness(techLink.id, requestSentAt);
      }

      // Analyze for VIN
      const vinAnalysis = await analyzeSubmission(mediaUrls, messageBody, {
        techName: techLink.display_name,
      });

      if (vinAnalysis.isVinPhoto && vinAnalysis.detectedVin) {
        // Look up or create vehicle by VIN
        let { data: vehicle } = await supabase
          .from("vehicles")
          .select("id, year, make, model")
          .eq("vin", vinAnalysis.detectedVin)
          .single();

        if (!vehicle && vinAnalysis.vehicleHints) {
          // Create new vehicle from VIN decode
          const { data: newVehicle } = await supabase
            .from("vehicles")
            .insert({
              vin: vinAnalysis.detectedVin,
              year: vinAnalysis.vehicleHints.year,
              make: vinAnalysis.vehicleHints.make,
              model: vinAnalysis.vehicleHints.model,
              discovered_via: "sms_vin_photo",
            })
            .select()
            .single();
          vehicle = newVehicle;
        }

        if (vehicle && pendingId) {
          // Link pending submission to vehicle
          const { data: pendingSubmission } = await supabase
            .from("sms_work_submissions")
            .select("*")
            .eq("id", pendingId)
            .single();

          if (pendingSubmission) {
            await supabase
              .from("sms_work_submissions")
              .update({ detected_vehicle_id: vehicle.id })
              .eq("id", pendingId);

            await createTimelineEvent(vehicle.id, pendingSubmission, techLink);

            // Assign tech to this vehicle for future reference
            await supabase.from("vehicle_tech_assignments").upsert({
              vehicle_id: vehicle.id,
              technician_phone_link_id: techLink.id,
              status: "active",
              assigned_at: new Date().toISOString(),
            }, { onConflict: "vehicle_id,technician_phone_link_id" });

            await supabase
              .from("sms_conversations")
              .update({ state: "idle", context: {} })
              .eq("id", conversation.id);

            const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
            return twimlResponse(
              `Got it! Linked to ${vehicleName} (VIN: ...${vinAnalysis.detectedVin.slice(-6)}). Your previous work is now logged. 👍`
            );
          }
        }
      }

      // Couldn't read VIN
      return twimlResponse(
        "Hmm, couldn't read the VIN clearly. Can you try another angle? Or just tell me the year/make/model."
      );
    }

    // TEXT ONLY: Handle follow-up responses (year/make/model or awaiting_vehicle)
    if (conversation.state === "awaiting_vehicle" || conversation.state === "awaiting_vin") {
      const pendingId = conversation.context?.pending_submission_id;
      const requestSentAt = conversation.context?.request_sent_at;

      // Track responsiveness
      if (requestSentAt) {
        await trackResponsiveness(techLink.id, requestSentAt);
      }

      // Simple parsing: look for year + make + model pattern
      const yearMatch = messageBody.match(/\b(19|20)\d{2}\b/);
      const words = messageBody.split(/\s+/).filter((w) => w.length > 2);

      const vehicleHints = {
        year: yearMatch ? parseInt(yearMatch[0], 10) : undefined,
        make: words[0] || undefined,
        model: words.slice(1).join(" ") || undefined,
      };

      const vehicleId = await matchVehicle(vehicleHints, techLink.primary_shop_id);

      if (pendingId) {
        await supabase
          .from("sms_work_submissions")
          .update({
            detected_vehicle_id: vehicleId,
            detected_vehicle_hints: vehicleHints,
          })
          .eq("id", pendingId);

        if (vehicleId) {
          // Get the pending submission
          const { data: pendingSubmission } = await supabase
            .from("sms_work_submissions")
            .select("*")
            .eq("id", pendingId)
            .single();

          if (pendingSubmission) {
            await createTimelineEvent(vehicleId, pendingSubmission, techLink);

            await supabase
              .from("sms_conversations")
              .update({ state: "idle", context: {} })
              .eq("id", conversation.id);

            return twimlResponse(
              `Logged! Added to the ${vehicleHints.year || ""} ${vehicleHints.make || ""} ${vehicleHints.model || ""} timeline.`
            );
          }
        }
      }

      await supabase
        .from("sms_conversations")
        .update({ state: "idle", context: {} })
        .eq("id", conversation.id);

      return twimlResponse(
        "Got it! I'll remember that. Send another photo when you have more progress."
      );
    }

    // JOB OFFER RESPONSE: YES/NO/ACCEPT
    const bodyLower = messageBody.toLowerCase().trim();
    if (bodyLower === "yes" || bodyLower === "no" || bodyLower === "accept") {
      // Check for pending job offer
      const { data: pendingJob } = await supabase
        .from("sms_job_offers")
        .select("*")
        .eq("technician_phone_link_id", techLink.id)
        .eq("status", "pending")
        .order("offered_at", { ascending: false })
        .limit(1)
        .single();

      if (pendingJob) {
        if (bodyLower === "yes") {
          // Accept job, ask for terms acceptance
          await supabase
            .from("sms_job_offers")
            .update({
              status: "accepted",
              responded_at: new Date().toISOString(),
              response_method: "sms",
            })
            .eq("id", pendingJob.id);

          if (pendingJob.terms_url) {
            await supabase
              .from("sms_conversations")
              .update({
                state: "awaiting_terms",
                context: { job_id: pendingJob.id },
                last_message_at: new Date().toISOString(),
              })
              .eq("id", conversation.id);

            return twimlResponse(
              `Great! Before we start, check out the terms: ${pendingJob.terms_url} - Reply ACCEPT when ready.`
            );
          }

          // No terms needed
          await supabase
            .from("technician_phone_links")
            .update({ lifetime_jobs: (techLink.lifetime_jobs || 0) + 1 })
            .eq("id", techLink.id);

          return twimlResponse(
            `You're on! ${pendingJob.title} is yours. 🔧 Details coming soon.`
          );
        } else if (bodyLower === "no") {
          await supabase
            .from("sms_job_offers")
            .update({
              status: "declined",
              responded_at: new Date().toISOString(),
              response_method: "sms",
            })
            .eq("id", pendingJob.id);

          return twimlResponse(
            "No worries. I'll hit you up when something better comes along."
          );
        } else if (bodyLower === "accept" && conversation.state === "awaiting_terms") {
          // Terms accepted
          await supabase
            .from("sms_job_offers")
            .update({
              terms_accepted: true,
              terms_accepted_at: new Date().toISOString(),
            })
            .eq("id", pendingJob.id);

          await supabase
            .from("technician_phone_links")
            .update({
              terms_accepted_at: new Date().toISOString(),
              lifetime_jobs: (techLink.lifetime_jobs || 0) + 1,
            })
            .eq("id", techLink.id);

          await supabase
            .from("sms_conversations")
            .update({ state: "idle", context: {} })
            .eq("id", conversation.id);

          return twimlResponse(
            `Terms accepted. Let's get to work! 💪 ${pendingJob.title} starts soon.`
          );
        }
      }
    }

    // MAGIC LINK REQUEST: "login" or "link"
    if (bodyLower === "login" || bodyLower === "link" || bodyLower === "log in") {
      // Generate magic link
      const { data: tokenData } = await supabase
        .rpc("generate_magic_link", { p_tech_id: techLink.id });

      if (tokenData) {
        const baseUrl = Deno.env.get("PUBLIC_URL") || "https://n-zero.dev";
        const link = `${baseUrl}/auth/magic?token=${tokenData}`;
        return twimlResponse(`Tap to log in (15 min): ${link}`);
      }
      return twimlResponse("Hmm, couldn't generate a link. Try again?");
    }

    // Default: casual text, no action needed
    const name = techLink.display_name || "there";
    return twimlResponse(
      `Hey ${name}! Send me a photo of your work and I'll log it for you.`
    );
  } catch (error) {
    console.error("SMS intake error:", error);
    return twimlResponse("Oops, something went wrong. Try sending that again?");
  }
});

/**
 * Vault SMS Webhook - Privacy-First Document Processing
 *
 * Three-tier privacy system:
 * 1. QUICK (Tier 1): Server processes document (fastest, least private)
 * 2. PRIVATE (Tier 2): PWA on-device processing (medium privacy)
 * 3. VAULT (Tier 3): Native app vault (maximum privacy)
 *
 * Flow:
 * 1. User texts document photo
 * 2. System prompts for privacy tier selection
 * 3. Routes to appropriate processing pipeline
 *
 * POST /functions/v1/vault-sms-webhook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Configuration
const PWA_BASE_URL = Deno.env.get("VAULT_PWA_URL") || "https://n-zero.dev/vault";
const APP_STORE_URL = "https://apps.apple.com/app/nuke-vault/id000000000";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.nuke.vault";
const SESSION_EXPIRY_HOURS = 1;

// Types
interface VaultSession {
  id: string;
  phone_number: string;
  user_id: string | null;
  state: string;
  last_image_url: string | null;
  selected_tier: string | null;
  pwa_session_token: string | null;
  context: Record<string, unknown>;
}

// Parse Twilio form data
async function parseFormData(req: Request): Promise<Record<string, string>> {
  const formData = await req.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    data[key] = value.toString();
  }
  return data;
}

// Normalize phone number
function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, "");
}

// TwiML response
function twiml(message: string): Response {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${escaped}</Message></Response>`;
  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

// Get user by phone
async function getUserByPhone(phone: string): Promise<{ id: string; full_name?: string } | null> {
  const normalized = normalizePhone(phone);
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("phone_number", normalized)
    .single();
  return profile;
}

// Get or create SMS session
async function getOrCreateSession(phone: string): Promise<VaultSession> {
  const normalized = normalizePhone(phone);

  // Try to find active session
  const { data: existing } = await supabase
    .from("vault_sms_sessions")
    .select("*")
    .eq("phone_number", normalized)
    .not("state", "in", '("completed","expired")')
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return existing as VaultSession;
  }

  // Get user if exists
  const user = await getUserByPhone(phone);

  // Create new session with generated PWA token
  const { data: newSession, error } = await supabase
    .from("vault_sms_sessions")
    .insert({
      phone_number: normalized,
      user_id: user?.id || null,
      state: "awaiting_image",
      expires_at: new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create session:", error);
    throw error;
  }

  return newSession as VaultSession;
}

// Update session
async function updateSession(
  sessionId: string,
  updates: Partial<VaultSession>
): Promise<VaultSession> {
  const { data, error } = await supabase
    .from("vault_sms_sessions")
    .update(updates)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error) throw error;
  return data as VaultSession;
}

// Get user's default privacy tier preference
async function getUserPreferences(userId: string): Promise<{
  default_tier: string;
  always_ask: boolean;
} | null> {
  const { data } = await supabase
    .from("vault_user_preferences")
    .select("default_tier, always_ask")
    .eq("user_id", userId)
    .single();
  return data;
}

// Process with Quick mode (Tier 1) - Server-side processing
async function processQuickMode(session: VaultSession): Promise<Response> {
  if (!session.last_image_url) {
    return twiml("No image found. Please send a document photo first.");
  }

  // Update session state
  await updateSession(session.id, {
    state: "processing_quick",
    selected_tier: "quick",
    context: { ...session.context, tier_selected_at: new Date().toISOString() },
  });

  // Call detect-sensitive-document for processing
  const detectUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/detect-sensitive-document`;

  try {
    const response = await fetch(detectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        imageUrl: session.last_image_url,
        userId: session.user_id,
        source: "vault_sms",
        sessionId: session.id,
      }),
    });

    const result = await response.json();

    if (result.error) {
      await updateSession(session.id, {
        state: "completed",
        context: { ...session.context, error: result.error },
      });
      return twiml(`Couldn't process that document. ${result.error}`);
    }

    // Success - update session with results
    await updateSession(session.id, {
      state: "completed",
      result_vehicle_id: result.vehicleId || null,
      context: {
        ...session.context,
        extraction_result: result,
        completed_at: new Date().toISOString(),
      },
    });

    // Log to audit
    if (session.user_id) {
      await supabase.from("pii_audit_log").insert({
        user_id: session.user_id,
        action: "vault_tier_selected",
        resource_type: "vault_sms_session",
        resource_id: session.id,
        access_reason: "User selected quick mode for document processing",
      });
    }

    // Format response
    if (result.documentType === "title" && result.extractedData) {
      const data = result.extractedData;
      return twiml(
        `Title processed!\n\n` +
          `VIN: ${data.vin || "detected"}\n` +
          `Owner: ${data.owner_name || "detected"}\n` +
          `State: ${data.state || "N/A"}\n\n` +
          `Confidence: ${Math.round((result.confidence || 0) * 100)}%`
      );
    }

    return twiml(
      `Document processed!\n` +
        `Type: ${result.documentType || "Unknown"}\n` +
        `Confidence: ${Math.round((result.confidence || 0) * 100)}%`
    );
  } catch (e) {
    console.error("Quick mode processing error:", e);
    await updateSession(session.id, {
      state: "completed",
      context: { ...session.context, error: String(e) },
    });
    return twiml("Processing failed. Please try again.");
  }
}

// Send PWA link (Tier 2) - On-device processing
async function sendPwaLink(session: VaultSession): Promise<Response> {
  // Generate PWA session token if not exists
  let pwaToken = session.pwa_session_token;
  if (!pwaToken) {
    // Generate token
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    pwaToken = "pwa_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Update session
  await updateSession(session.id, {
    state: "awaiting_pwa_completion",
    selected_tier: "private",
    pwa_session_token: pwaToken,
    context: {
      ...session.context,
      tier_selected_at: new Date().toISOString(),
      pwa_link_sent_at: new Date().toISOString(),
    },
  });

  // Log to audit
  if (session.user_id) {
    await supabase.from("pii_audit_log").insert({
      user_id: session.user_id,
      action: "vault_tier_selected",
      resource_type: "vault_sms_session",
      resource_id: session.id,
      access_reason: "User selected private mode (PWA) for document processing",
    });
  }

  const pwaUrl = `${PWA_BASE_URL}/scan?token=${pwaToken}`;

  return twiml(
    `Private mode selected.\n\n` +
      `Open this link to process your document on your phone:\n\n` +
      `${pwaUrl}\n\n` +
      `Your image never leaves your device. Only extracted text is sent.`
  );
}

// Send app download link (Tier 3) - Maximum privacy
async function sendAppDownload(session: VaultSession): Promise<Response> {
  // Update session
  await updateSession(session.id, {
    state: "awaiting_app_submission",
    selected_tier: "vault",
    context: {
      ...session.context,
      tier_selected_at: new Date().toISOString(),
      app_link_sent_at: new Date().toISOString(),
    },
  });

  // Log to audit
  if (session.user_id) {
    await supabase.from("pii_audit_log").insert({
      user_id: session.user_id,
      action: "vault_tier_selected",
      resource_type: "vault_sms_session",
      resource_id: session.id,
      access_reason: "User selected vault mode (native app) for document processing",
    });
  }

  return twiml(
    `Vault mode - Maximum privacy.\n\n` +
      `Download the Nuke Vault app:\n\n` +
      `iOS: ${APP_STORE_URL}\n\n` +
      `Android: ${PLAY_STORE_URL}\n\n` +
      `Your document stays encrypted on your device. We only receive cryptographic proof.`
  );
}

// Handle help command
function handleHelp(): Response {
  return twiml(
    `Nuke Document Vault\n\n` +
      `Send a photo of your document (title, registration, etc.)\n\n` +
      `Then choose privacy level:\n` +
      `1 = Quick (we process)\n` +
      `2 = Private (on your phone)\n` +
      `3 = Vault (max privacy)\n\n` +
      `Text PRIVACY for more info.`
  );
}

// Handle privacy info command
function handlePrivacyInfo(): Response {
  return twiml(
    `Privacy Levels:\n\n` +
      `1. QUICK: Fast. We process your doc on our servers. Stored securely.\n\n` +
      `2. PRIVATE: Your image stays on your phone. Only extracted text (VIN, etc.) is sent.\n\n` +
      `3. VAULT: Maximum security. Image stored locally, encrypted. We only get cryptographic proof it exists.`
  );
}

// Main handler
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const data = await parseFormData(req);
    const fromPhone = data.From;
    const messageBody = (data.Body || "").trim();
    const numMedia = parseInt(data.NumMedia || "0", 10);

    // Extract media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = data[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    console.log(`[Vault SMS] From: ${fromPhone}, Body: "${messageBody}", Media: ${numMedia}`);

    // Handle commands
    const lowerBody = messageBody.toLowerCase();
    if (lowerBody === "help" || lowerBody === "?") {
      return handleHelp();
    }
    if (lowerBody === "privacy" || lowerBody === "info") {
      return handlePrivacyInfo();
    }

    // Get or create session
    const session = await getOrCreateSession(fromPhone);
    console.log(`[Vault SMS] Session: ${session.id}, State: ${session.state}`);

    // State machine
    switch (session.state) {
      case "awaiting_image": {
        if (numMedia > 0) {
          // Image received, prompt for tier selection
          await updateSession(session.id, {
            state: "awaiting_tier_selection",
            last_image_url: mediaUrls[0],
            context: {
              ...session.context,
              image_received_at: new Date().toISOString(),
              media_count: numMedia,
            },
          });

          // Check if user has a default preference and doesn't want to be asked
          if (session.user_id) {
            const prefs = await getUserPreferences(session.user_id);
            if (prefs && !prefs.always_ask && prefs.default_tier) {
              // Auto-select their default tier
              switch (prefs.default_tier) {
                case "quick":
                  return await processQuickMode(session);
                case "private":
                  return await sendPwaLink(session);
                case "vault":
                  return await sendAppDownload(session);
              }
            }
          }

          return twiml(
            `Got your document!\n\n` +
              `Choose privacy level:\n\n` +
              `1 - QUICK\n` +
              `    We process it (fastest)\n\n` +
              `2 - PRIVATE\n` +
              `    Process on your phone\n\n` +
              `3 - VAULT\n` +
              `    Download app (max privacy)\n\n` +
              `Reply 1, 2, or 3`
          );
        }

        // No image, ask for one
        return twiml(
          `Send a photo of your document (title, registration, etc.) to get started.\n\n` +
            `Text HELP for more info.`
        );
      }

      case "awaiting_tier_selection": {
        // Handle tier selection
        const choice = messageBody.trim();

        if (choice === "1") {
          return await processQuickMode(session);
        }
        if (choice === "2") {
          return await sendPwaLink(session);
        }
        if (choice === "3") {
          return await sendAppDownload(session);
        }

        // If they send another image, update it
        if (numMedia > 0) {
          await updateSession(session.id, {
            last_image_url: mediaUrls[0],
            context: {
              ...session.context,
              image_received_at: new Date().toISOString(),
            },
          });
          return twiml(
            `Updated! Now choose:\n\n` +
              `1 = Quick (we process)\n` +
              `2 = Private (your phone)\n` +
              `3 = Vault (max privacy)\n\n` +
              `Reply 1, 2, or 3`
          );
        }

        // Invalid input
        return twiml(
          `Reply 1, 2, or 3 to choose:\n\n` +
            `1 = Quick\n` +
            `2 = Private\n` +
            `3 = Vault`
        );
      }

      case "awaiting_pwa_completion": {
        // They might be sending a new document or asking about status
        if (numMedia > 0) {
          // New document - start fresh
          await updateSession(session.id, {
            state: "awaiting_tier_selection",
            last_image_url: mediaUrls[0],
            context: {
              ...session.context,
              new_image_received_at: new Date().toISOString(),
            },
          });
          return twiml(
            `New document received!\n\n` +
              `Choose privacy level:\n` +
              `1 = Quick | 2 = Private | 3 = Vault`
          );
        }

        // Status check or reminder
        const pwaUrl = `${PWA_BASE_URL}/scan?token=${session.pwa_session_token}`;
        return twiml(
          `Still waiting for you to process via the PWA.\n\n` +
            `Open: ${pwaUrl}\n\n` +
            `Or text a new document to start over.`
        );
      }

      case "awaiting_app_submission": {
        // Similar handling
        if (numMedia > 0) {
          await updateSession(session.id, {
            state: "awaiting_tier_selection",
            last_image_url: mediaUrls[0],
            context: {
              ...session.context,
              new_image_received_at: new Date().toISOString(),
            },
          });
          return twiml(
            `New document received!\n\n` +
              `Choose privacy level:\n` +
              `1 = Quick | 2 = Private | 3 = Vault`
          );
        }

        return twiml(
          `Download the Nuke Vault app to submit securely.\n\n` +
            `iOS: ${APP_STORE_URL}\n\n` +
            `Or text a new document to start over.`
        );
      }

      case "processing_quick": {
        // In progress
        return twiml(
          `Still processing your document. You'll get a response shortly.`
        );
      }

      case "completed": {
        // Start new session if they send something
        if (numMedia > 0) {
          // Create new session
          const newSession = await getOrCreateSession(fromPhone);
          await updateSession(newSession.id, {
            state: "awaiting_tier_selection",
            last_image_url: mediaUrls[0],
          });
          return twiml(
            `New document received!\n\n` +
              `Choose privacy level:\n` +
              `1 = Quick | 2 = Private | 3 = Vault`
          );
        }

        // Show previous results or help
        const result = session.context?.extraction_result as Record<string, unknown> | undefined;
        if (result) {
          return twiml(
            `Your last document was processed.\n\n` +
              `Send a new photo to process another document.`
          );
        }

        return handleHelp();
      }

      default:
        return handleHelp();
    }
  } catch (error) {
    console.error("Vault SMS webhook error:", error);
    return twiml("Something went wrong. Please try again.");
  }
});

/**
 * Telegram Restoration Bot - Photo intake for restoration companies
 *
 * Flow:
 * 1. Boss generates invite code for their business
 * 2. Technician joins via /start INVITE_CODE
 * 3. Technician sets active vehicle via /vehicle VIN
 * 4. Technician sends photos → routed to business → vehicle
 * 5. Business pulls structured data via API
 *
 * Webhook: POST /functions/v1/telegram-restoration-bot
 * Setup: GET ?setup=true
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Use the same bot token as the main telegram webhook
const BOT_TOKEN = Deno.env.get("NUKEPROOF_BOT_TOKEN") ||
  Deno.env.get("NUKE_TELEGRAM_BOT_TOKEN") ||
  Deno.env.get("TELEGRAM_BOT_TOKEN");

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
    }>;
    caption?: string;
  };
}

// Send message back to Telegram
async function sendMessage(chatId: number, text: string, parseMode = "Markdown") {
  if (!BOT_TOKEN) {
    console.error("[RestBot] No BOT_TOKEN available");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    const result = await response.json();
    if (!result.ok) {
      console.error("[RestBot] Send failed:", result);
      // Retry without markdown
      if (result.description?.includes("parse")) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
      }
    }
  } catch (e) {
    console.error("[RestBot] sendMessage error:", e);
  }
}

// Get file URL from Telegram
async function getFileUrl(fileId: string): Promise<string | null> {
  if (!BOT_TOKEN) return null;

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await response.json();

  if (data.ok && data.result.file_path) {
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
  }
  return null;
}

// Download file and upload to Supabase storage
async function uploadToStorage(
  fileUrl: string,
  telegramId: number,
  messageId: number
): Promise<string | null> {
  try {
    const response = await fetch(fileUrl);
    const blob = await response.blob();

    const ext = fileUrl.split(".").pop() || "jpg";
    const path = `telegram/${telegramId}/${Date.now()}_${messageId}.${ext}`;

    const { error } = await supabase.storage
      .from("vehicle-photos")
      .upload(path, blob, {
        contentType: blob.type || "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("[RestBot] Storage upload error:", error);
      return null;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from("vehicle-photos")
      .getPublicUrl(path);

    return publicUrl;
  } catch (e) {
    console.error("[RestBot] uploadToStorage error:", e);
    return null;
  }
}

// Get or create telegram technician
async function getOrCreateTech(telegramUser: TelegramUpdate["message"]["from"]) {
  const { data: existing } = await supabase
    .from("telegram_technicians")
    .select("*")
    .eq("telegram_id", telegramUser.id)
    .single();

  if (existing) {
    // Update last active
    await supabase
      .from("telegram_technicians")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing;
  }

  // Create new
  const { data: newTech } = await supabase
    .from("telegram_technicians")
    .insert({
      telegram_id: telegramUser.id,
      telegram_username: telegramUser.username,
      display_name: `${telegramUser.first_name}${telegramUser.last_name ? " " + telegramUser.last_name : ""}`,
    })
    .select()
    .single();

  return newTech;
}

// Use invite code to join a business
async function joinBusiness(telegramId: number, code: string): Promise<{
  success: boolean;
  message: string;
  businessName?: string;
}> {
  const { data, error } = await supabase.rpc("use_invite_code", {
    p_code: code.toUpperCase(),
    p_telegram_id: telegramId,
  });

  if (error) {
    console.error("[RestBot] use_invite_code error:", error);
    return { success: false, message: "Something went wrong. Try again?" };
  }

  if (!data?.success) {
    return { success: false, message: data?.error || "Invalid or expired invite code" };
  }

  return {
    success: true,
    message: `Welcome to ${data.business_name}!`,
    businessName: data.business_name,
  };
}

// Set active vehicle by VIN
async function setActiveVehicle(
  techId: string,
  vinOrQuery: string
): Promise<{ success: boolean; message: string; vehicle?: any }> {
  const normalized = vinOrQuery.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  // Validate VIN length to prevent expensive queries
  if (normalized.length < 6) {
    return {
      success: false,
      message: `VIN too short (${normalized.length} characters). Please enter at least 6 characters.`,
    };
  }

  if (normalized.length > 17) {
    return {
      success: false,
      message: `VIN too long (${normalized.length} characters). VINs are max 17 characters.`,
    };
  }

  // Try to find vehicle by exact VIN match first
  let { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, year, make, model, vin")
    .eq("vin", normalized)
    .single();

  // If not found by exact VIN and length is between 6-16, try partial match
  if (!vehicle && normalized.length >= 6 && normalized.length < 17) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin")
      .ilike("vin", `%${normalized}%`)
      .limit(1);

    if (vehicles?.length === 1) {
      vehicle = vehicles[0];
    }
  }

  // Only try NHTSA decode for exactly 17 character VINs
  if (!vehicle && normalized.length === 17) {
    try {
      const nhtsaResponse = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${normalized}?format=json`
      );
      const nhtsaData = await nhtsaResponse.json();

      const getValue = (variableId: number): string | null => {
        const item = nhtsaData.Results?.find((r: any) => r.VariableId === variableId);
        return item?.Value || null;
      };

      const year = getValue(29);
      const make = getValue(26);
      const model = getValue(28);

      if (year && make) {
        const { data: newVehicle } = await supabase
          .from("vehicles")
          .insert({
            vin: normalized,
            year: parseInt(year),
            make,
            model,
            discovered_via: "telegram_technician",
          })
          .select()
          .single();

        vehicle = newVehicle;
      }
    } catch (e) {
      console.error("[RestBot] NHTSA decode error:", e);
    }
  }

  if (!vehicle) {
    const hint = normalized.length < 17
      ? " Try entering the full 17-character VIN."
      : "";
    return {
      success: false,
      message: `Couldn't find vehicle with VIN "${vinOrQuery}".${hint}`,
    };
  }

  // Update technician's active vehicle
  await supabase
    .from("telegram_technicians")
    .update({
      active_vehicle_id: vehicle.id,
      active_vin: vehicle.vin,
    })
    .eq("id", techId);

  return {
    success: true,
    message: `Active vehicle set: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    vehicle,
  };
}

// Clear active vehicle
async function clearActiveVehicle(techId: string) {
  await supabase
    .from("telegram_technicians")
    .update({
      active_vehicle_id: null,
      active_vin: null,
    })
    .eq("id", techId);
}

// AI analysis of work photo
async function analyzeWorkPhoto(
  imageUrl: string,
  caption?: string,
  context?: { vehicleName?: string }
): Promise<{
  workType: string;
  description: string;
  confidence: number;
}> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return {
      workType: "other",
      description: "Work photo received",
      confidence: 0.5,
    };
  }

  try {
    // Download and convert to base64
    const imgResponse = await fetch(imageUrl);
    const arrayBuffer = await imgResponse.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const base64 = btoa(binary);

    const vehicleContext = context?.vehicleName
      ? `This is work on a ${context.vehicleName}.`
      : "";

    const prompt = `Analyze this automotive restoration/repair work photo.

${vehicleContext}
${caption ? `Caption from technician: "${caption}"` : ""}

Classify the work type as one of:
body_work, paint_prep, paint, mechanical, interior, electrical, suspension, engine, transmission, detailing, disassembly, assembly, welding, fabrication, media_blasting, rust_repair, other

Return JSON only:
{"workType": "body_work", "description": "Brief description of what's shown", "confidence": 0.85}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("[RestBot] AI analysis error:", e);
  }

  return {
    workType: "other",
    description: caption || "Work photo received",
    confidence: 0.3,
  };
}

// Process photo submission
async function processPhotoSubmission(
  tech: any,
  chatId: number,
  messageId: number,
  photos: TelegramUpdate["message"]["photo"],
  caption?: string
): Promise<string> {
  // Check if tech is onboarded
  if (!tech.business_id) {
    return `You're not connected to a business yet.

Ask your boss for an invite code, then send:
/start INVITE_CODE`;
  }

  // Get business name
  const { data: business } = await supabase
    .from("businesses")
    .select("id, business_name")
    .eq("id", tech.business_id)
    .single();

  // Check for active vehicle
  if (!tech.active_vehicle_id) {
    return `No active vehicle set.

Send /vehicle VIN to set which vehicle you're working on.

Example: /vehicle WBA3A5C51CF123456`;
  }

  // Get vehicle info
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, year, make, model, vin")
    .eq("id", tech.active_vehicle_id)
    .single();

  if (!vehicle) {
    await clearActiveVehicle(tech.id);
    return "Active vehicle not found. Please set a new one with /vehicle VIN";
  }

  // Get highest resolution photo
  const photo = photos![photos!.length - 1];
  const fileUrl = await getFileUrl(photo.file_id);

  if (!fileUrl) {
    return "Couldn't download photo. Please try again.";
  }

  // Upload to storage
  const storagePath = await uploadToStorage(fileUrl, tech.telegram_id, messageId);

  // Analyze with AI
  const analysis = await analyzeWorkPhoto(
    fileUrl,
    caption,
    { vehicleName: `${vehicle.year} ${vehicle.make} ${vehicle.model}` }
  );

  // Create submission record
  const { data: submission, error } = await supabase
    .from("telegram_work_submissions")
    .insert({
      telegram_technician_id: tech.id,
      telegram_message_id: messageId,
      telegram_chat_id: chatId,
      message_text: caption,
      photo_urls: [fileUrl],
      storage_paths: storagePath ? [storagePath] : [],
      detected_vehicle_id: vehicle.id,
      business_id: tech.business_id,
      ai_processed_at: new Date().toISOString(),
      ai_interpretation: analysis,
      confidence_score: analysis.confidence,
      detected_work_type: analysis.workType,
      detected_description: analysis.description,
      processing_status: "processed",
    })
    .select()
    .single();

  if (error) {
    console.error("[RestBot] submission insert error:", error);
    return "Failed to save submission. Please try again.";
  }

  // Create timeline event
  try {
    await supabase.from("vehicle_timeline").insert({
      vehicle_id: vehicle.id,
      event_type: "work_performed",
      event_title: `${analysis.workType.replace(/_/g, " ")} documented`,
      event_description: analysis.description,
      event_date: new Date().toISOString(),
      source_type: "telegram_submission",
      source_reference: submission.id,
      media_urls: storagePath ? [storagePath] : [fileUrl],
      metadata: {
        telegram_technician_id: tech.id,
        technician_name: tech.display_name,
        business_id: tech.business_id,
        ai_confidence: analysis.confidence,
      },
    });
  } catch (e) {
    console.error("[RestBot] timeline insert error:", e);
  }

  // Create observation for the unified system
  try {
    await supabase.from("vehicle_observations").insert({
      vehicle_id: vehicle.id,
      source_slug: "telegram_technician",
      kind: "work_performed",
      observed_at: new Date().toISOString(),
      source_identifier: `tg:${chatId}:${messageId}`,
      content_text: analysis.description,
      structured_data: {
        work_type: analysis.workType,
        confidence: analysis.confidence,
        business_id: tech.business_id,
      },
      observer_raw: {
        technician_id: tech.id,
        technician_name: tech.display_name,
        telegram_id: tech.telegram_id,
      },
      trust_score: 0.8,
    });
  } catch (e) {
    console.error("[RestBot] observation insert error:", e);
  }

  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const businessName = business?.business_name || "your shop";

  return `Logged for ${businessName}

${vehicleName}
${analysis.workType.replace(/_/g, " ")} - ${analysis.description}

Send more photos or /done when finished.`;
}

// Main handler
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Setup endpoint
  if (url.searchParams.get("setup") === "true") {
    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ error: "BOT_TOKEN not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-restoration-bot`;
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const result = await response.json();

    const meResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botInfo = await meResponse.json();

    return new Response(JSON.stringify({
      webhook_url: webhookUrl,
      telegram_response: result,
      bot: botInfo.result,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Health check
  if (req.method === "GET") {
    return new Response("Telegram Restoration Bot active", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log("[RestBot] Update:", JSON.stringify(update, null, 2));

    if (!update.message) {
      return new Response("OK", { status: 200 });
    }

    const { message } = update;
    const chatId = message.chat.id;
    const text = message.text || "";
    const telegramUser = message.from;

    // Get or create technician record
    const tech = await getOrCreateTech(telegramUser);
    if (!tech) {
      await sendMessage(chatId, "Something went wrong. Please try again.");
      return new Response("OK", { status: 200 });
    }

    // === COMMANDS ===

    // /start or /start INVITE_CODE
    if (text.startsWith("/start")) {
      const parts = text.split(/\s+/);
      const inviteCode = parts[1];

      if (inviteCode) {
        // Joining with invite code
        const result = await joinBusiness(tech.telegram_id, inviteCode);

        if (result.success) {
          await sendMessage(
            chatId,
            `${result.message}

You're now connected. Next steps:

1. /vehicle VIN - Set which vehicle you're working on
2. Send photos of your work
3. /done when finished with a vehicle

Your boss will receive organized photo updates.`
          );
        } else {
          await sendMessage(chatId, result.message);
        }
        return new Response("OK", { status: 200 });
      }

      // Basic /start without code
      if (tech.business_id) {
        const { data: business } = await supabase
          .from("businesses")
          .select("business_name")
          .eq("id", tech.business_id)
          .single();

        await sendMessage(
          chatId,
          `Welcome back, ${tech.display_name}!

You're connected to: ${business?.business_name || "your shop"}

Commands:
/vehicle VIN - Set active vehicle
/status - See current assignment
/done - Clear active vehicle
/help - More info`
        );
      } else {
        await sendMessage(
          chatId,
          `Hi ${tech.display_name}!

To get started, ask your shop manager for an invite code and send:

/start INVITE_CODE

Example: /start ABC12345`
        );
      }
      return new Response("OK", { status: 200 });
    }

    // /vehicle VIN - Set active vehicle
    if (text.startsWith("/vehicle") || text.startsWith("/vin") || text.startsWith("/car")) {
      const parts = text.split(/\s+/);
      const vin = parts.slice(1).join("");

      if (!vin) {
        await sendMessage(
          chatId,
          `Send the VIN to set your active vehicle.

Example: /vehicle WBA3A5C51CF123456

Or send a photo of the VIN plate.`
        );
        return new Response("OK", { status: 200 });
      }

      const result = await setActiveVehicle(tech.id, vin);
      await sendMessage(chatId, result.message);
      return new Response("OK", { status: 200 });
    }

    // /done - Clear active vehicle
    if (text === "/done" || text === "/clear" || text === "/finish") {
      await clearActiveVehicle(tech.id);
      await sendMessage(
        chatId,
        `Active vehicle cleared.

Send /vehicle VIN to set a new one.`
      );
      return new Response("OK", { status: 200 });
    }

    // /status - Show current state
    if (text === "/status") {
      let statusMsg = `${tech.display_name}\n\n`;

      if (tech.business_id) {
        const { data: business } = await supabase
          .from("businesses")
          .select("business_name")
          .eq("id", tech.business_id)
          .single();

        statusMsg += `Shop: ${business?.business_name || "Connected"}\n`;
      } else {
        statusMsg += `Shop: Not connected\n`;
      }

      if (tech.active_vehicle_id) {
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("year, make, model, vin")
          .eq("id", tech.active_vehicle_id)
          .single();

        if (vehicle) {
          statusMsg += `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`;
          statusMsg += `VIN: ...${vehicle.vin?.slice(-6) || "N/A"}\n`;
        }
      } else {
        statusMsg += `Vehicle: None set\n`;
      }

      // Count today's submissions
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from("telegram_work_submissions")
        .select("*", { count: "exact", head: true })
        .eq("telegram_technician_id", tech.id)
        .gte("received_at", today.toISOString());

      statusMsg += `\nPhotos today: ${count || 0}`;

      await sendMessage(chatId, statusMsg);
      return new Response("OK", { status: 200 });
    }

    // /help
    if (text === "/help") {
      await sendMessage(
        chatId,
        `*Restoration Bot Help*

*Getting Started:*
1. Get invite code from your shop manager
2. Send: /start INVITE_CODE
3. Set vehicle: /vehicle VIN
4. Send work photos
5. When done: /done

*Commands:*
/start CODE - Join a shop
/vehicle VIN - Set active vehicle
/status - Check current assignment
/done - Clear active vehicle
/help - This message

*Tips:*
- Add captions to photos for better logging
- Photos go to your shop's records
- Your boss sees organized updates`
      );
      return new Response("OK", { status: 200 });
    }

    // === PHOTO HANDLING ===
    if (message.photo && message.photo.length > 0) {
      const response = await processPhotoSubmission(
        tech,
        chatId,
        message.message_id,
        message.photo,
        message.caption
      );
      await sendMessage(chatId, response);
      return new Response("OK", { status: 200 });
    }

    // === TEXT MESSAGE (potential VIN) ===
    // Check if it looks like a VIN (exactly 17 chars, alphanumeric minus I, O, Q)
    // Only auto-detect for exactly 17 characters to avoid false positives
    const potentialVin = text.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    // Strict check: exactly 17 chars, and original text was mostly the VIN (not embedded in other text)
    const originalClean = text.replace(/[\s\-]/g, "");
    if (potentialVin.length === 17 && originalClean.length <= 20) {
      const result = await setActiveVehicle(tech.id, potentialVin);
      await sendMessage(chatId, result.message);
      return new Response("OK", { status: 200 });
    }

    // Default response
    if (tech.business_id) {
      await sendMessage(
        chatId,
        `Send a work photo or use:
/vehicle VIN - Set active vehicle
/status - Check current state
/help - More commands`
      );
    } else {
      await sendMessage(
        chatId,
        `To start, get an invite code from your shop manager and send:

/start INVITE_CODE`
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[RestBot] Error:", error);
    return new Response("Error", { status: 500 });
  }
});

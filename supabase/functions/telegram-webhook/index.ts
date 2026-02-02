/**
 * Telegram Bot Webhook - Receive messages and photos
 *
 * Handles incoming Telegram messages for verification.
 * Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-webhook
 *
 * POST /functions/v1/telegram-webhook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Use Nuke bot for verification (separate from L'Officiel concierge bot)
const BOT_TOKEN = Deno.env.get("NUKE_TELEGRAM_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
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
async function sendMessage(chatId: number, text: string) {
  if (!BOT_TOKEN) {
    console.error("[Telegram] No BOT_TOKEN available");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    const result = await response.json();
    if (!result.ok) {
      console.error("[Telegram] Send failed:", result);
      // Retry without markdown if it failed
      if (result.description?.includes("parse")) {
        const retry = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        const retryResult = await retry.json();
        console.log("[Telegram] Retry result:", retryResult);
      }
    } else {
      console.log("[Telegram] Message sent:", result.result.message_id);
    }
  } catch (e) {
    console.error("[Telegram] sendMessage error:", e);
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

// Download file from Telegram
async function downloadFile(fileUrl: string): Promise<Blob> {
  const response = await fetch(fileUrl);
  return await response.blob();
}

// NHTSA VIN Decoder - verify VIN exists and get official data
async function decodeVINWithNHTSA(vin: string): Promise<{
  valid: boolean;
  year: number | null;
  make: string | null;
  model: string | null;
  bodyClass: string | null;
  errorCode: string | null;
}> {
  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`
    );
    const data = await response.json();

    if (!data.Results) {
      return { valid: false, year: null, make: null, model: null, bodyClass: null, errorCode: "NO_RESULTS" };
    }

    const getValue = (variableId: number): string | null => {
      const item = data.Results.find((r: any) => r.VariableId === variableId);
      return item?.Value || null;
    };

    // Key variable IDs from NHTSA
    const errorCode = getValue(143); // Error Code
    const year = getValue(29); // Model Year
    const make = getValue(26); // Make
    const model = getValue(28); // Model
    const bodyClass = getValue(5); // Body Class

    // Error code 0 = no errors, valid VIN
    const isValid = errorCode === "0" || !errorCode;

    return {
      valid: isValid,
      year: year ? parseInt(year) : null,
      make,
      model,
      bodyClass,
      errorCode,
    };
  } catch (e) {
    console.error("[NHTSA] Decode error:", e);
    return { valid: false, year: null, make: null, model: null, bodyClass: null, errorCode: "FETCH_ERROR" };
  }
}

// VIN validation
function validateVIN(vin: string): { valid: boolean; normalized: string; errors: string[] } {
  const normalized = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  const errors: string[] = [];

  if (normalized.length !== 17) {
    errors.push(`Invalid length: ${normalized.length} (expected 17)`);
  }

  if (/[IOQ]/.test(vin)) {
    errors.push("VIN cannot contain I, O, or Q");
  }

  if (!/\d/.test(normalized)) {
    errors.push("VIN must contain at least one digit");
  }

  // Check digit validation for 17-char VINs
  if (normalized.length === 17 && errors.length === 0) {
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const trans: Record<string, number> = {
      A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
      J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
      S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
    };

    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const c = normalized[i];
      const val = /\d/.test(c) ? parseInt(c) : trans[c] || 0;
      sum += val * weights[i];
    }
    const check = sum % 11;
    const expected = check === 10 ? "X" : check.toString();

    if (normalized[8] !== expected) {
      errors.push(`Check digit mismatch (expected ${expected}, got ${normalized[8]})`);
    }
  }

  return { valid: errors.length === 0, normalized, errors };
}

// Extract VIN from text
function extractVIN(text: string): string | null {
  const upper = text.toUpperCase();

  // Labeled patterns
  const labeled = upper.match(/(?:VIN|VEHICLE\s*ID|CHASSIS|SERIAL)\s*[:#.\s]*([A-HJ-NPR-Z0-9]{17})/);
  if (labeled) {
    const result = validateVIN(labeled[1]);
    if (result.valid) return result.normalized;
  }

  // Standalone 17-char
  const standalone = upper.match(/\b([A-HJ-NPR-Z0-9]{17})\b/g);
  if (standalone) {
    for (const match of standalone) {
      const result = validateVIN(match);
      if (result.valid) return result.normalized;
    }
  }

  return null;
}

// Detect document type from text
function detectDocType(text: string): { type: string; confidence: number } {
  const upper = text.toUpperCase();
  const scores: Record<string, number> = { title: 0, id: 0, registration: 0 };

  // Title keywords
  ["CERTIFICATE OF TITLE", "VEHICLE TITLE", "MOTOR VEHICLE", "DMV", "LIENHOLDER", "VIN", "TITLE"].forEach(kw => {
    if (upper.includes(kw)) scores.title++;
  });

  // ID keywords
  ["DRIVER", "LICENSE", "CLASS", "DOB", "DL", "RESTRICTIONS"].forEach(kw => {
    if (upper.includes(kw)) scores.id++;
  });

  // Registration keywords
  ["REGISTRATION", "PLATE", "LICENSE PLATE"].forEach(kw => {
    if (upper.includes(kw)) scores.registration++;
  });

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best[1] >= 2) {
    return { type: best[0], confidence: Math.min(0.95, 0.5 + best[1] * 0.1) };
  }
  return { type: "unknown", confidence: 0.3 };
}

// Process photo through verification using AI
async function processPhoto(
  fileUrl: string,
  chatId: number,
  userId: number,
  caption?: string
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!anthropicKey) {
    console.error("[Telegram] No ANTHROPIC_API_KEY");
    return "AI service not configured.";
  }

  try {
    console.log("[Telegram] Analyzing with AI...", fileUrl);

    // Download image first and convert to base64
    const imageResponse = await fetch(fileUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Chunked base64 encoding to avoid stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const base64 = btoa(binary);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64
                }
              },
              {
                type: "text",
                text: `Analyze this vehicle document image. Extract:
1) Document type (title, registration, ID, other)
2) VIN (17 characters) if visible
3) Owner/registered name if visible
4) Year, Make, Model if visible
5) State/jurisdiction if visible

Return ONLY valid JSON:
{"type": "title", "vin": "...", "name": "...", "year": 1977, "make": "Chevrolet", "model": "Blazer", "state": "...", "confidence": 0.9}`,
              },
            ],
          },
        ],
      }),
    });

    const aiResult = await response.json();
    console.log("[Telegram] AI response:", JSON.stringify(aiResult));

    if (aiResult.error) {
      console.error("[Telegram] AI error:", aiResult.error);
      return `AI error: ${aiResult.error.message}`;
    }

    const text = aiResult.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate VIN if present
      let vinStatus = "";
      let nhtsaData: any = null;
      if (parsed.vin) {
        // Pre-1981 VINs are shorter than 17 chars - can't check with NHTSA
        if (parsed.year && parsed.year < 1981 && parsed.vin.length < 17) {
          vinStatus = "✅ Valid (pre-1981 format)";
        } else if (parsed.vin.length === 17) {
          // Check digit validation first
          const vinResult = validateVIN(parsed.vin);
          if (!vinResult.valid) {
            vinStatus = `⚠️ ${vinResult.errors.join(", ")}`;
          } else {
            // VIN format is valid, now verify with NHTSA
            nhtsaData = await decodeVINWithNHTSA(parsed.vin);
            if (nhtsaData.valid) {
              vinStatus = "✅ NHTSA Verified";

              // Cross-check year/make/model
              const mismatches: string[] = [];
              if (nhtsaData.year && parsed.year && nhtsaData.year !== parsed.year) {
                mismatches.push(`Year: title says ${parsed.year}, NHTSA says ${nhtsaData.year}`);
              }
              if (nhtsaData.make && parsed.make) {
                const titleMake = parsed.make.toUpperCase();
                const nhtsaMake = nhtsaData.make.toUpperCase();
                if (!titleMake.includes(nhtsaMake) && !nhtsaMake.includes(titleMake)) {
                  mismatches.push(`Make: title says ${parsed.make}, NHTSA says ${nhtsaData.make}`);
                }
              }

              if (mismatches.length > 0) {
                vinStatus = "⚠️ NHTSA mismatch";
                parsed.nhtsa_mismatches = mismatches;
              }
            } else {
              vinStatus = `⚠️ NHTSA: ${nhtsaData.errorCode || "not found"}`;
            }
          }
        } else {
          vinStatus = `⚠️ Invalid length (${parsed.vin.length} chars)`;
        }
      }

      const confidence = parsed.confidence || 0;

      // Reject low confidence (not a document or unreadable)
      if (confidence < 0.4) {
        return "🤔 I couldn't identify this as a vehicle document.\n\nPlease send a clear photo of:\n• Vehicle title\n• Registration\n• Driver's license";
      }

      // Warn on medium confidence
      let msg = "";
      if (confidence < 0.7) {
        msg += "⚠️ Image quality is low - results may be incomplete\n\n";
      }

      msg += `📋 Document Analysis\n\n`;
      msg += `Type: ${parsed.type || "unknown"}\n`;
      if (parsed.vin) msg += `VIN: ${parsed.vin}\n     ${vinStatus}\n`;
      if (parsed.name) msg += `Owner: ${parsed.name}\n`;
      if (parsed.year) msg += `Year: ${parsed.year}\n`;
      if (parsed.make) msg += `Make: ${parsed.make}\n`;
      if (parsed.model) msg += `Model: ${parsed.model}\n`;
      if (parsed.state) msg += `State: ${parsed.state}\n`;

      // Show NHTSA data if available and different
      if (nhtsaData?.valid && (nhtsaData.make || nhtsaData.model)) {
        msg += `\n📊 NHTSA Record:\n`;
        if (nhtsaData.year) msg += `   Year: ${nhtsaData.year}\n`;
        if (nhtsaData.make) msg += `   Make: ${nhtsaData.make}\n`;
        if (nhtsaData.model) msg += `   Model: ${nhtsaData.model}\n`;
        if (nhtsaData.bodyClass) msg += `   Body: ${nhtsaData.bodyClass}\n`;
      }

      // Show mismatches if any
      if (parsed.nhtsa_mismatches?.length > 0) {
        msg += `\n⚠️ Discrepancies:\n`;
        for (const m of parsed.nhtsa_mismatches) {
          msg += `   • ${m}\n`;
        }
      }

      msg += `\nConfidence: ${Math.round(confidence * 100)}%`;

      // Save submission and route to vehicle
      try {
        // 1. Save the submission
        // Determine status based on confidence and NHTSA validation
        let status = "needs_more";
        if (confidence >= 0.7) {
          if (parsed.nhtsa_mismatches?.length > 0) {
            status = "flagged_mismatch";
          } else if (nhtsaData?.valid) {
            status = "verified";
          } else {
            status = "pending_review";
          }
        }

        const { data: submission } = await supabase.from("sms_verification_submissions").insert({
          from_phone: `telegram:${userId}`,
          verification_type: parsed.type === "title" ? "title" : "identity",
          media_urls: [fileUrl],
          message_body: caption,
          ai_processed_at: new Date().toISOString(),
          ai_result: { ...parsed, nhtsa: nhtsaData },
          ai_confidence: confidence,
          extracted_name: parsed.name,
          extracted_vin: parsed.vin,
          status,
        }).select().single();

        // 2. If it's a title with a VIN, look up vehicle and check for duplicates
        if (parsed.type === "title" && parsed.vin && confidence >= 0.7) {
          // Check if this VIN was submitted by a different user recently
          const { data: otherSubmissions } = await supabase
            .from("sms_verification_submissions")
            .select("from_phone, created_at")
            .eq("extracted_vin", parsed.vin)
            .neq("from_phone", `telegram:${userId}`)
            .order("created_at", { ascending: false })
            .limit(1);

          if (otherSubmissions && otherSubmissions.length > 0) {
            msg += `\n\n⚠️ This VIN was submitted by another user - flagged for review`;
            if (submission?.id) {
              await supabase
                .from("sms_verification_submissions")
                .update({ status: "flagged_duplicate" })
                .eq("id", submission.id);
            }
          }

          // Look up existing vehicle by VIN
          const { data: existingVehicle } = await supabase
            .from("vehicles")
            .select("id, year, make, model, source")
            .eq("vin", parsed.vin)
            .single();

          if (existingVehicle) {
            msg += `\n\n🚗 Matched: ${existingVehicle.year || "?"} ${existingVehicle.make || "?"} ${existingVehicle.model || "?"}`;

            // Compare title data to existing vehicle - title is source of truth
            const corrections: { field: string; oldVal: any; newVal: any }[] = [];
            const updates: Record<string, any> = {};

            if (parsed.year && parsed.year !== existingVehicle.year) {
              corrections.push({ field: "year", oldVal: existingVehicle.year, newVal: parsed.year });
              updates.year = parsed.year;
            }
            if (parsed.make && parsed.make !== existingVehicle.make) {
              corrections.push({ field: "make", oldVal: existingVehicle.make, newVal: parsed.make });
              updates.make = parsed.make;
            }
            if (parsed.model && parsed.model !== existingVehicle.model) {
              corrections.push({ field: "model", oldVal: existingVehicle.model, newVal: parsed.model });
              updates.model = parsed.model;
            }

            // Auto-correct vehicle if title has better data
            if (corrections.length > 0) {
              msg += `\n\n📝 Title corrections:`;
              for (const c of corrections) {
                msg += `\n   • ${c.field}: ${c.oldVal || "empty"} → ${c.newVal}`;
              }

              // Log history BEFORE updating (preserve old data)
              const historyRecords = corrections.map(c => ({
                vehicle_id: existingVehicle.id,
                field_name: c.field,
                old_value: c.oldVal?.toString() || null,
                new_value: c.newVal?.toString(),
                old_value_source: existingVehicle.source || "unknown",
                old_value_user_id: null, // Could look up original submitter
                correction_source: "title_verification",
                correction_submission_id: submission?.id,
                correction_user_id: null, // Could link via telegram_id
                correction_confidence: confidence,
              }));

              const { error: historyErr } = await supabase
                .from("vehicle_data_history")
                .insert(historyRecords);

              if (historyErr) {
                console.error("[Telegram] History insert error:", historyErr);
              }

              // Update vehicle with title data
              const { error: updateErr } = await supabase
                .from("vehicles")
                .update({
                  ...updates,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existingVehicle.id);

              if (!updateErr) {
                msg += `\n   ✅ Vehicle updated (old data preserved in history)`;
              } else {
                console.error("[Telegram] Vehicle update error:", updateErr);
                msg += `\n   ⚠️ Could not update vehicle`;
              }
            }

            // Update submission with vehicle link
            if (submission?.id) {
              await supabase
                .from("sms_verification_submissions")
                .update({
                  routed_to_table: "vehicles",
                  routed_to_id: existingVehicle.id,
                })
                .eq("id", submission.id);
            }
          } else {
            msg += `\n\n🆕 New VIN - vehicle will be created`;
          }
        }
      } catch (dbErr) {
        console.error("[Telegram] DB error:", dbErr);
      }

      return msg;
    }

    return `Could not parse AI response: ${text.slice(0, 200)}`;
  } catch (e) {
    console.error("[Telegram] processPhoto error:", e);
    return `Error: ${e.message}`;
  }
}

serve(async (req) => {
  const url = new URL(req.url);

  // Delete message endpoint
  const deleteMessageId = url.searchParams.get("delete");
  if (deleteMessageId && BOT_TOKEN) {
    const chatId = url.searchParams.get("chat_id") || Deno.env.get("TELEGRAM_CHANNEL_ID");
    if (chatId) {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: parseInt(deleteMessageId) })
        }
      );
      const result = await response.json();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Setup endpoint - registers webhook with Telegram
  if (url.searchParams.get("setup") === "true") {
    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ error: "BOT_TOKEN not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`;
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const result = await response.json();

    // Also get bot info
    const meResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botInfo = await meResponse.json();

    return new Response(JSON.stringify({
      webhook_url: webhookUrl,
      telegram_response: result,
      bot: botInfo.result
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Debug endpoint
  if (url.searchParams.get("debug") === "true") {
    return new Response(JSON.stringify({
      has_nuke_token: !!Deno.env.get("NUKE_TELEGRAM_BOT_TOKEN"),
      has_fallback_token: !!Deno.env.get("TELEGRAM_BOT_TOKEN"),
      using_token: BOT_TOKEN ? `${BOT_TOKEN.slice(0, 10)}...` : "none"
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Test send endpoint - send message to a chat
  const testChatId = url.searchParams.get("test_chat");
  if (testChatId && BOT_TOKEN) {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: testChatId,
        text: "NukeProof bot is working!",
      }),
    });
    const result = await response.json();
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Test photo processing with a file_id
  const testFileId = url.searchParams.get("test_file");
  const testUserId = url.searchParams.get("user_id") || "0";
  if (testFileId && BOT_TOKEN) {
    const fileUrl = await getFileUrl(testFileId);
    if (!fileUrl) {
      return new Response(JSON.stringify({ error: "Could not get file URL" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    const result = await processPhoto(fileUrl, 0, parseInt(testUserId), "test");
    return new Response(JSON.stringify({ file_url: fileUrl, result }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Info endpoint
  if (req.method === "GET") {
    return new Response("Telegram webhook active", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log("[Telegram] Received update:", JSON.stringify(update, null, 2));

    if (!update.message) {
      return new Response("OK", { status: 200 });
    }

    const { message } = update;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || "";

    // Handle /start command
    if (text === "/start") {
      await sendMessage(
        chatId,
        `👋 *Nuke Document Verification Bot*\n\n` +
          `Send me:\n` +
          `📸 Photo of your vehicle *title* - I'll extract the VIN and verify\n` +
          `🪪 Photo of your *ID* - For identity verification\n\n` +
          `All processing happens locally on our servers first (free, private), ` +
          `with AI backup when needed.`
      );
      return new Response("OK", { status: 200 });
    }

    // Handle /help command
    if (text === "/help") {
      await sendMessage(
        chatId,
        `*Available commands:*\n\n` +
          `/start - Introduction\n` +
          `/help - This message\n` +
          `/status - Check verification server status\n\n` +
          `Or just send a photo to analyze!`
      );
      return new Response("OK", { status: 200 });
    }

    // Handle /status command
    if (text === "/status") {
      const localUrl = Deno.env.get("LOCAL_VERIFICATION_URL") || "http://localhost:8765";
      try {
        const healthResponse = await fetch(`${localUrl}/health`);
        if (healthResponse.ok) {
          const health = await healthResponse.json();
          await sendMessage(
            chatId,
            `✅ *Local Verification Server*\n\n` +
              `YOLOv8: ${health.yolo_available ? "✅" : "❌"}\n` +
              `EasyOCR: ${health.easyocr_available ? "✅" : "❌"}\n` +
              `OpenCV: ${health.opencv_available ? "✅" : "❌"}\n` +
              `Training samples: ${health.training_samples}`
          );
        } else {
          await sendMessage(chatId, `❌ Local server not responding`);
        }
      } catch {
        await sendMessage(
          chatId,
          `❌ Local server offline\n\nAI fallback will be used.`
        );
      }
      return new Response("OK", { status: 200 });
    }

    // Handle photo
    if (message.photo && message.photo.length > 0) {
      // Check rate limit (max 20 per hour per user)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("sms_verification_submissions")
        .select("*", { count: "exact", head: true })
        .eq("from_phone", `telegram:${userId}`)
        .gte("created_at", oneHourAgo);

      if (count && count >= 20) {
        await sendMessage(chatId, "⏳ Rate limit reached (20/hour). Try again later.");
        return new Response("OK", { status: 200 });
      }

      await sendMessage(chatId, "📷 Analyzing document...");

      // Get the highest resolution photo
      const photo = message.photo[message.photo.length - 1];
      const fileUrl = await getFileUrl(photo.file_id);

      if (!fileUrl) {
        await sendMessage(chatId, "❌ Could not download photo");
        return new Response("OK", { status: 200 });
      }

      const result = await processPhoto(fileUrl, chatId, userId, message.caption);
      await sendMessage(chatId, result);

      return new Response("OK", { status: 200 });
    }

    // Default response for text messages
    if (text && !text.startsWith("/")) {
      await sendMessage(
        chatId,
        `Send me a *photo* of a document to analyze!\n\n` +
          `Or use /help for commands.`
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Telegram] Error:", error);
    return new Response("Error", { status: 500 });
  }
});

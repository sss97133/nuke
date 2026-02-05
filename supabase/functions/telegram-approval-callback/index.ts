/**
 * Telegram Approval Callback Handler
 *
 * Handles both:
 * 1. Callback queries (inline button presses)
 * 2. Text replies to approval requests
 *
 * POST /functions/v1/telegram-approval-callback
 *   - Body: Telegram Update (from webhook)
 *
 * This function should be set as the Telegram webhook for approval bot
 * OR called by the main telegram-webhook function.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { chat: { id: number }; message_id: number };
    data: string;
  };
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
  };
}

// Answer callback query (removes loading spinner on button)
async function answerCallback(callbackId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text || "Done" }),
  });
}

// Edit the original message to show result
async function editMessage(chatId: number, messageId: number, newText: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: "Markdown",
    }),
  });
}

// Send a message
async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

// Process approval response
async function processApproval(
  requestId: string,
  status: "approved" | "denied",
  responseText?: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("respond_to_approval", {
    p_request_id: requestId,
    p_status: status,
    p_response_text: responseText || null,
    p_response_data: {},
  });

  if (error) {
    console.error("RPC error:", error);
    return { success: false, error: error.message };
  }

  // RPC returns an array with [{success, error}]
  const result = Array.isArray(data) ? data[0] : data;
  return { success: result?.success ?? false, error: result?.error };
}

// Parse text for approval commands
function parseApprovalText(text: string): {
  requestId: string | null;
  action: "approve" | "deny" | "message" | null;
  message?: string;
} {
  const trimmed = text.trim();

  // Pattern: REQUEST_ID action/message
  // e.g., "ABC12345 yes" or "ABC12345 no" or "ABC12345 go ahead and do it"
  const match = trimmed.match(/^([A-Z0-9]{8})\s+(.+)$/i);
  if (!match) {
    return { requestId: null, action: null };
  }

  const [, requestId, rest] = match;
  const restLower = rest.toLowerCase().trim();

  if (["yes", "y", "ok", "approve", "approved", "go", "do it", "proceed"].includes(restLower)) {
    return { requestId: requestId.toUpperCase(), action: "approve" };
  }

  if (["no", "n", "deny", "denied", "stop", "cancel", "reject"].includes(restLower)) {
    return { requestId: requestId.toUpperCase(), action: "deny" };
  }

  // Detailed response - treat as approval with context
  return { requestId: requestId.toUpperCase(), action: "message", message: rest };
}

Deno.serve(async (req) => {
  // Health check
  if (req.method === "GET") {
    return new Response("Telegram approval callback handler active", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log("[approval-callback] Update:", JSON.stringify(update, null, 2));

    // Handle callback query (button press)
    if (update.callback_query) {
      const { callback_query } = update;
      const data = callback_query.data;
      const chatId = callback_query.message?.chat.id;
      const messageId = callback_query.message?.message_id;

      console.log("[approval-callback] Callback data:", data);

      // Parse callback data: approve_REQUESTID or deny_REQUESTID
      let action: "approved" | "denied" | null = null;
      let requestId: string | null = null;
      let allowAll = false;

      if (data.startsWith("approve_")) {
        action = "approved";
        requestId = data.replace("approve_", "");
      } else if (data.startsWith("deny_")) {
        action = "denied";
        requestId = data.replace("deny_", "");
      } else if (data.startsWith("allow_all_")) {
        action = "approved";
        requestId = data.replace("allow_all_", "");
        allowAll = true;
      }

      if (action && requestId) {
        const result = await processApproval(requestId, action);

        if (result.success) {
          const emoji = action === "approved" ? "✅" : "❌";
          const statusText = action === "approved" ? "APPROVED" : "DENIED";
          const extra = allowAll ? " (allowing all for this session)" : "";

          await answerCallback(callback_query.id, `${statusText}${extra}`);

          if (chatId && messageId) {
            await editMessage(
              chatId,
              messageId,
              `${emoji} Request \`${requestId}\` ${statusText}${extra}\n\nBy: ${callback_query.from.first_name}`
            );
          }
        } else {
          await answerCallback(callback_query.id, result.error || "Failed");
          if (chatId && messageId) {
            await editMessage(
              chatId,
              messageId,
              `⚠️ Request \`${requestId}\` - ${result.error || "Failed"}`
            );
          }
        }
      } else {
        await answerCallback(callback_query.id, "Unknown action");
      }

      return new Response("OK", { status: 200 });
    }

    // Handle text message (reply-based approval)
    if (update.message?.text) {
      const { message } = update;
      const text = message.text;
      const chatId = message.chat.id;

      // Try to parse as approval command
      const parsed = parseApprovalText(text);

      if (parsed.requestId && parsed.action) {
        let status: "approved" | "denied";
        let responseText: string | undefined;

        if (parsed.action === "message") {
          // Detailed response - approve with the message as context
          status = "approved";
          responseText = parsed.message;
        } else {
          status = parsed.action === "approve" ? "approved" : "denied";
        }

        const result = await processApproval(parsed.requestId, status, responseText);

        if (result.success) {
          const emoji = status === "approved" ? "✅" : "❌";
          const msg = status === "approved"
            ? `${emoji} Approved \`${parsed.requestId}\``
            : `${emoji} Denied \`${parsed.requestId}\``;
          await sendMessage(chatId, responseText ? `${msg}\n\n_Response recorded: "${responseText}"_` : msg);
        } else {
          await sendMessage(chatId, `⚠️ Error: ${result.error || "Unknown error"}`);
        }

        return new Response("OK", { status: 200 });
      }

      // Not an approval command - could be a regular message
      // Forward to main bot handler or ignore
      console.log("[approval-callback] Not an approval command:", text);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[approval-callback] Error:", error);
    return new Response("Error", { status: 500 });
  }
});

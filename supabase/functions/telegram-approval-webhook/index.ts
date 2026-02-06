/**
 * Telegram Approval Webhook - OWNER ONLY
 *
 * Handles Claude Code permission approvals via dedicated bot.
 * This bot is PRIVATE - only responds to OWNER_CHAT_ID.
 *
 * Webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-approval-webhook
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_APPROVAL_BOT_TOKEN");
const OWNER_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "7587296683";

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    message?: { chat: { id: number }; message_id: number };
    data: string;
  };
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    text?: string;
  };
}

// === HELPERS ===

async function sendMessage(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function answerCallback(callbackId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

// === APPROVAL LOGIC ===

const APPROVAL_PATTERN = /^([A-Z0-9]{8})\s+(.+)$/i;
const POSITIVE = new Set(["yes", "y", "ok", "approve", "approved", "go", "proceed", "allow", "yep", "yeah", "sure"]);
const NEGATIVE = new Set(["no", "n", "deny", "denied", "stop", "cancel", "reject", "nope"]);

async function processApproval(
  requestId: string,
  action: "approved" | "denied",
  responseText?: string,
  allowAll?: boolean
): Promise<{ success: boolean; error?: string; sessionId?: string }> {
  const { data, error } = await supabase.rpc("respond_to_approval", {
    p_request_id: requestId,
    p_status: action,
    p_response_text: responseText || null,
    p_response_data: {},
  });

  if (error) {
    console.error("Approval RPC error:", error);
    return { success: false, error: error.message };
  }

  const result = Array.isArray(data) ? data[0] : data;

  // If Allow All was requested, get session ID and store it
  if (allowAll && result?.success) {
    const { data: reqData } = await supabase
      .from("claude_approval_requests")
      .select("session_id")
      .eq("request_id", requestId)
      .single();

    if (reqData?.session_id) {
      await supabase
        .from("claude_allowed_sessions")
        .upsert({
          session_id: reqData.session_id,
          chat_id: parseInt(OWNER_CHAT_ID),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }, { onConflict: "session_id" });

      return { success: true, sessionId: reqData.session_id };
    }
  }

  return { success: result?.success ?? false, error: result?.error };
}

// === MAIN HANDLER ===

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Setup webhook endpoint
  if (url.searchParams.get("setup") === "true") {
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-approval-webhook`;
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const result = await response.json();
    return new Response(JSON.stringify({ webhook_url: webhookUrl, result }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Health check
  if (req.method === "GET") {
    return new Response("Approval Bot - Active (Owner Only)", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id || 0;

    // SECURITY: Only respond to owner
    if (chatId.toString() !== OWNER_CHAT_ID) {
      console.log(`[approval-webhook] Rejected non-owner: ${chatId}`);
      // Silent reject - don't even acknowledge
      return new Response("OK");
    }

    // Handle callback query (button press)
    if (update.callback_query) {
      const { callback_query } = update;
      const data = callback_query.data;
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
        const result = await processApproval(requestId, action, undefined, allowAll);
        if (result.success) {
          if (allowAll && result.sessionId) {
            await answerCallback(callback_query.id, `✓ Session auto-approved`);
            await sendMessage(chatId, `🔓 *Allow All enabled*\n\nSession \`${result.sessionId.slice(0, 8)}...\` will auto-approve for 24h.`);
          } else {
            await answerCallback(callback_query.id, `${action.toUpperCase()} ✓`);
          }
        } else {
          await answerCallback(callback_query.id, `Failed: ${result.error}`);
          await sendMessage(chatId, `⚠️ \`${requestId}\` - ${result.error}`);
        }
      } else {
        await answerCallback(callback_query.id, "Unknown");
      }
      return new Response("OK");
    }

    // Handle text message
    if (update.message?.text) {
      const text = update.message.text.trim();

      // /start command
      if (text === "/start") {
        await sendMessage(
          chatId,
          `🔐 *Claude Approval Bot*\n\n` +
          `This bot handles Claude Code permission requests.\n\n` +
          `*Commands:*\n` +
          `• \`pending\` - Show pending approvals\n` +
          `• \`ABC123 yes\` - Approve request\n` +
          `• \`ABC123 no\` - Deny request`
        );
        return new Response("OK");
      }

      // Check for pending approvals
      if (text.toLowerCase() === "pending") {
        const { data } = await supabase
          .from("claude_approval_requests")
          .select("request_id, tool_name, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(5);

        if (!data?.length) {
          await sendMessage(chatId, "✅ No pending approvals");
        } else {
          let msg = `🔔 *${data.length} Pending*\n\n`;
          data.forEach((a) => {
            msg += `• \`${a.request_id}\` - ${a.tool_name}\n`;
          });
          msg += `\n_Reply: \`ID yes\` or \`ID no\`_`;
          await sendMessage(chatId, msg);
        }
        return new Response("OK");
      }

      // Check allowed sessions
      if (text.toLowerCase() === "sessions" || text.toLowerCase() === "allowed") {
        const { data } = await supabase
          .from("claude_allowed_sessions")
          .select("session_id, created_at, expires_at")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(5);

        if (!data?.length) {
          await sendMessage(chatId, "🔒 No active auto-approve sessions");
        } else {
          let msg = `🔓 *${data.length} Auto-Approve Sessions*\n\n`;
          data.forEach((s) => {
            const hoursLeft = Math.round((new Date(s.expires_at).getTime() - Date.now()) / 3600000);
            msg += `• \`${s.session_id.slice(0, 8)}...\` (${hoursLeft}h left)\n`;
          });
          msg += `\n_\`revoke\` to disable all_`;
          await sendMessage(chatId, msg);
        }
        return new Response("OK");
      }

      // Revoke all allowed sessions
      if (text.toLowerCase() === "revoke") {
        await supabase.from("claude_allowed_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        await sendMessage(chatId, "🔒 All auto-approve sessions revoked");
        return new Response("OK");
      }

      // Parse approval command
      const match = text.match(APPROVAL_PATTERN);
      if (match) {
        const [, requestId, response] = match;
        const responseLower = response.toLowerCase().trim();

        let action: "approved" | "denied";
        if (POSITIVE.has(responseLower)) {
          action = "approved";
        } else if (NEGATIVE.has(responseLower)) {
          action = "denied";
        } else {
          // Detailed response = approval with context
          action = "approved";
        }

        const result = await processApproval(
          requestId.toUpperCase(),
          action,
          POSITIVE.has(responseLower) || NEGATIVE.has(responseLower) ? undefined : response
        );

        const emoji = action === "approved" ? "✅" : "❌";
        if (result.success) {
          await sendMessage(chatId, `${emoji} \`${requestId.toUpperCase()}\` ${action.toUpperCase()}`);
        } else {
          await sendMessage(chatId, `⚠️ Error: ${result.error}`);
        }
        return new Response("OK");
      }

      // Unknown command
      await sendMessage(chatId, `❓ Unknown. Try \`pending\` or \`ABC123 yes\``);
    }

    return new Response("OK");
  } catch (error) {
    console.error("[approval-webhook] Error:", error);
    return new Response("Error", { status: 500 });
  }
});

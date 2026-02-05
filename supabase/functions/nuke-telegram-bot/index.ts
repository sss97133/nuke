/**
 * Nuke Telegram Bot - Unified Entry Point
 *
 * Handles ALL Telegram interactions:
 * 1. Claude Code approval callbacks (button presses)
 * 2. Approval text replies ("ABC123 yes")
 * 3. Regular messages (status, queries, etc.)
 * 4. Photo uploads (work logging)
 *
 * Set as Telegram webhook:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/nuke-telegram-bot
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const OWNER_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "7587296683";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { chat: { id: number }; message_id: number; text?: string };
    data: string;
  };
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number };
    date: number;
    text?: string;
    photo?: Array<{ file_id: string }>;
    caption?: string;
    reply_to_message?: { message_id: number; text?: string };
  };
}

// === TELEGRAM HELPERS ===

async function sendMessage(chatId: number, text: string, replyTo?: number): Promise<number | null> {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "Markdown",
      reply_to_message_id: replyTo,
    }),
  });

  if (!response.ok) {
    // Retry without markdown
    const retry = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        reply_to_message_id: replyTo,
      }),
    });
    const result = await retry.json();
    return result.result?.message_id || null;
  }

  const result = await response.json();
  return result.result?.message_id || null;
}

async function answerCallback(callbackId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text || "Done" }),
  });
}

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

// === USER MANAGEMENT ===

interface TelegramUser {
  id: string;
  telegram_id: number;
  role: string;
  status: string;
}

async function getOrCreateUser(telegramId: number, firstName: string, username?: string): Promise<TelegramUser | null> {
  // Try to get existing user
  const { data: existing } = await supabase
    .from("telegram_users")
    .select("id, telegram_id, role, status")
    .eq("telegram_id", telegramId)
    .single();

  if (existing) {
    // Update last active
    await supabase
      .from("telegram_users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("telegram_id", telegramId);
    return existing;
  }

  // Create new user
  const { data: newUser, error } = await supabase
    .from("telegram_users")
    .insert({
      telegram_id: telegramId,
      telegram_username: username,
      first_name: firstName,
      status: "active", // Auto-activate for now
      role: "submitter",
    })
    .select("id, telegram_id, role, status")
    .single();

  if (error) {
    console.error("Failed to create user:", error);
    return null;
  }

  // Notify owner of new user
  await sendMessage(
    parseInt(OWNER_CHAT_ID),
    `🆕 *New User Registered*\n\n` +
    `Name: ${firstName}\n` +
    `Username: @${username || "none"}\n` +
    `ID: \`${telegramId}\``
  );

  return newUser;
}

// === PHOTO HANDLING ===

async function handlePhotoSubmission(
  user: TelegramUser,
  chatId: number,
  messageId: number,
  photos: Array<{ file_id: string }>,
  caption?: string
): Promise<void> {
  // Get the largest photo (last in array)
  const photo = photos[photos.length - 1];

  // Get file URL from Telegram
  const fileResponse = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`
  );
  const fileData = await fileResponse.json();

  if (!fileData.ok) {
    await sendMessage(chatId, "⚠️ Couldn't process photo", messageId);
    return;
  }

  const filePath = fileData.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  // Download and upload to Supabase storage
  const photoResponse = await fetch(fileUrl);
  const photoBlob = await photoResponse.blob();

  const fileName = `telegram/${user.telegram_id}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("vehicle-photos")
    .upload(fileName, photoBlob, { contentType: "image/jpeg" });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    await sendMessage(chatId, "⚠️ Failed to save photo", messageId);
    return;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("vehicle-photos")
    .getPublicUrl(fileName);

  // Create submission record
  const { error: insertError } = await supabase
    .from("telegram_submissions")
    .insert({
      telegram_user_id: user.id,
      submission_type: caption ? "work_update" : "photo",
      photo_urls: [urlData.publicUrl],
      caption: caption,
      telegram_message_id: messageId,
      chat_id: chatId,
      status: "pending",
    });

  if (insertError) {
    console.error("Submission insert error:", insertError);
  }

  // Acknowledge
  const ack = caption
    ? `📸 Photo received with note: "${caption.slice(0, 50)}..."\n\n_Processing..._`
    : `📸 Photo received!\n\n_What vehicle is this for? Reply with VIN, plate, or year/make/model_`;

  await sendMessage(chatId, ack, messageId);
}

// === APPROVAL HANDLING ===

// Approval pattern: "ABC12345 yes" or "ABC12345 no" or "ABC12345 <message>"
const APPROVAL_PATTERN = /^([A-Z0-9]{8})\s+(.+)$/i;
const POSITIVE = new Set(["yes", "y", "ok", "approve", "approved", "go", "do it", "proceed", "allow", "yep", "yeah", "sure"]);
const NEGATIVE = new Set(["no", "n", "deny", "denied", "stop", "cancel", "reject", "nope", "dont", "don't"]);

function parseApprovalMessage(text: string): {
  requestId: string | null;
  action: "approved" | "denied" | null;
  message?: string;
} {
  const match = text.trim().match(APPROVAL_PATTERN);
  if (!match) return { requestId: null, action: null };

  const [, requestId, response] = match;
  const responseLower = response.toLowerCase().trim();

  if (POSITIVE.has(responseLower)) {
    return { requestId: requestId.toUpperCase(), action: "approved" };
  }
  if (NEGATIVE.has(responseLower)) {
    return { requestId: requestId.toUpperCase(), action: "denied" };
  }

  // Detailed message = approval with context
  return { requestId: requestId.toUpperCase(), action: "approved", message: response };
}

async function processApproval(
  requestId: string,
  action: "approved" | "denied",
  responseText?: string
): Promise<{ success: boolean; error?: string }> {
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
  return { success: result?.success ?? false, error: result?.error };
}

async function handleApprovalCallback(callbackData: string, callbackId: string, chatId: number, messageId: number, fromName: string): Promise<void> {
  let action: "approved" | "denied" | null = null;
  let requestId: string | null = null;

  if (callbackData.startsWith("approve_")) {
    action = "approved";
    requestId = callbackData.replace("approve_", "");
  } else if (callbackData.startsWith("deny_")) {
    action = "denied";
    requestId = callbackData.replace("deny_", "");
  } else if (callbackData.startsWith("allow_all_")) {
    action = "approved";
    requestId = callbackData.replace("allow_all_", "");
  }

  if (action && requestId) {
    console.log(`[callback] Processing ${action} for ${requestId}`);
    const result = await processApproval(requestId, action);
    console.log(`[callback] Result:`, result);

    if (result.success) {
      const statusText = action.toUpperCase();
      await answerCallback(callbackId, `${statusText} ✓`);
      // Button edit will be done by the hook script when it receives the approval
    } else {
      const errorMsg = result.error || "Unknown error";
      await answerCallback(callbackId, `Failed: ${errorMsg}`);
      await sendMessage(chatId, `⚠️ \`${requestId}\` - ${errorMsg}`);
    }
  } else {
    await answerCallback(callbackId, "Unknown action");
  }
}

// === QUICK COMMANDS ===

async function getQueueStatus(): Promise<string> {
  const { data, error } = await supabase
    .from("import_queue")
    .select("status")
    .limit(100000);

  if (error) return `⚠️ Error: ${error.message}`;

  const counts: Record<string, number> = {};
  (data || []).forEach((item: { status: string }) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });

  const emojiMap: Record<string, string> = {
    complete: "✅", pending: "⏳", processing: "🔄",
    failed: "❌", skipped: "⏭️", duplicate: "♻️",
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let msg = "📊 *Queue Status*\n\n";

  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const emoji = emojiMap[status] || "•";
      const pct = total > 0 ? ((count / total) * 100).toFixed(0) : 0;
      msg += `${emoji} ${status}: ${count.toLocaleString()} (${pct}%)\n`;
    });

  msg += `\n*Total:* ${total.toLocaleString()}`;
  return msg;
}

async function getPendingApprovals(): Promise<string> {
  const { data } = await supabase
    .from("claude_approval_requests")
    .select("request_id, tool_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!data?.length) return "✅ No pending approval requests";

  let msg = `🔔 *${data.length} Pending Approvals*\n\n`;
  data.forEach((a) => {
    const time = a.created_at?.slice(11, 16) || "";
    msg += `• \`${a.request_id}\` - ${a.tool_name} (${time})\n`;
  });
  msg += "\n_Reply:_ `REQUESTID yes` or `REQUESTID no`";
  return msg;
}

// === TASK QUEUEING ===

async function queueTask(prompt: string, chatId: number, messageId?: number): Promise<string> {
  const { data, error } = await supabase
    .from("telegram_tasks")
    .insert({
      task_type: "query",
      prompt: prompt.slice(0, 2000),
      chat_id: chatId,
      reply_to_message_id: messageId,
      context: { source: "telegram_webhook" },
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Queue error:", error);
    return "⚠️ Could not queue task";
  }

  // Trigger the worker
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-task-worker?process=true`, {
      method: "GET",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    });
  } catch (e) {
    console.log("Worker trigger failed:", e);
  }

  return `📋 Processing your request...`;
}

// === MAIN HANDLER ===

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Setup endpoint
  if (url.searchParams.get("setup") === "true") {
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/nuke-telegram-bot`;
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
    return new Response("Nuke Telegram Bot v2 - Active", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log("[nuke-bot] Update:", JSON.stringify(update, null, 2));

    // Log to database
    await supabase.from("telegram_message_log").insert({
      message_id: update.message?.message_id || update.callback_query?.message?.message_id || 0,
      chat_id: update.message?.chat.id || update.callback_query?.message?.chat.id || 0,
      user_id: update.message?.from.id || update.callback_query?.from.id,
      username: update.message?.from.username || update.callback_query?.from.username,
      message_type: update.callback_query ? "callback_query" : (update.message?.photo ? "photo" : "text"),
      text: update.message?.text || update.callback_query?.data,
      callback_data: update.callback_query?.data,
      direction: "inbound",
      raw_payload: update,
    });

    // Handle callback query (button press)
    if (update.callback_query) {
      const { callback_query } = update;
      const chatId = callback_query.message?.chat.id || 0;
      const messageId = callback_query.message?.message_id || 0;

      await handleApprovalCallback(
        callback_query.data,
        callback_query.id,
        chatId,
        messageId,
        callback_query.from.first_name
      );
      return new Response("OK");
    }

    // Handle message
    if (update.message) {
      const { message } = update;
      const chatId = message.chat.id;
      const text = message.text || "";
      const textLower = text.toLowerCase().trim();

      // Get or create user
      const user = await getOrCreateUser(
        message.from.id,
        message.from.first_name,
        message.from.username
      );

      // Handle photos first
      if (message.photo && message.photo.length > 0) {
        if (user) {
          await handlePhotoSubmission(
            user,
            chatId,
            message.message_id,
            message.photo,
            message.caption
          );
        } else {
          await sendMessage(chatId, "⚠️ Please send /start first", message.message_id);
        }
        return new Response("OK");
      }

      // /start command
      if (text === "/start") {
        const isOwner = chatId.toString() === OWNER_CHAT_ID;
        const welcomeMsg = isOwner
          ? `🚗 *Nuke Command Center*\n\n` +
            `*Admin Commands:*\n` +
            `• \`status\` - Queue status\n` +
            `• \`approvals\` - Pending permissions\n` +
            `• \`users\` - List submitters\n\n` +
            `*Claude Approvals:*\n` +
            `• \`ABC123 yes\` - Approve\n` +
            `• \`ABC123 no\` - Deny\n\n` +
            `📸 Send photos anytime!`
          : `🚗 *Nuke Vehicle Data*\n\n` +
            `Welcome${user ? `, ${message.from.first_name}` : ""}!\n\n` +
            `*How to submit:*\n` +
            `📸 Send a photo of any vehicle\n` +
            `📝 Add a caption for context\n\n` +
            `*Examples:*\n` +
            `• Photo + "2019 GT3 RS oil change done"\n` +
            `• Photo + "VIN: WP0AF2A99KS123456"\n` +
            `• Just a photo (I'll ask questions)\n\n` +
            `Let's go! 🏎️`;

        await sendMessage(chatId, welcomeMsg);
        return new Response("OK");
      }

      // Check for approval command first
      const approval = parseApprovalMessage(text);
      if (approval.requestId && approval.action) {
        const result = await processApproval(approval.requestId, approval.action, approval.message);
        const emoji = approval.action === "approved" ? "✅" : "❌";

        if (result.success) {
          let msg = `${emoji} \`${approval.requestId}\` ${approval.action.toUpperCase()}`;
          if (approval.message) msg += `\n\n_Response: "${approval.message}"_`;
          await sendMessage(chatId, msg, message.message_id);
        } else {
          await sendMessage(chatId, `⚠️ Error: ${result.error || "Unknown"}`, message.message_id);
        }
        return new Response("OK");
      }

      // Quick commands
      if (["status", "s", "?", "queue"].includes(textLower)) {
        const status = await getQueueStatus();
        await sendMessage(chatId, status, message.message_id);
        return new Response("OK");
      }

      if (["approvals", "pending", "requests"].includes(textLower)) {
        const approvals = await getPendingApprovals();
        await sendMessage(chatId, approvals, message.message_id);
        return new Response("OK");
      }

      // Admin: list users
      if (textLower === "users" && chatId.toString() === OWNER_CHAT_ID) {
        const { data: users } = await supabase
          .from("telegram_users")
          .select("first_name, telegram_username, role, status, last_active_at")
          .order("last_active_at", { ascending: false })
          .limit(10);

        if (!users?.length) {
          await sendMessage(chatId, "No users yet", message.message_id);
        } else {
          let msg = "👥 *Recent Users*\n\n";
          users.forEach((u) => {
            const name = u.first_name || "Unknown";
            const username = u.telegram_username ? `@${u.telegram_username}` : "";
            const status = u.status === "active" ? "✅" : "⏳";
            msg += `${status} ${name} ${username} (${u.role})\n`;
          });
          await sendMessage(chatId, msg, message.message_id);
        }
        return new Response("OK");
      }

      // Admin: list recent submissions
      if (textLower === "submissions" && chatId.toString() === OWNER_CHAT_ID) {
        const { data: subs } = await supabase
          .from("telegram_submissions")
          .select("submission_type, status, caption, created_at, telegram_users(first_name)")
          .order("created_at", { ascending: false })
          .limit(10);

        if (!subs?.length) {
          await sendMessage(chatId, "No submissions yet", message.message_id);
        } else {
          let msg = "📋 *Recent Submissions*\n\n";
          subs.forEach((s: any) => {
            const user = s.telegram_users?.first_name || "?";
            const type = s.submission_type === "photo" ? "📸" : "📝";
            const status = s.status === "pending" ? "⏳" : "✅";
            const preview = s.caption?.slice(0, 30) || "(no caption)";
            msg += `${type}${status} ${user}: ${preview}\n`;
          });
          await sendMessage(chatId, msg, message.message_id);
        }
        return new Response("OK");
      }

      if (["help", "h", "commands"].includes(textLower)) {
        await sendMessage(
          chatId,
          `🤖 *Nuke Bot Help*\n\n` +
          `*Quick Commands:*\n` +
          `• \`status\` - Queue stats\n` +
          `• \`approvals\` - Pending permissions\n\n` +
          `*Approval Format:*\n` +
          `\`REQUEST_ID action\`\n` +
          `• \`ABC123 yes\` - Approve\n` +
          `• \`ABC123 no\` - Deny\n` +
          `• \`ABC123 go ahead and do it\` - Approve with message\n\n` +
          `For anything else, just ask naturally!`,
          message.message_id
        );
        return new Response("OK");
      }

      // Simple greetings - don't waste API calls
      const greetings = ["hi", "hello", "hey", "yo", "sup", "hola", "whats up", "what's up"];
      if (greetings.includes(textLower)) {
        const isOwner = chatId.toString() === OWNER_CHAT_ID;
        if (isOwner) {
          await sendMessage(chatId, `Hey! Commands: status, users, submissions, approvals`, message.message_id);
        } else {
          await sendMessage(
            chatId,
            `Hey ${message.from.first_name}! 👋\n\n` +
            `Send me a photo of a vehicle to get started.\n\n` +
            `Add a caption like:\n` +
            `• "2019 GT3 RS - oil change"\n` +
            `• "VIN WP0123..."\n` +
            `• "Brake job done"`,
            message.message_id
          );
        }
        return new Response("OK");
      }

      // For non-owners, guide them to send photos instead of queuing random text
      if (chatId.toString() !== OWNER_CHAT_ID) {
        await sendMessage(
          chatId,
          `📸 Send me a photo!\n\nI work best with vehicle photos. Add a caption to tell me what it is or what work was done.`,
          message.message_id
        );
        return new Response("OK");
      }

      // Queue complex queries (owner only)
      const queueResponse = await queueTask(text, chatId, message.message_id);
      await sendMessage(chatId, queueResponse, message.message_id);
      return new Response("OK");
    }

    return new Response("OK");
  } catch (error) {
    console.error("[nuke-bot] Error:", error);
    return new Response("Error", { status: 500 });
  }
});

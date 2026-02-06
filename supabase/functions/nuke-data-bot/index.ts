/**
 * Nuke Data Bot - Public Submissions
 *
 * Handles vehicle photo submissions from technicians/collectors.
 * NO approval logic - that's in telegram-approval-webhook.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const OWNER_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "7587296683";

// === TYPES ===

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number };
    text?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    caption?: string;
  };
}

interface TelegramUser {
  id: string;
  telegram_id: number;
  first_name: string;
  role: string;
  status: string;
}

// === HELPERS ===

async function sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "Markdown",
  };
  if (replyTo) payload.reply_to_message_id = replyTo;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendMessageWithButtons(chatId: number, text: string, buttons: Array<{text: string, data: string}>): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [buttons.map(b => ({ text: b.text, callback_data: b.data }))]
      }
    }),
  });
}

// === USER MANAGEMENT ===

async function getOrCreateUser(telegramId: number, firstName: string, username?: string): Promise<TelegramUser | null> {
  // Check existing
  const { data: existing } = await supabase
    .from("telegram_users")
    .select("id, telegram_id, first_name, role, status")
    .eq("telegram_id", telegramId)
    .single();

  if (existing) {
    await supabase.from("telegram_users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("telegram_id", telegramId);
    return existing;
  }

  // Create new
  const { data: newUser, error } = await supabase
    .from("telegram_users")
    .insert({
      telegram_id: telegramId,
      telegram_username: username,
      first_name: firstName,
      status: "active",
      role: "submitter",
    })
    .select("id, telegram_id, first_name, role, status")
    .single();

  if (error) {
    console.error("User creation failed:", error);
    return null;
  }

  // Notify owner
  await sendMessage(
    parseInt(OWNER_CHAT_ID),
    `🆕 *New Submitter*\n${firstName} (@${username || "none"})`
  );

  return newUser;
}

// === PHOTO HANDLING ===

async function handlePhoto(
  user: TelegramUser,
  chatId: number,
  messageId: number,
  photos: Array<{ file_id: string }>,
  caption?: string
): Promise<void> {
  const photo = photos[photos.length - 1]; // Largest

  // Get file from Telegram
  const fileResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
  const fileData = await fileResp.json();

  if (!fileData.ok) {
    await sendMessage(chatId, "⚠️ Couldn't get photo", messageId);
    return;
  }

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;

  // Download and upload to storage
  const photoResp = await fetch(fileUrl);
  const photoBlob = await photoResp.blob();

  const fileName = `submissions/${user.telegram_id}/${Date.now()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from("vehicle-photos")
    .upload(fileName, photoBlob, { contentType: "image/jpeg" });

  if (uploadErr) {
    console.error("Upload failed:", uploadErr);
    await sendMessage(chatId, "⚠️ Upload failed", messageId);
    return;
  }

  const { data: urlData } = supabase.storage.from("vehicle-photos").getPublicUrl(fileName);

  // Save submission
  await supabase.from("telegram_submissions").insert({
    telegram_user_id: user.id,
    submission_type: caption ? "work_update" : "photo",
    photo_urls: [urlData.publicUrl],
    caption,
    telegram_message_id: messageId,
    chat_id: chatId,
    status: "pending",
  });

  // Respond
  if (caption) {
    await sendMessage(chatId, `📸 Got it: "${caption.slice(0, 50)}${caption.length > 50 ? '...' : ''}"`, messageId);
  } else {
    await sendMessage(chatId, `📸 Photo saved!\n\nAdd details next time:\n• "2019 GT3 - oil change"\n• "VIN: WP0..."`, messageId);
  }
}

// === MAIN HANDLER ===

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Setup webhook
  if (url.searchParams.get("setup") === "true") {
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/nuke-data-bot`;
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    return new Response(JSON.stringify(await resp.json()), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method === "GET") {
    return new Response("Nuke Data Bot - Active", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update: TelegramUpdate = await req.json();

    if (!update.message) {
      return new Response("OK");
    }

    const { message } = update;
    const chatId = message.chat.id;
    const text = message.text || "";
    const isOwner = chatId.toString() === OWNER_CHAT_ID;

    // Get/create user
    const user = await getOrCreateUser(message.from.id, message.from.first_name, message.from.username);
    if (!user) {
      await sendMessage(chatId, "⚠️ Error registering. Try again.");
      return new Response("OK");
    }

    // Photo submission
    if (message.photo?.length) {
      await handlePhoto(user, chatId, message.message_id, message.photo, message.caption);
      return new Response("OK");
    }

    // Commands
    const cmd = text.toLowerCase().trim();

    if (cmd === "/start") {
      await sendMessage(chatId,
        `🚗 *Nuke Data Submission*\n\n` +
        `Hey ${user.first_name}!\n\n` +
        `*Send me vehicle photos:*\n` +
        `📸 Photo alone → I'll save it\n` +
        `📸 Photo + caption → Better context\n\n` +
        `*Good captions:*\n` +
        `• "2019 GT3 RS oil change done"\n` +
        `• "VIN: WP0AF2A99KS123456"\n` +
        `• "Brake pads replaced - 50k miles"\n\n` +
        `Let's go! 🏎️`
      );
      return new Response("OK");
    }

    if (cmd === "help" || cmd === "h") {
      await sendMessage(chatId,
        `📸 *Just send photos!*\n\n` +
        `Add a caption with:\n` +
        `• Vehicle info (year/make/model)\n` +
        `• VIN or plate\n` +
        `• Work description\n\n` +
        `That's it!`,
        message.message_id
      );
      return new Response("OK");
    }

    // Owner commands
    if (isOwner) {
      if (cmd === "users") {
        const { data } = await supabase
          .from("telegram_users")
          .select("first_name, telegram_username, status")
          .order("last_active_at", { ascending: false })
          .limit(10);

        const msg = data?.length
          ? `👥 *Users*\n\n` + data.map(u => `• ${u.first_name} @${u.telegram_username || '-'}`).join('\n')
          : "No users yet";
        await sendMessage(chatId, msg, message.message_id);
        return new Response("OK");
      }

      if (cmd === "submissions" || cmd === "subs") {
        const { data } = await supabase
          .from("telegram_submissions")
          .select("caption, created_at, telegram_users(first_name)")
          .order("created_at", { ascending: false })
          .limit(5);

        const msg = data?.length
          ? `📋 *Recent*\n\n` + data.map((s: any) =>
              `• ${s.telegram_users?.first_name || '?'}: ${s.caption?.slice(0, 30) || '(photo)'}`
            ).join('\n')
          : "No submissions yet";
        await sendMessage(chatId, msg, message.message_id);
        return new Response("OK");
      }

      if (cmd === "status") {
        const { count: userCount } = await supabase.from("telegram_users").select("*", { count: "exact", head: true });
        const { count: subCount } = await supabase.from("telegram_submissions").select("*", { count: "exact", head: true });
        await sendMessage(chatId, `📊 ${userCount || 0} users, ${subCount || 0} submissions`, message.message_id);
        return new Response("OK");
      }
    }

    // Default: prompt for photo
    await sendMessage(chatId, `📸 Send me a photo!\n\nAdd a caption to describe the vehicle or work done.`, message.message_id);

    return new Response("OK");
  } catch (error) {
    console.error("Error:", error);
    return new Response("Error", { status: 500 });
  }
});

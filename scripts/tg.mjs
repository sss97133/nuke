#!/usr/bin/env node
/**
 * tg — Text Skylar via Telegram from any terminal.
 *
 * Usage:
 *   dotenvx run -- node scripts/tg.mjs "your message here"
 *   dotenvx run -- node scripts/tg.mjs --read          # read last reply (disables webhook briefly)
 *   dotenvx run -- node scripts/tg.mjs --chat "msg"    # send + wait for reply
 *
 * Alias (add to package.json):
 *   "tg": "dotenvx run -- node scripts/tg.mjs"
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_URL = `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/patient-zero?telegram=1`;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }).then((r) => r.json());

async function send(text) {
  const r = await api("sendMessage", { chat_id: CHAT_ID, text });
  if (r.ok) {
    console.log(`sent (msg_id: ${r.result.message_id})`);
  } else {
    console.error("send failed:", r.description);
  }
  return r;
}

async function read(timeoutSec = 60) {
  // Temporarily disable webhook to use getUpdates polling
  await api("deleteWebhook", {});
  console.log("webhook paused, listening for reply...");

  try {
    const r = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=${timeoutSec}&allowed_updates=["message"]`,
      { signal: AbortSignal.timeout((timeoutSec + 5) * 1000) }
    ).then((r) => r.json());

    const msgs = (r.result || []).filter(
      (u) => u.message?.chat?.id?.toString() === CHAT_ID && u.message?.text
    );

    if (msgs.length > 0) {
      // Acknowledge updates
      const lastId = r.result[r.result.length - 1].update_id;
      await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastId + 1}`);

      for (const m of msgs) {
        console.log(`[${new Date(m.message.date * 1000).toLocaleTimeString()}] ${m.message.text}`);
      }
      return msgs.map((m) => m.message.text);
    } else {
      console.log(`no reply (${timeoutSec}s timeout)`);
      return [];
    }
  } finally {
    // Restore webhook
    const webhookBody = { url: WEBHOOK_URL, allowed_updates: ["message", "callback_query"] };
    if (WEBHOOK_SECRET) webhookBody.secret_token = WEBHOOK_SECRET;
    await api("setWebhook", webhookBody);
    console.log("webhook restored");
  }
}

async function chat(message, timeoutSec = 90) {
  await send(message);
  console.log("waiting for reply...");
  return read(timeoutSec);
}

// --- CLI ---
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("usage: tg \"message\"  |  tg --read  |  tg --chat \"message\"");
  process.exit(0);
}

if (args[0] === "--read") {
  await read(parseInt(args[1]) || 60);
} else if (args[0] === "--chat") {
  const msg = args.slice(1).join(" ");
  if (!msg) {
    console.error("provide a message: tg --chat \"your message\"");
    process.exit(1);
  }
  await chat(msg);
} else {
  await send(args.join(" "));
}

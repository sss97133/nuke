#!/usr/bin/env node
/**
 * tg-listen — Long-running Telegram listener that writes replies to a file.
 * Other processes watch the file for new messages.
 *
 * Usage: dotenvx run -- node scripts/tg-listen.mjs
 * Output: /tmp/tg-replies.jsonl (one JSON object per message)
 */

import { writeFileSync, appendFileSync } from "fs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_URL = `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/patient-zero?telegram=1`;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const OUTPUT = "/tmp/tg-replies.jsonl";

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function restoreWebhook() {
  const body = { url: WEBHOOK_URL, allowed_updates: ["message", "callback_query"] };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
  await api("setWebhook", body);
}

// Cleanup on exit
process.on("SIGINT", async () => { await restoreWebhook(); process.exit(0); });
process.on("SIGTERM", async () => { await restoreWebhook(); process.exit(0); });

// Disable webhook for polling
await api("deleteWebhook", {});
console.log("webhook paused, listening...");

// Clear output file
writeFileSync(OUTPUT, "");

let offset = 0;

// Get current offset to skip old messages
const init = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1`).then(r => r.json());
if (init.result?.length > 0) {
  offset = init.result[init.result.length - 1].update_id + 1;
}

while (true) {
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`,
      { signal: AbortSignal.timeout(35000) }
    ).then((r) => r.json());

    for (const u of r.result || []) {
      offset = u.update_id + 1;
      if (u.message?.chat?.id?.toString() === CHAT_ID && u.message?.text) {
        const entry = {
          ts: new Date().toISOString(),
          text: u.message.text,
          msg_id: u.message.message_id,
        };
        appendFileSync(OUTPUT, JSON.stringify(entry) + "\n");
        console.log(`[${entry.ts}] ${entry.text}`);
      }
    }
  } catch (e) {
    // Timeout or network error, just retry
    if (!e.message?.includes("abort")) {
      console.error("poll error:", e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

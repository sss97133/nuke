/**
 * _telegram.ts — shared Telegram notification helper
 *
 * Uses TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from env.
 * Sends markdown-formatted messages to your personal chat.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/** Convert @handle → <a href="https://x.com/handle">@handle</a> so Telegram links to X, not Telegram profiles */
export function linkXHandles(text: string): string {
  return text.replace(/@([A-Za-z0-9_]+)/g, '<a href="https://x.com/$1">@$1</a>');
}

export async function sendTelegram(message: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("  ⚠️  Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)");
    return;
  }

  // Telegram MarkdownV2 requires escaping, so use HTML mode instead — simpler
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn(`  ⚠️  Telegram send failed: ${JSON.stringify(err)}`);
  }
}

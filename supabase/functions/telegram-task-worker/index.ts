/**
 * Telegram Task Worker - Cloud-based task processor
 *
 * Uses Claude API to process tasks from telegram_tasks table.
 * Can be triggered via:
 * 1. HTTP POST (webhook)
 * 2. Cron job
 * 3. Database trigger
 *
 * POST /functions/v1/telegram-task-worker
 *   ?process=true  - Process one pending task
 *   ?process_all=true  - Process all pending tasks (up to 10)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

interface Task {
  id: string;
  prompt: string;
  chat_id: number;
  task_type: string;
  context: Record<string, any>;
  reply_to_message_id?: number;
}

// Send message to Telegram
async function sendTelegram(chatId: number, text: string, replyTo?: number): Promise<boolean> {
  try {
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
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4000),
          reply_to_message_id: replyTo,
        }),
      });
    }

    return true;
  } catch (e) {
    console.error("Telegram send error:", e);
    return false;
  }
}

// Get queue status from database
async function getQueueStatus(): Promise<string> {
  const { data, error } = await supabase
    .from("import_queue")
    .select("status")
    .limit(50000);

  if (error) {
    return `⚠️ Error: ${error.message}`;
  }

  const counts: Record<string, number> = {};
  (data || []).forEach((item: { status: string }) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });

  const emojiMap: Record<string, string> = {
    complete: "✅",
    pending: "⏳",
    processing: "🔄",
    failed: "❌",
    skipped: "⏭️",
    duplicate: "♻️",
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

// Get vehicle count
async function getVehicleCount(): Promise<number> {
  const { count, error } = await supabase
    .from("vehicles")
    .select("id", { count: "exact", head: true });

  return error ? -1 : (count || 0);
}

// Handle quick queries without AI
function handleQuickQuery(prompt: string): string | null {
  const lower = prompt.toLowerCase().trim();

  if (["status", "queue", "stats", "?"].includes(lower)) {
    return "QUEUE_STATUS"; // Marker to fetch queue status
  }

  if (lower.includes("how many vehicles") || lower.includes("vehicle count")) {
    return "VEHICLE_COUNT";
  }

  return null;
}

// Process with Claude API
async function processWithClaude(prompt: string, context: Record<string, any>): Promise<string> {
  if (!ANTHROPIC_KEY) {
    return "⚠️ Claude API not configured. Please add ANTHROPIC_API_KEY.";
  }

  const systemPrompt = `You are a Telegram assistant for the Nuke vehicle data platform.

RULES:
1. Be VERY concise - responses are for Telegram (aim for <500 chars)
2. Use emojis for visual clarity
3. Format for mobile: short lines, bullet points
4. Always be helpful and direct

CONTEXT:
- Nuke is a vehicle data extraction platform
- It processes auction listings from BaT, C&B, Mecum, etc.
- Data is stored in Supabase (PostgreSQL)

When asked about data, provide helpful responses based on your knowledge.
If you don't have current data, acknowledge that and suggest what the user might check.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307", // Fast and cheap
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Claude API error:", err);
      return `⚠️ API error: ${response.status}`;
    }

    const result = await response.json();
    return result.content?.[0]?.text || "No response";
  } catch (e) {
    console.error("Claude API error:", e);
    return `⚠️ Error: ${e.message}`;
  }
}

// Process a single task
async function processTask(task: Task): Promise<{ success: boolean; result: string }> {
  const { prompt, context } = task;

  // Try quick query first
  const quickResult = handleQuickQuery(prompt);
  if (quickResult) {
    if (quickResult === "QUEUE_STATUS") {
      return { success: true, result: await getQueueStatus() };
    }
    if (quickResult === "VEHICLE_COUNT") {
      const count = await getVehicleCount();
      return {
        success: true,
        result: count >= 0 ? `🚗 *Vehicles:* ${count.toLocaleString()}` : "⚠️ Could not get count",
      };
    }
  }

  // Use Claude for complex queries
  const result = await processWithClaude(prompt, context);
  return { success: !result.startsWith("⚠️"), result };
}

// Claim and process tasks
async function claimAndProcess(limit: number = 1): Promise<number> {
  // Get pending tasks
  const { data: tasks, error } = await supabase
    .from("telegram_tasks")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !tasks?.length) {
    return 0;
  }

  let processed = 0;

  for (const task of tasks) {
    // Mark as processing
    await supabase
      .from("telegram_tasks")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        assigned_to: "cloud_worker",
      })
      .eq("id", task.id);

    // Process
    const { success, result } = await processTask(task);

    // Send to Telegram
    if (task.chat_id) {
      const emoji = success ? "✅" : "⚠️";
      await sendTelegram(task.chat_id, `${emoji} ${result}`, task.reply_to_message_id);
    }

    // Mark complete
    await supabase
      .from("telegram_tasks")
      .update({
        status: success ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        result_text: result.slice(0, 5000),
        error: success ? null : result,
      })
      .eq("id", task.id);

    processed++;
  }

  return processed;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (req.method === "GET" && !url.searchParams.has("process")) {
    const { count } = await supabase
      .from("telegram_tasks")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    return new Response(
      JSON.stringify({
        status: "ok",
        pending_tasks: count || 0,
        anthropic_configured: !!ANTHROPIC_KEY,
        telegram_configured: !!BOT_TOKEN,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Process tasks
  if (url.searchParams.has("process") || url.searchParams.has("process_all")) {
    const limit = url.searchParams.has("process_all") ? 10 : 1;
    const processed = await claimAndProcess(limit);

    return new Response(
      JSON.stringify({
        processed,
        message: processed > 0 ? `Processed ${processed} task(s)` : "No pending tasks",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Test query
  if (req.method === "POST") {
    const body = await req.json();
    const prompt = body.prompt || body.query || "status";
    const chatId = body.chat_id;

    const task: Task = {
      id: "test",
      prompt,
      chat_id: chatId,
      task_type: "query",
      context: {},
    };

    const { success, result } = await processTask(task);

    // Optionally send to Telegram
    if (chatId) {
      await sendTelegram(chatId, success ? `✅ ${result}` : `⚠️ ${result}`);
    }

    return new Response(
      JSON.stringify({ success, result }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("Method not allowed", { status: 405 });
});

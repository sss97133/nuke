/**
 * cron-startup-timeout-alert
 *
 * Detects pg_cron slot exhaustion spikes by counting `job startup timeout`
 * errors in the last 2 minutes from cron.job_run_details.
 *
 * If count > 10, fires a Telegram alert via TELEGRAM_BOT_TOKEN to TELEGRAM_CHAT_ID.
 *
 * Called every 5 minutes by pg_cron. This alert would have detected the
 * 2026-02-27 07:41 PGRST002 outage within 2 minutes.
 *
 * Reference: docs/post-mortems/2026-02-27-pgrst002-schema-cache-outage.md
 *
 * POST /functions/v1/cron-startup-timeout-alert
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const THRESHOLD = 10; // alert if more than this many startup timeouts in window

serve(async (req) => {
  // Allow GET for manual health checks
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Count startup timeouts in last 2 minutes
    const { data, error } = await supabase.rpc("count_startup_timeouts_last_2min");

    let timeoutCount = 0;
    if (error) {
      // Fallback: direct query via pg_net-style SQL won't work here,
      // so we handle the RPC-not-found case gracefully and try raw query
      console.warn("[startup-alert] RPC unavailable, trying raw query:", error.message);

      const { data: rawData, error: rawError } = await supabase
        .from("cron.job_run_details")
        .select("runid", { count: "exact", head: true })
        .gt("start_time", new Date(Date.now() - 2 * 60 * 1000).toISOString())
        .ilike("return_message", "%startup timeout%");

      if (rawError) {
        // cron schema queries require direct SQL; fall back to http-only approach
        console.error("[startup-alert] Raw query also failed:", rawError.message);
        return new Response(JSON.stringify({ ok: false, error: rawError.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      timeoutCount = rawData as unknown as number ?? 0;
    } else {
      timeoutCount = (data as number) ?? 0;
    }

    console.log(`[startup-alert] Startup timeouts in last 2 min: ${timeoutCount}`);

    if (timeoutCount > THRESHOLD) {
      const alertText =
        `🚨 *pg_cron slot exhaustion spike detected*\n\n` +
        `*${timeoutCount} job startup timeouts* in the last 2 minutes.\n\n` +
        `This pattern preceded the 2026-02-27 PGRST002 outage.\n\n` +
        `*Immediate actions:*\n` +
        `• Check \`cron.job_run_details\` for which jobs are overrunning\n` +
        `• Run \`SELECT release_stale_locks();\`\n` +
        `• Consider pausing quality backfill workers if running\n` +
        `• Watch for PGRST002 errors in edge function logs\n\n` +
        `Time: ${new Date().toISOString()}`;

      const telegramResult = await sendTelegramAlert(alertText);
      console.log("[startup-alert] Telegram result:", JSON.stringify(telegramResult));

      return new Response(
        JSON.stringify({
          ok: true,
          alert_fired: true,
          timeout_count: timeoutCount,
          threshold: THRESHOLD,
          telegram: telegramResult,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        alert_fired: false,
        timeout_count: timeoutCount,
        threshold: THRESHOLD,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[startup-alert] Unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function sendTelegramAlert(text: string): Promise<{ sent: boolean; error?: string }> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId =
    Deno.env.get("TELEGRAM_CHAT_ID") ||
    Deno.env.get("TELEGRAM_CHANNEL_ID") ||
    "7587296683";

  if (!botToken) {
    console.error("[startup-alert] TELEGRAM_BOT_TOKEN not set — alert not sent");
    return { sent: false, error: "TELEGRAM_BOT_TOKEN not set" };
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const result = await resp.json().catch(() => ({ ok: false, description: `HTTP ${resp.status}` }));
    if (!result.ok) {
      console.error("[startup-alert] Telegram sendMessage failed:", result.description);
      return { sent: false, error: result.description };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: String(err) };
  }
}

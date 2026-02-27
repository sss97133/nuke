/**
 * yono-keepalive — pings YONO Modal sidecar to prevent cold starts.
 * Runs every 5 minutes via pg_cron (job 249).
 * Modal scaledown_window=600s, so pinging every 5min keeps it warm indefinitely.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";

serve(async () => {
  try {
    const resp = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    const health = resp.ok ? await resp.json() : null;
    return new Response(
      JSON.stringify({
        ok: resp.ok,
        vision_available: health?.vision_available ?? false,
        uptime_s: health?.uptime_s ?? null,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
});

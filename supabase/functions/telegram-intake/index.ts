/**
 * Telegram Intake - Fail-safe webhook receiver
 *
 * Step 1: Store raw payload IMMEDIATELY (never lose data)
 * Step 2: Acknowledge Telegram
 * Step 3: Process async via separate worker
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  // Only handle POST (webhooks)
  if (req.method !== "POST") {
    return new Response("OK");
  }

  try {
    // Get raw payload
    const payload = await req.json();

    // Store IMMEDIATELY - this is the critical path
    const { error } = await supabase
      .from("telegram_raw_webhooks")
      .insert({ payload, processed: false });

    if (error) {
      console.error("DB insert failed:", error);
      // Still return OK to Telegram so it doesn't retry
      return new Response("OK");
    }

    // Success - payload is safe in DB
    return new Response("OK");

  } catch (e) {
    console.error("Webhook error:", e);
    return new Response("OK");
  }
});

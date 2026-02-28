/**
 * Ingest External Profile
 *
 * Lightweight endpoint for on-demand profile import from /claim-identity.
 * Validates a profile URL, upserts into external_identities, and queues
 * for async extraction at priority 90 (jumps ahead of the 1M backlog).
 *
 * The existing trigger (queue_user_profile_from_identity) auto-inserts
 * at priority 40 — we bump it to 90 after the upsert.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const URL_PATTERNS: Record<string, { regex: RegExp; extractUsername: (m: RegExpMatchArray) => string }> = {
  bat: {
    regex: /bringatrailer\.com\/member\/([^\/\?\#]+)/i,
    extractUsername: (m) => m[1].toLowerCase(),
  },
  cars_and_bids: {
    regex: /carsandbids\.com\/user\/([^\/\?\#]+)/i,
    extractUsername: (m) => m[1],
  },
  pcarmarket: {
    regex: /pcarmarket\.com\/member\/([^\/\?\#]+)/i,
    extractUsername: (m) => m[1],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { platform, profile_url, notify_user_id } = await req.json();

    // --- Validate inputs ---
    if (!platform || !profile_url) {
      return new Response(
        JSON.stringify({ error: "platform and profile_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const pattern = URL_PATTERNS[platform];
    if (!pattern) {
      return new Response(
        JSON.stringify({ error: `Unsupported platform: ${platform}. Supported: ${Object.keys(URL_PATTERNS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const match = profile_url.match(pattern.regex);
    if (!match) {
      return new Response(
        JSON.stringify({ error: `Invalid ${platform} profile URL. Expected format: ${getExampleUrl(platform)}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const username = pattern.extractUsername(match);

    // Normalize the profile URL
    const normalizedUrl = normalizeProfileUrl(platform, username);

    // --- DB operations ---
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Upsert external_identities (trigger auto-queues at priority 40)
    const { data: identity, error: upsertError } = await supabase
      .from("external_identities")
      .upsert(
        {
          platform,
          handle: username,
          profile_url: normalizedUrl,
        },
        { onConflict: "platform,handle" },
      )
      .select("id, platform, handle, profile_url, display_name, first_seen_at, last_seen_at, claimed_by_user_id, metadata")
      .single();

    if (upsertError) {
      throw new Error(`Failed to upsert identity: ${upsertError.message}`);
    }

    // Bump queue priority to 90 for user-requested imports
    // The trigger may have just inserted at priority 40, or it may already exist
    const { error: queueError } = await supabase
      .from("user_profile_queue")
      .update({
        priority: 90,
        discovered_via: "user_request",
        metadata: notify_user_id ? { notify_user_id } : {},
      })
      .eq("profile_url", normalizedUrl)
      .eq("platform", platform)
      .eq("status", "pending");

    // If no pending entry exists (already processed or trigger didn't fire), insert one
    if (!queueError) {
      const { data: existing } = await supabase
        .from("user_profile_queue")
        .select("id")
        .eq("profile_url", normalizedUrl)
        .eq("platform", platform)
        .in("status", ["pending", "processing"])
        .limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from("user_profile_queue").insert({
          profile_url: normalizedUrl,
          platform,
          username,
          external_identity_id: identity.id,
          priority: 90,
          discovered_via: "user_request",
          metadata: notify_user_id ? { notify_user_id } : {},
        });
      }
    }

    console.log(`Ingested profile: ${platform}/${username} (identity: ${identity.id})`);

    // Return identity in the shape the frontend expects
    return new Response(
      JSON.stringify({
        success: true,
        identity: {
          id: identity.id,
          platform: identity.platform,
          handle: identity.handle,
          display_name: identity.display_name,
          profile_url: identity.profile_url,
          first_seen: identity.first_seen_at,
          last_seen: identity.last_seen_at,
          claimed: !!identity.claimed_by_user_id,
          stats: null, // Stats will be populated async by the queue worker
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("ingest-external-profile error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function normalizeProfileUrl(platform: string, username: string): string {
  switch (platform) {
    case "bat":
      return `https://bringatrailer.com/member/${username}/`;
    case "cars_and_bids":
      return `https://carsandbids.com/user/${username}`;
    case "pcarmarket":
      return `https://pcarmarket.com/member/${username}`;
    default:
      return "";
  }
}

function getExampleUrl(platform: string): string {
  switch (platform) {
    case "bat":
      return "https://bringatrailer.com/member/username/";
    case "cars_and_bids":
      return "https://carsandbids.com/user/username";
    case "pcarmarket":
      return "https://pcarmarket.com/member/username";
    default:
      return "";
  }
}

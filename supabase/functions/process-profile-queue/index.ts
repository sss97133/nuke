/**
 * Process Profile Queue
 *
 * Cron-driven worker that processes user_profile_queue items.
 * Claims the highest-priority pending items, calls extract-bat-profile-vehicles
 * (or platform equivalent), then notifies the requesting user.
 *
 * Based on: _archived/process-user-profile-queue/index.ts
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { batchSize = 3 } = await req.json().catch(() => ({ batchSize: 3 }));
    const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 3, 5));

    console.log(`Processing profile queue (batch: ${safeBatchSize})`);

    // Claim highest-priority items atomically
    const { data: items, error: claimError } = await supabase.rpc(
      "claim_user_profile_queue_batch",
      { p_batch_size: safeBatchSize, p_lock_duration_minutes: 20 },
    );

    if (claimError) {
      throw new Error(`Failed to claim queue: ${claimError.message}`);
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "Queue empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Claimed ${items.length} items (priorities: ${items.map((i: any) => i.priority).join(",")})`);

    const results = { processed: 0, completed: 0, failed: 0, notified: 0, errors: [] as string[] };

    for (const item of items) {
      results.processed++;
      try {
        console.log(`Processing: ${item.platform}/${item.username} (priority ${item.priority})`);

        // Call the appropriate extractor
        const extractionResult = await extractProfile(item);

        if (extractionResult.success) {
          // Update external_identity with extracted metadata
          if (item.external_identity_id) {
            await supabase
              .from("external_identities")
              .update({
                metadata: extractionResult.metadata || {},
                last_seen_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", item.external_identity_id);
          }

          // Mark queue item complete
          await supabase
            .from("user_profile_queue")
            .update({
              status: "complete",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
            })
            .eq("id", item.id);

          results.completed++;
          console.log(`Completed: ${item.platform}/${item.username}`);

          // Notify requesting user if applicable
          const notifyUserId = item.metadata?.notify_user_id;
          if (notifyUserId) {
            await notifyUser(supabase, notifyUserId, item);
            results.notified++;
          }
        } else {
          throw new Error(extractionResult.error || "Extraction failed");
        }
      } catch (error: any) {
        results.failed++;
        const msg = error.message || String(error);
        results.errors.push(`${item.profile_url}: ${msg}`);
        console.error(`Failed: ${item.profile_url} — ${msg}`);

        // Release lock, retry or fail
        await supabase
          .from("user_profile_queue")
          .update({
            status: item.attempts >= item.max_attempts ? "failed" : "pending",
            error_message: msg,
            updated_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          })
          .eq("id", item.id);
      }

      // Small delay between items
      if (results.processed < items.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("process-profile-queue error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Call platform-specific extraction
 */
async function extractProfile(
  item: { profile_url: string; platform: string; username: string | null },
): Promise<{ success: boolean; metadata?: any; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (item.platform === "bat") {
    // Use extract-bat-profile-vehicles
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-bat-profile-vehicles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        profile_url: item.profile_url,
        username: item.username,
        extract_vehicles: false,
        queue_only: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }

    const result = await res.json();
    return {
      success: true,
      metadata: {
        listings_found: result.listings_found || 0,
        listing_urls: result.listing_urls || [],
        extracted_at: new Date().toISOString(),
      },
    };
  }

  if (item.platform === "cars_and_bids") {
    // Lightweight HTML scrape for C&B profiles
    try {
      const res = await fetch(item.profile_url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

      const html = await res.text();
      const metadata: any = {
        extracted_at: new Date().toISOString(),
        profile_url: item.profile_url,
        username: item.username,
      };

      const listingsMatch = html.match(/(\d+)\s+listings?/i);
      if (listingsMatch) metadata.listings_count = parseInt(listingsMatch[1]);

      return { success: true, metadata };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  if (item.platform === "pcarmarket") {
    // Lightweight HTML scrape for PCarMarket profiles
    try {
      const res = await fetch(item.profile_url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

      return {
        success: true,
        metadata: {
          extracted_at: new Date().toISOString(),
          profile_url: item.profile_url,
          username: item.username,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: `Unsupported platform: ${item.platform}` };
}

/**
 * Send in-app notification + email to the requesting user
 */
async function notifyUser(
  supabase: any,
  userId: string,
  item: { platform: string; username: string | null; profile_url: string },
) {
  const platformLabel =
    { bat: "Bring a Trailer", cars_and_bids: "Cars & Bids", pcarmarket: "PCarMarket" }[item.platform] ||
    item.platform;

  const handle = item.username || "your profile";
  const actionUrl = `/claim-identity?platform=${item.platform}&handle=${encodeURIComponent(handle)}`;

  // In-app notification
  try {
    await supabase.rpc("create_user_notification", {
      p_user_id: userId,
      p_notification_type: "profile_import_ready",
      p_title: `${platformLabel} profile imported`,
      p_message: `Your profile "${handle}" has been imported and is ready to claim.`,
      p_action_url: actionUrl,
      p_metadata: { platform: item.platform, handle, profile_url: item.profile_url },
    });
    console.log(`Notification sent to ${userId}`);
  } catch (e: any) {
    console.error(`Failed to create notification: ${e.message}`);
  }

  // Email notification
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, display_name")
      .eq("id", userId)
      .single();

    if (profile?.email) {
      await sendEmail({
        to: profile.email,
        subject: `Your ${platformLabel} profile is ready to claim`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 500px;">
            <h2 style="font-size: 18px; margin-bottom: 12px;">Profile imported</h2>
            <p style="font-size: 14px; color: #555;">
              Your ${platformLabel} profile <strong>${handle}</strong> has been imported
              with full stats. You can now claim it on Nuke.
            </p>
            <a href="https://nuke.ag${actionUrl}"
               style="display: inline-block; margin-top: 16px; padding: 10px 20px;
                      background: #000; color: #fff; text-decoration: none;
                      border-radius: 4px; font-size: 13px; font-weight: 600;">
              Claim Your Profile
            </a>
            <p style="font-size: 11px; color: #999; margin-top: 24px;">
              — Nuke (nuke.ag)
            </p>
          </div>
        `,
      });
      console.log(`Email sent to ${profile.email}`);
    }
  } catch (e: any) {
    console.error(`Failed to send email: ${e.message}`);
  }
}

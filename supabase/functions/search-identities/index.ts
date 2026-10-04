/**
 * SEARCH IDENTITIES - Find claimable external identities
 *
 * Lets users search for their BaT/C&B/forum handles to claim them.
 * Returns identity info + activity stats so they can see what they'll inherit.
 *
 * POST /functions/v1/search-identities
 * { "query": "911r", "platform": "bat", "limit": 20 }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const query = (body.query || "").trim().toLowerCase();
    const platform = body.platform || null; // null = all platforms
    const limit = Math.min(body.limit || 20, 50);

    if (!query || query.length < 2) {
      return new Response(JSON.stringify({
        error: "Query must be at least 2 characters",
        results: []
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search external_identities
    let identityQuery = supabase
      .from("external_identities")
      .select("id, platform, handle, display_name, profile_url, claimed_by_user_id, first_seen_at, last_seen_at, metadata")
      .ilike("handle", `%${query}%`)
      .is("claimed_by_user_id", null) // Only unclaimed
      .order("handle")
      .limit(limit);

    if (platform) {
      identityQuery = identityQuery.eq("platform", platform);
    }

    const { data: identities, error: idError } = await identityQuery;

    if (idError) throw idError;

    // For BaT identities, enrich with activity stats
    const enrichedResults = await Promise.all(
      (identities || []).map(async (identity) => {
        const result: any = {
          id: identity.id,
          platform: identity.platform,
          handle: identity.handle,
          display_name: identity.display_name,
          profile_url: identity.profile_url,
          first_seen: identity.first_seen_at,
          last_seen: identity.last_seen_at,
          claimed: false,
          stats: null,
        };

        // Get BaT-specific stats
        if (identity.platform === "bat") {
          const profileColumns = "external_identity_id, total_comments, total_bids, total_wins, expertise_score, community_trust_score, first_seen, last_seen, metadata";
          let { data: batProfile, error: profileError } = await supabase
            .from("bat_user_profiles")
            .select(profileColumns)
            .eq("external_identity_id", identity.id)
            .eq("username", identity.handle)
            .maybeSingle();
          if (profileError) throw profileError;

          // Historical profiles have no UUID until a real BaT event reaches
          // the fold. Retain exact platform-qualified enrichment for those
          // rows only; never borrow another identity's keyed profile.
          if (!batProfile) {
            const legacy = await supabase
              .from("bat_user_profiles")
              .select(profileColumns)
              .eq("username", identity.handle)
              .is("external_identity_id", null)
              .maybeSingle();
            if (legacy.error) throw legacy.error;
            batProfile = legacy.data;
          }

          if (batProfile) {
            const record = batProfile.metadata?.bat_bidder_record;
            const replayed = record?.method === "published_buyer_v1";
            const eligible = replayed && record.eligible_closed_presentations > 0;
            result.stats = {
              comments: batProfile.total_comments ?? null,
              bids: batProfile.total_bids ?? null,
              wins: eligible ? (batProfile.total_wins ?? null) : null,
              // No assayed expertise/trust model exists. A source-like proxy
              // is exposed with its actual unit, never as confidence or skill.
              expertise_score: null,
              trust_score: null,
              source_like_points: replayed ? (batProfile.community_trust_score ?? null) : null,
              active_since: batProfile.first_seen,
              last_active: batProfile.last_seen,
              basis: {
                scope: "cumulative_captured_history",
                counts: replayed ? "replayed_then_incremental" : "legacy_baseline_unreplayed",
                awards: replayed ? "published_buyer_evidence" : "unmeasured",
                record_refreshed_at: replayed ? (record.refreshed_at ?? null) : null,
                coverage: replayed ? {
                  observed_bid_presentations: record.observed_bid_presentations ?? null,
                  eligible_closed_presentations: record.eligible_closed_presentations ?? null,
                  unknown_outcome_presentations: record.unknown_outcome_presentations ?? null,
                  unlinked_presentations: record.unlinked_presentations ?? null,
                  unkeyed_bid_comments: record.unkeyed_bid_comments ?? null,
                } : null,
              },
            };
          }
        }

        return result;
      })
    );

    // Also check for exact match that might be claimed (to tell user)
    const { data: exactMatch } = await supabase
      .from("external_identities")
      .select("id, handle, claimed_by_user_id")
      .eq("handle", query)
      .single();

    const response = {
      query,
      platform,
      results: enrichedResults,
      total_found: enrichedResults.length,
      exact_match_claimed: exactMatch?.claimed_by_user_id ? true : false,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

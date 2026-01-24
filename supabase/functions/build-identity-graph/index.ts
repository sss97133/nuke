/**
 * BUILD IDENTITY GRAPH
 *
 * Links bidder/commenter usernames to external_identities and builds
 * behavioral profiles for market participants.
 *
 * POST /functions/v1/build-identity-graph
 * {
 *   "action": "link_bidders" | "profile_user" | "find_power_users" | "segment_users"
 *   "username": "..." (for profile_user)
 *   "limit": 100
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IdentityRequest {
  action: "link_bidders" | "profile_user" | "find_power_users" | "segment_users";
  username?: string;
  limit?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: IdentityRequest = await req.json().catch(() => ({ action: "find_power_users" }));
    const { action, username, limit = 50 } = body;

    // ============ PROFILE SPECIFIC USER ============
    if (action === "profile_user" && username) {
      // Get all observations by this user
      const { data: userObs } = await supabase
        .from("vehicle_observations")
        .select("kind, structured_data, vehicle_id, observed_at")
        .or(`structured_data->>author_username.eq.${username}`)
        .order("observed_at", { ascending: false })
        .limit(1000);

      if (!userObs || userObs.length === 0) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Aggregate user behavior
      const bids = userObs.filter(o => o.kind === "bid");
      const comments = userObs.filter(o => o.kind === "comment");
      const vehicleIds = [...new Set(userObs.map(o => o.vehicle_id))];

      // Get vehicle details for context
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id, year, make, model, sale_price")
        .in("id", vehicleIds.slice(0, 50));

      const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));

      // Calculate bid stats
      const bidAmounts = bids.map(b => b.structured_data?.bid_amount || 0).filter(a => a > 0);
      const bidsByVehicle = bids.reduce((acc, b) => {
        const vehicle = vehicleMap.get(b.vehicle_id);
        if (vehicle) {
          const key = `${vehicle.make}`.toLowerCase();
          acc[key] = (acc[key] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      const profile = {
        username,
        activity_summary: {
          total_bids: bids.length,
          total_comments: comments.length,
          unique_vehicles: vehicleIds.length,
          first_seen: userObs[userObs.length - 1]?.observed_at,
          last_seen: userObs[0]?.observed_at,
        },
        bid_behavior: {
          total_bid_value: bidAmounts.reduce((a, b) => a + b, 0),
          avg_bid: bidAmounts.length > 0 ? Math.round(bidAmounts.reduce((a, b) => a + b, 0) / bidAmounts.length) : 0,
          max_bid: Math.max(...bidAmounts, 0),
          min_bid: bidAmounts.length > 0 ? Math.min(...bidAmounts) : 0,
          bid_count_by_make: Object.entries(bidsByVehicle)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([make, count]) => ({ make, count })),
        },
        recent_activity: userObs.slice(0, 10).map(o => ({
          type: o.kind,
          vehicle: vehicleMap.get(o.vehicle_id),
          amount: o.structured_data?.bid_amount,
          date: o.observed_at,
        })),
        vehicles_targeted: (vehicles || []).slice(0, 20).map(v => ({
          year: v.year,
          make: v.make,
          model: v.model,
          sale_price: v.sale_price,
        })),
      };

      return new Response(JSON.stringify(profile, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ FIND POWER USERS ============
    if (action === "find_power_users") {
      // Get all bids
      const { data: allBids } = await supabase
        .from("vehicle_observations")
        .select("structured_data, vehicle_id")
        .eq("kind", "bid")
        .limit(100000);

      // Get all comments
      const { data: allComments } = await supabase
        .from("vehicle_observations")
        .select("structured_data, vehicle_id")
        .eq("kind", "comment")
        .limit(100000);

      const userStats: Record<string, {
        bids: number;
        comments: number;
        total_bid_value: number;
        vehicles: Set<string>;
        max_bid: number;
      }> = {};

      // Process bids
      for (const b of (allBids || [])) {
        const username = b.structured_data?.author_username;
        const amount = b.structured_data?.bid_amount || 0;
        if (!username) continue;

        if (!userStats[username]) {
          userStats[username] = { bids: 0, comments: 0, total_bid_value: 0, vehicles: new Set(), max_bid: 0 };
        }
        userStats[username].bids++;
        userStats[username].total_bid_value += amount;
        userStats[username].vehicles.add(b.vehicle_id);
        userStats[username].max_bid = Math.max(userStats[username].max_bid, amount);
      }

      // Process comments
      for (const c of (allComments || [])) {
        const username = c.structured_data?.author_username;
        if (!username) continue;

        if (!userStats[username]) {
          userStats[username] = { bids: 0, comments: 0, total_bid_value: 0, vehicles: new Set(), max_bid: 0 };
        }
        userStats[username].comments++;
        userStats[username].vehicles.add(c.vehicle_id);
      }

      // Rank users
      const powerUsers = Object.entries(userStats)
        .map(([username, stats]) => ({
          username,
          total_activity: stats.bids + stats.comments,
          bids: stats.bids,
          comments: stats.comments,
          total_bid_value: stats.total_bid_value,
          max_bid: stats.max_bid,
          unique_vehicles: stats.vehicles.size,
          engagement_score: stats.bids * 10 + stats.comments + Math.log10(stats.total_bid_value + 1) * 5,
        }))
        .sort((a, b) => b.engagement_score - a.engagement_score)
        .slice(0, limit);

      // Segment them
      const segments = {
        whales: powerUsers.filter(u => u.total_bid_value > 500000),
        active_bidders: powerUsers.filter(u => u.bids > 10 && u.total_bid_value <= 500000),
        commenters: powerUsers.filter(u => u.comments > 20 && u.bids <= 5),
        browsers: powerUsers.filter(u => u.unique_vehicles > 20 && u.bids <= 3),
      };

      return new Response(JSON.stringify({
        total_users_analyzed: Object.keys(userStats).length,
        power_users: powerUsers,
        segments,
        summary: {
          total_whales: segments.whales.length,
          total_active_bidders: segments.active_bidders.length,
          total_commenters: segments.commenters.length,
          whale_total_value: segments.whales.reduce((a, b) => a + b.total_bid_value, 0),
        },
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ LINK BIDDERS TO IDENTITIES ============
    if (action === "link_bidders") {
      // Get unique usernames from observations
      const { data: obsData } = await supabase
        .from("vehicle_observations")
        .select("structured_data")
        .in("kind", ["bid", "comment"])
        .limit(50000);

      const usernames = [...new Set(
        (obsData || [])
          .map(o => o.structured_data?.author_username)
          .filter(Boolean)
      )];

      // Check which already have external_identities (table uses 'handle' not 'username')
      const { data: existingIds } = await supabase
        .from("external_identities")
        .select("handle, profile_url")
        .eq("platform", "bat")
        .in("handle", usernames.slice(0, 1000));

      const existingUsernames = new Set((existingIds || []).map(i => i.handle));
      const newUsernames = usernames.filter(u => !existingUsernames.has(u));

      // Create new identities for unlinked users
      if (newUsernames.length > 0) {
        const newIdentities = newUsernames.slice(0, 100).map(handle => ({
          platform: "bat",
          handle,
          profile_url: `https://bringatrailer.com/member/${handle}/`,
          metadata: { discovered_from: "observation_linkage", discovered_at: new Date().toISOString() },
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        }));

        const { error } = await supabase
          .from("external_identities")
          .upsert(newIdentities, { onConflict: "platform,handle", ignoreDuplicates: true });

        if (error) console.error("Identity upsert error:", error);
      }

      return new Response(JSON.stringify({
        total_usernames_found: usernames.length,
        already_linked: existingUsernames.size,
        newly_linked: Math.min(newUsernames.length, 100),
        remaining_unlinked: Math.max(0, newUsernames.length - 100),
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

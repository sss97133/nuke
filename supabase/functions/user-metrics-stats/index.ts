/**
 * USER METRICS STATS — Identity seed overview across all sources
 *
 * Returns aggregated user/identity data from:
 * - bat_user_profiles (507K+ comment profiles)
 * - bat_users (1.2K tracked users)
 * - ghost_users (156 device fingerprints)
 * - fb_marketplace_sellers (127 FB sellers)
 * - external_identities (509K+ cross-platform identities)
 * - profiles (registered Nuke users)
 *
 * GET /functions/v1/user-metrics-stats
 */


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const dbUrl =
      Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      throw new Error("No database URL configured");
    }

    const { Pool } = await import(
      "https://deno.land/x/postgres@v0.19.3/mod.ts"
    );
    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();

    try {
      const [
        bigCounts,
        smallCounts,
        batBuckets,
        batAgg,
        batLinkage,
        extIdentities,
        ghostBreakdown,
        ghostBuildable,
        fbBreakdown,
        fbAgg,
        topBatUsers,
      ] = await Promise.all([
        // Q1: pg_class estimates for big tables
        conn.queryObject<{ relname: string; reltuples: number }>`
          SELECT relname, reltuples::bigint as reltuples
          FROM pg_class
          WHERE relname IN ('bat_user_profiles', 'external_identities')
        `,

        // Q2: exact counts for small tables
        conn.queryObject<{
          bat_users: number;
          ghost_users: number;
          fb_sellers: number;
          profiles: number;
        }>`
          SELECT
            (SELECT count(*)::int FROM bat_users) as bat_users,
            (SELECT count(*)::int FROM ghost_users) as ghost_users,
            (SELECT count(*)::int FROM fb_marketplace_sellers) as fb_sellers,
            (SELECT count(*)::int FROM profiles) as profiles
        `,

        // Q3: BaT comment activity buckets
        conn.queryObject<{ bucket: string; cnt: number }>`
          SELECT
            CASE
              WHEN total_comments >= 10000 THEN '10000+'
              WHEN total_comments >= 1000 THEN '1000-9999'
              WHEN total_comments >= 100 THEN '100-999'
              WHEN total_comments >= 10 THEN '10-99'
              WHEN total_comments >= 1 THEN '1-9'
              ELSE '0'
            END as bucket,
            count(*)::int as cnt
          FROM bat_user_profiles
          GROUP BY 1
          ORDER BY min(total_comments) DESC
        `,

        // Q4: BaT aggregate stats
        conn.queryObject<{
          with_bids: number;
          with_wins: number;
          avg_comments: number;
          avg_bids: number;
          max_comments: number;
          max_bids: number;
        }>`
          SELECT
            count(*) FILTER (WHERE total_bids > 0)::int as with_bids,
            count(*) FILTER (WHERE total_wins > 0)::int as with_wins,
            round(avg(total_comments)::numeric, 1) as avg_comments,
            round(avg(NULLIF(total_bids, 0))::numeric, 1) as avg_bids,
            max(total_comments)::int as max_comments,
            max(total_bids)::int as max_bids
          FROM bat_user_profiles
        `,

        // Q5: BaT user linkage
        conn.queryObject<{ linked: number; unlinked: number }>`
          SELECT
            count(n_zero_user_id)::int as linked,
            (count(*)::int - count(n_zero_user_id)::int) as unlinked
          FROM bat_users
        `,

        // Q6: External identities by platform
        conn.queryObject<{
          platform: string;
          total: number;
          claimed: number;
        }>`
          SELECT
            platform,
            count(*)::int as total,
            count(claimed_by_user_id)::int as claimed
          FROM external_identities
          GROUP BY platform
          ORDER BY total DESC
        `,

        // Q7: Ghost user breakdown by camera make
        conn.queryObject<{
          camera_make: string;
          cnt: number;
          claimed: number;
        }>`
          SELECT
            COALESCE(camera_make, 'Unknown') as camera_make,
            count(*)::int as cnt,
            count(claimed_by_user_id)::int as claimed
          FROM ghost_users
          GROUP BY 1
          ORDER BY cnt DESC
        `,

        // Q8: Ghost buildable stats
        conn.queryObject<{
          buildable: number;
          avg_contributions: number;
          total_claimed: number;
        }>`
          SELECT
            count(*) FILTER (WHERE profile_buildable)::int as buildable,
            round(avg(total_contributions)::numeric, 1) as avg_contributions,
            count(claimed_by_user_id)::int as total_claimed
          FROM ghost_users
        `,

        // Q9: FB seller breakdown
        conn.queryObject<{ seller_type: string; cnt: number }>`
          SELECT
            COALESCE(seller_type, 'unknown') as seller_type,
            count(*)::int as cnt
          FROM fb_marketplace_sellers
          GROUP BY 1
          ORDER BY cnt DESC
        `,

        // Q10: FB aggregate stats
        conn.queryObject<{
          with_active: number;
          avg_price: number;
        }>`
          SELECT
            count(*) FILTER (WHERE active_listings > 0)::int as with_active,
            round(avg(avg_listing_price)::numeric, 0) as avg_price
          FROM fb_marketplace_sellers
        `,

        // Q11: Top 25 BaT users by comment activity
        conn.queryObject<{
          username: string;
          total_comments: number;
          total_bids: number;
          total_wins: number;
          expertise_score: number;
          community_trust_score: number;
          bidding_strategy: string;
          avg_bid_amount: number;
        }>`
          SELECT
            username,
            total_comments,
            COALESCE(total_bids, 0) as total_bids,
            COALESCE(total_wins, 0) as total_wins,
            COALESCE(expertise_score, 0)::numeric(5,2) as expertise_score,
            COALESCE(community_trust_score, 0)::numeric(5,2) as community_trust_score,
            bidding_strategy,
            COALESCE(avg_bid_amount, 0)::numeric(10,0) as avg_bid_amount
          FROM bat_user_profiles
          ORDER BY total_comments DESC
          LIMIT 25
        `,
      ]);

      // Build big table counts map
      const bigMap: Record<string, number> = {};
      for (const row of bigCounts.rows) {
        bigMap[row.relname] = Number(row.reltuples);
      }

      const small = smallCounts.rows[0];
      const ghost = ghostBuildable.rows[0];
      const fb = fbAgg.rows[0];
      const bat = batAgg.rows[0];
      const link = batLinkage.rows[0];

      const extTotal = extIdentities.rows.reduce(
        (s, r) => s + Number(r.total),
        0
      );
      const extClaimed = extIdentities.rows.reduce(
        (s, r) => s + Number(r.claimed),
        0
      );

      const totalSeeds =
        (bigMap.bat_user_profiles || 0) +
        Number(small.bat_users) +
        Number(small.ghost_users) +
        Number(small.fb_sellers) +
        extTotal;

      const stats = {
        totals: {
          bat_profiles: bigMap.bat_user_profiles || 0,
          bat_tracked_users: Number(small.bat_users),
          ghost_users: Number(small.ghost_users),
          fb_sellers: Number(small.fb_sellers),
          external_identities: extTotal,
          registered_users: Number(small.profiles),
          total_identity_seeds: totalSeeds,
        },

        linkage: {
          external_claimed: extClaimed,
          external_unclaimed: extTotal - extClaimed,
          bat_linked: Number(link.linked),
          bat_unlinked: Number(link.unlinked),
          ghost_claimed: Number(ghost.total_claimed),
          ghost_unclaimed: Number(small.ghost_users) - Number(ghost.total_claimed),
          claim_rate_pct:
            totalSeeds > 0
              ? Math.round((10000 * extClaimed) / totalSeeds) / 100
              : 0,
        },

        bat_activity: {
          comment_buckets: batBuckets.rows.map((r) => ({
            bucket: r.bucket,
            count: Number(r.cnt),
          })),
          with_bids: Number(bat.with_bids),
          with_wins: Number(bat.with_wins),
          avg_comments: Number(bat.avg_comments),
          avg_bids: Number(bat.avg_bids) || 0,
          max_comments: Number(bat.max_comments),
          max_bids: Number(bat.max_bids),
        },

        ghost_breakdown: {
          by_camera_make: ghostBreakdown.rows.map((r) => ({
            make: r.camera_make,
            count: Number(r.cnt),
            claimed: Number(r.claimed),
          })),
          profile_buildable: Number(ghost.buildable),
          avg_contributions: Number(ghost.avg_contributions) || 0,
        },

        fb_stats: {
          total: Number(small.fb_sellers),
          by_seller_type: fbBreakdown.rows.map((r) => ({
            type: r.seller_type,
            count: Number(r.cnt),
          })),
          with_active_listings: Number(fb.with_active),
          avg_listing_price: Number(fb.avg_price) || null,
        },

        identity_platforms: extIdentities.rows.map((r) => ({
          platform: r.platform,
          total: Number(r.total),
          claimed: Number(r.claimed),
        })),

        top_bat_users: topBatUsers.rows.map((r) => ({
          username: r.username,
          total_comments: Number(r.total_comments),
          total_bids: Number(r.total_bids),
          total_wins: Number(r.total_wins),
          expertise_score: Number(r.expertise_score),
          community_trust_score: Number(r.community_trust_score),
          bidding_strategy: r.bidding_strategy,
          avg_bid_amount: Number(r.avg_bid_amount),
        })),

        generated_at: new Date().toISOString(),
      };

      return new Response(JSON.stringify(stats, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      conn.release();
      await pool.end();
    }
  } catch (e) {
    console.error("user-metrics-stats error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

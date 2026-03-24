/**
 * DB STATS - Quick database state overview
 *
 * Returns summary stats to understand data distribution before querying.
 * Use this FIRST when exploring the database.
 *
 * OPTIMIZED v2: Materialized views for all GROUP BY aggregates (refreshed
 * every 10 min via pg_cron). Single connection. Target: <1s response.
 *
 * GET /functions/v1/db-stats
 */


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const dbUrl = Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: "No database URL configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const pool = new Pool(dbUrl, 2, true);

    // Single connection — all heavy GROUP BYs now read from materialized views (<50ms each)
    const conn1 = await pool.connect();

    try {
      // Single query: pg_class estimates + small counts + MVs (all fast now)
      const [lightweightResult, eventsResult, vehiclesResult, snapshotsResult] = await Promise.all([
        // pg_class estimates + small exact counts + queue stats + coverage
        conn1.queryObject<{
          big_counts: Record<string, number> | null;
          queue_stats: Record<string, number> | null;
          active_users: number;
          claimed_identities: number;
          coverage: any[] | null;
        }>`
          SELECT
            (SELECT json_object_agg(relname, reltuples::bigint)
             FROM pg_class
             WHERE relname IN (
               'vehicles', 'vehicle_images', 'vehicle_observations',
               'auction_comments', 'nuke_estimates', 'bat_user_profiles',
               'import_queue', 'source_targets', 'external_identities',
               'comment_discoveries', 'description_discoveries', 'vehicle_events'
             )
            ) as big_counts,
            (SELECT json_object_agg(status, cnt)
             FROM (SELECT status, count(*)::bigint as cnt FROM import_queue GROUP BY status) q
            ) as queue_stats,
            (SELECT count(*)::bigint FROM profiles WHERE email IS NOT NULL) as active_users,
            (SELECT count(*)::bigint FROM external_identities WHERE claimed_by_user_id IS NOT NULL) as claimed_identities,
            (SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json) FROM source_target_coverage s) as coverage
        `,

        // Read from materialized view (refreshed every 10 min, <5ms)
        conn1.queryObject<{
          events_by_platform: Array<{ source_platform: string; cnt: number; with_comments: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as events_by_platform
          FROM mv_events_by_platform r
        `,

        // Read from materialized view (was 631ms, now <5ms)
        conn1.queryObject<{
          vehicles_by_source: Array<{ source: string; total: number; with_desc: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as vehicles_by_source
          FROM mv_vehicles_by_source r
        `,

        // Read from materialized view (was 505ms, now <5ms)
        conn1.queryObject<{
          snapshots_by_platform: Array<{ platform: string; total: number; successful: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as snapshots_by_platform
          FROM mv_snapshots_by_platform r
        `,
      ]);

      // Extract results
      const lw = lightweightResult.rows[0];
      const ev = eventsResult.rows[0];
      const vh = vehiclesResult.rows[0];
      const sn = snapshotsResult.rows[0];

      const bigCounts: Record<string, number> = lw.big_counts || {};
      const queueStats: Record<string, number> = lw.queue_stats || {};
      const eventsByPlatform: Array<{ source_platform: string; cnt: number; with_comments: number }> = (ev.events_by_platform || []) as any;
      const vehiclesBySource: Array<{ source: string; total: number; with_desc: number }> = (vh.vehicles_by_source || []) as any;
      const snapshotsByPlatform: Array<{ platform: string; total: number; successful: number }> = (sn.snapshots_by_platform || []) as any;
      const coverageRows: any[] = (lw.coverage || []) as any;

      const vehicleCount = bigCounts.vehicles || 0;
      const estimateCount = bigCounts.nuke_estimates || 0;

      // Build vehicle_events by platform map
      const eventsByPlatformMap: Record<string, number> = {};
      let batEventsTotal = 0;
      let batEventsWithComments = 0;
      for (const row of eventsByPlatform) {
        eventsByPlatformMap[row.source_platform] = Number(row.cnt);
        if (row.source_platform === "bat") {
          batEventsTotal = Number(row.cnt);
          batEventsWithComments = Number(row.with_comments);
        }
      }

      // Build extraction reality
      const extractionReality = {
        vehicle_events_bat_total: batEventsTotal,
        vehicle_events_by_platform: eventsByPlatformMap,
        vehicles_by_source: vehiclesBySource.map(r => ({
          source: r.source,
          total: Number(r.total),
          with_description: Number(r.with_desc),
          description_pct: Number(r.total) > 0
            ? Math.round(1000 * Number(r.with_desc) / Number(r.total)) / 10
            : 0,
        })),
        snapshots_by_platform: snapshotsByPlatform.map(r => ({
          platform: r.platform,
          total: Number(r.total),
          successful: Number(r.successful),
          success_pct: Number(r.total) > 0
            ? Math.round(1000 * Number(r.successful) / Number(r.total)) / 10
            : 0,
        })),
      };

      // External identities: use pg_class estimate for total (510K+ rows, exact count takes 3.4s)
      const externalIdentitiesTotal = bigCounts.external_identities || 0;
      const claimedIdentities = Number(lw.claimed_identities) || 0;

      // Comment/description discoveries: use pg_class estimates (exact counts take 0.8-1.6s)
      const commentDiscoveries = bigCounts.comment_discoveries || 0;
      const descriptionDiscoveries = bigCounts.description_discoveries || 0;

      const stats = {
        vehicles: vehicleCount,
        images: bigCounts.vehicle_images || 0,
        comments: bigCounts.auction_comments || 0,
        observations: bigCounts.vehicle_observations || 0,
        nuke_estimates: estimateCount,
        bat_identities: bigCounts.bat_user_profiles || 0,
        active_users: Number(lw.active_users) || 0,
        generated_at: new Date().toISOString(),

        details: {
          total_vehicles: vehicleCount,
          total_images: bigCounts.vehicle_images || 0,
          total_organizations: 0, // businesses table dropped in triage

          observations: {
            comments: bigCounts.auction_comments || 0,
            bids: 0,
            total: bigCounts.vehicle_observations || 0,
            vehicles_with_comments: 0,
          },

          valuations: {
            nuke_estimates: estimateCount,
            coverage_pct: vehicleCount > 0
              ? Math.round(1000 * estimateCount / vehicleCount) / 10
              : 0,
          },

          identity_seeds: {
            bat_users: bigCounts.bat_user_profiles || 0,
            businesses: 0,
            total: bigCounts.bat_user_profiles || 0,
          },

          identity_claims: {
            total_external_identities: externalIdentitiesTotal,
            claimed_identities: claimedIdentities,
            unclaimed_identities: externalIdentitiesTotal - claimedIdentities,
            pending_claims: 0,
            approved_claims: 0,
            pending_verifications: 0,
          },

          bat_events: {
            total: batEventsTotal,
            with_comments: batEventsWithComments,
          },

          ai_analysis: {
            comment_discoveries: commentDiscoveries,
            description_discoveries: descriptionDiscoveries,
            vehicles_analyzed: commentDiscoveries + descriptionDiscoveries,
          },

          target_coverage: (() => {
            const batTotal = extractionReality.vehicle_events_bat_total;
            const eventTotals = Object.entries(extractionReality.vehicle_events_by_platform);

            const mergedCounts: Record<string, { extracted: number; note: string }> = {};

            for (const [platform, count] of eventTotals) {
              mergedCounts[platform] = {
                extracted: count,
                note: "from vehicle_events (actual count)",
              };
            }

            if (!mergedCounts["bat"]) {
              mergedCounts["bat"] = {
                extracted: batTotal,
                note: "from vehicle_events where source_platform='bat' (actual count)",
              };
            }

            const totalExtracted = Object.values(mergedCounts).reduce((s, v) => s + v.extracted, 0);

            for (const row of coverageRows) {
              const slug = row.source_slug;
              if (!mergedCounts[slug]) {
                mergedCounts[slug] = {
                  extracted: row.extracted || 0,
                  note: "from import_queue (queue-based count)",
                };
              }
            }

            const sources = Object.entries(mergedCounts)
              .map(([slug, v]) => ({ source_slug: slug, ...v }))
              .sort((a, b) => b.extracted - a.extracted);

            return {
              total_extracted: totalExtracted,
              sources,
              _stale_view_note: "source_target_coverage view undercounts — these numbers come from actual tables",
            };
          })(),

          platform_quality: (() => {
            const { vehicles_by_source, snapshots_by_platform } = extractionReality;

            return {
              vehicles_by_source: vehicles_by_source.map(v => ({
                source: v.source,
                total: v.total,
                with_description: v.with_description,
                description_pct: v.description_pct,
              })),
              listing_page_snapshots: snapshots_by_platform.map(s => ({
                platform: s.platform,
                total_snapshots: s.total,
                successful: s.successful,
                success_pct: s.success_pct,
              })),
              summary: {
                total_vehicles: vehicles_by_source.reduce((s, v) => s + v.total, 0),
                total_with_description: vehicles_by_source.reduce((s, v) => s + v.with_description, 0),
                overall_description_pct: (() => {
                  const total = vehicles_by_source.reduce((s, v) => s + v.total, 0);
                  const withDesc = vehicles_by_source.reduce((s, v) => s + v.with_description, 0);
                  return total > 0 ? Math.round(1000 * withDesc / total) / 10 : 0;
                })(),
                total_snapshots: snapshots_by_platform.reduce((s, p) => s + p.total, 0),
                total_successful_snapshots: snapshots_by_platform.reduce((s, p) => s + p.successful, 0),
              },
            };
          })(),

          _legacy: {
            auction_comments: bigCounts.auction_comments || 0,
            note: "Legacy table - use observations.comments instead",
          },

          queue: {
            total: bigCounts.import_queue || 0,
            ...queueStats,
          },
        },
      };

      return new Response(JSON.stringify(stats, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } finally {
      conn1.release();
      await pool.end();
    }

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

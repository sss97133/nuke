/**
 * DB STATS - Quick database state overview
 *
 * Returns summary stats to understand data distribution before querying.
 * Use this FIRST when exploring the database.
 *
 * OPTIMIZED: Single pool, 3 parallel connections, pg_class estimates for
 * large tables. Eliminates 12 PostgREST HTTP calls and 3 separate pool
 * connections from the original version.
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
    const pool = new Pool(dbUrl, 4, true);

    // Acquire 4 connections for maximum parallelism across heavy GROUP BYs
    const [conn1, conn2, conn3, conn4] = await Promise.all([
      pool.connect(),
      pool.connect(),
      pool.connect(),
      pool.connect(),
    ]);

    try {
      // Run all queries in parallel across 4 connections
      // Each heavy GROUP BY gets its own connection to avoid serial execution
      const [lightweightResult, eventsResult, vehiclesResult, snapshotsResult] = await Promise.all([
        // Connection 1: pg_class estimates + small exact counts + queue stats + coverage (~200ms)
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

        // Connection 2: vehicle_events GROUP BY (~130ms)
        conn2.queryObject<{
          events_by_platform: Array<{ source_platform: string; cnt: number; with_comments: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as events_by_platform FROM (
            SELECT source_platform,
              COUNT(*)::bigint as cnt,
              COUNT(*) FILTER (WHERE comment_count > 0)::bigint as with_comments
            FROM vehicle_events
            GROUP BY source_platform
            ORDER BY cnt DESC
          ) r
        `,

        // Connection 3: vehicles GROUP BY source (~631ms — the bottleneck)
        conn3.queryObject<{
          vehicles_by_source: Array<{ source: string; total: number; with_desc: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as vehicles_by_source FROM (
            SELECT
              COALESCE(source, 'unknown') as source,
              COUNT(*)::bigint as total,
              COUNT(description)::bigint as with_desc
            FROM vehicles
            GROUP BY source
            ORDER BY total DESC
          ) r
        `,

        // Connection 4: listing_page_snapshots GROUP BY (~505ms)
        conn4.queryObject<{
          snapshots_by_platform: Array<{ platform: string; total: number; successful: number }> | null;
        }>`
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) as snapshots_by_platform FROM (
            SELECT platform,
              COUNT(*)::bigint as total,
              COUNT(*) FILTER (WHERE success)::bigint as successful
            FROM listing_page_snapshots
            GROUP BY platform
            ORDER BY total DESC
          ) r
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
      conn2.release();
      conn3.release();
      conn4.release();
      await pool.end();
    }

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

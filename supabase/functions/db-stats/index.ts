/**
 * DB STATS - Quick database state overview
 *
 * Returns summary stats to understand data distribution before querying.
 * Use this FIRST when exploring the database.
 *
 * GET /functions/v1/db-stats
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Get estimated row counts from pg_class via direct SQL.
 * Uses the Pool connection from deno-postgres to bypass PostgREST.
 */
async function getBigCounts(): Promise<Record<string, number>> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return {};
  }

  try {
    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const pool = new Pool(dbUrl, 1, true); // 1 connection, lazy
    const conn = await pool.connect();
    try {
      const result = await conn.queryObject<{ relname: string; reltuples: number }>`
        SELECT relname, reltuples::bigint as reltuples
        FROM pg_class
        WHERE relname IN (
          'vehicles', 'vehicle_images', 'vehicle_observations',
          'auction_comments', 'nuke_estimates', 'bat_user_profiles',
          'import_queue', 'source_targets'
        )
      `;
      const counts: Record<string, number> = {};
      for (const row of result.rows) {
        counts[row.relname] = Number(row.reltuples);
      }
      return counts;
    } finally {
      conn.release();
      await pool.end();
    }
  } catch (e) {
    console.error("Direct SQL failed:", e);
    return {};
  }
}

async function getQueueStats(): Promise<Record<string, number>> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return {};

  try {
    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();
    try {
      const result = await conn.queryObject<{ status: string; cnt: number }>`
        SELECT status, count(*)::bigint as cnt
        FROM import_queue
        GROUP BY status
      `;
      const stats: Record<string, number> = {};
      for (const row of result.rows) {
        stats[row.status] = Number(row.cnt);
      }
      return stats;
    } finally {
      conn.release();
      await pool.end();
    }
  } catch (e) {
    console.error("Queue stats SQL failed:", e);
    return {};
  }
}

interface ExtractionReality {
  bat_listings_total: number;
  external_listings_by_platform: Record<string, number>;
  vehicles_by_source: Array<{ source: string; total: number; with_description: number; description_pct: number }>;
  snapshots_by_platform: Array<{ platform: string; total: number; successful: number; success_pct: number }>;
}

/**
 * Query actual extraction tables for real numbers instead of stale source_target_coverage view.
 * Queries: bat_listings, external_listings, vehicles (by source), listing_page_snapshots.
 */
async function getExtractionReality(): Promise<ExtractionReality | null> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return null;

  try {
    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();
    try {
      // Run all queries in parallel on the same connection
      const [batCount, extListings, vehicleSources, snapshotStats] = await Promise.all([
        conn.queryObject<{ cnt: number }>`SELECT COUNT(*)::bigint as cnt FROM bat_listings`,
        conn.queryObject<{ platform: string; cnt: number }>`
          SELECT platform, COUNT(*)::bigint as cnt
          FROM external_listings
          GROUP BY platform
          ORDER BY cnt DESC
        `,
        conn.queryObject<{ source: string; total: number; with_desc: number }>`
          SELECT
            COALESCE(source, 'unknown') as source,
            COUNT(*)::bigint as total,
            COUNT(description)::bigint as with_desc
          FROM vehicles
          GROUP BY source
          ORDER BY total DESC
        `,
        conn.queryObject<{ platform: string; total: number; successful: number }>`
          SELECT
            platform,
            COUNT(*)::bigint as total,
            COUNT(*) FILTER (WHERE success)::bigint as successful
          FROM listing_page_snapshots
          GROUP BY platform
          ORDER BY total DESC
        `,
      ]);

      const extByPlatform: Record<string, number> = {};
      for (const row of extListings.rows) {
        extByPlatform[row.platform] = Number(row.cnt);
      }

      return {
        bat_listings_total: Number(batCount.rows[0]?.cnt ?? 0),
        external_listings_by_platform: extByPlatform,
        vehicles_by_source: vehicleSources.rows.map(r => ({
          source: r.source,
          total: Number(r.total),
          with_description: Number(r.with_desc),
          description_pct: Number(r.total) > 0
            ? Math.round(1000 * Number(r.with_desc) / Number(r.total)) / 10
            : 0,
        })),
        snapshots_by_platform: snapshotStats.rows.map(r => ({
          platform: r.platform,
          total: Number(r.total),
          successful: Number(r.successful),
          success_pct: Number(r.total) > 0
            ? Math.round(1000 * Number(r.successful) / Number(r.total)) / 10
            : 0,
        })),
      };
    } finally {
      conn.release();
      await pool.end();
    }
  } catch (e) {
    console.error("Extraction reality SQL failed:", e);
    return null;
  }
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

    // Get big table counts via direct SQL (bypasses PostgREST)
    // and small table counts via PostgREST in parallel
    const [
      bigCounts,
      queueStats,
      extractionReality,
      batListingsRes,
      batWithCommentsRes,
      commentDiscRes,
      descDiscRes,
      orgsRes,
      activeUsersRes,
      externalIdentitiesRes,
      claimedIdentitiesRes,
      pendingClaimsRes,
      approvedClaimsRes,
      pendingVerificationsRes,
      coverageRes,
    ] = await Promise.all([
      getBigCounts(),
      getQueueStats(),
      getExtractionReality(),
      supabase.from("bat_listings").select("id", { count: "exact", head: true }),
      supabase.from("bat_listings").select("id", { count: "exact", head: true }).gt("comment_count", 0),
      supabase.from("comment_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("description_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("businesses").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).not("email", "is", null),
      supabase.from("external_identities").select("id", { count: "exact", head: true }),
      supabase.from("external_identities").select("id", { count: "exact", head: true }).not("claimed_by_user_id", "is", null),
      supabase.from("external_identity_claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("external_identity_claims").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("identity_verification_methods").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("source_target_coverage").select("*"),
    ]);

    const vehicleCount = bigCounts.vehicles || 0;
    const estimateCount = bigCounts.nuke_estimates || 0;

    const stats = {
      vehicles: vehicleCount,
      images: bigCounts.vehicle_images || 0,
      comments: bigCounts.auction_comments || 0,
      observations: bigCounts.vehicle_observations || 0,
      nuke_estimates: estimateCount,
      bat_identities: bigCounts.bat_user_profiles || 0,
      active_users: activeUsersRes.count || 0,
      generated_at: new Date().toISOString(),

      details: {
        total_vehicles: vehicleCount,
        total_images: bigCounts.vehicle_images || 0,
        total_organizations: orgsRes.count || 0,

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
          businesses: orgsRes.count || 0,
          total: (bigCounts.bat_user_profiles || 0) + (orgsRes.count || 0),
        },

        identity_claims: {
          total_external_identities: externalIdentitiesRes.count || 0,
          claimed_identities: claimedIdentitiesRes.count || 0,
          unclaimed_identities: (externalIdentitiesRes.count || 0) - (claimedIdentitiesRes.count || 0),
          pending_claims: pendingClaimsRes.count || 0,
          approved_claims: approvedClaimsRes.count || 0,
          pending_verifications: pendingVerificationsRes.count || 0,
        },

        bat_listings: {
          total: batListingsRes.count || 0,
          with_comments: batWithCommentsRes.count || 0,
        },

        ai_analysis: {
          comment_discoveries: commentDiscRes.count || 0,
          description_discoveries: descDiscRes.count || 0,
          vehicles_analyzed: (commentDiscRes.count || 0) + (descDiscRes.count || 0),
        },

        target_coverage: (() => {
          // Build accurate extraction counts from actual tables
          const reality = extractionReality;
          if (reality) {
            const batTotal = reality.bat_listings_total;
            const extTotals = Object.entries(reality.external_listings_by_platform);

            // Merge bat_listings + external_listings counts per platform
            // bat_listings is the canonical BaT count; external_listings.bat tracks linked listings
            const mergedCounts: Record<string, { extracted: number; note: string }> = {};

            // bat_listings is the primary BaT extraction table
            mergedCounts["bat"] = {
              extracted: batTotal,
              note: "from bat_listings (actual count)",
            };

            // Add external_listings platforms, merging bat into the existing entry
            for (const [platform, count] of extTotals) {
              if (platform === "bat") {
                // bat external_listings are linked listing records, not separate extractions
                mergedCounts["bat"].note = `from bat_listings (${batTotal}) + external_listings (${count})`;
                // Don't double-count; bat_listings is the canonical number
              } else {
                mergedCounts[platform] = {
                  extracted: count,
                  note: "from external_listings (actual count)",
                };
              }
            }

            const totalExtracted = Object.values(mergedCounts).reduce((s, v) => s + v.extracted, 0);

            // Append queue-based sources that aren't already covered
            const queueRows = coverageRes.data || [];
            for (const row of queueRows) {
              const slug = (row as any).source_slug;
              if (!mergedCounts[slug]) {
                mergedCounts[slug] = {
                  extracted: (row as any).extracted || 0,
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
          }

          // Fallback to stale view if direct SQL failed
          const rows = coverageRes.data || [];
          const totals = rows.reduce((acc: any, r: any) => ({
            total_targets: acc.total_targets + (r.total_targets || 0),
            in_queue: acc.in_queue + (r.in_queue || 0),
            extracted: acc.extracted + (r.extracted || 0),
            gap: acc.gap + (r.gap || 0),
          }), { total_targets: 0, in_queue: 0, extracted: 0, gap: 0 });
          return {
            ...totals,
            coverage_pct: totals.total_targets > 0
              ? Math.round(1000 * totals.in_queue / totals.total_targets) / 10
              : 0,
            sources: rows,
            _stale_view_note: "FALLBACK: using source_target_coverage view (may undercount)",
          };
        })(),

        platform_quality: (() => {
          if (!extractionReality) return null;
          const { vehicles_by_source, snapshots_by_platform } = extractionReality;

          // Build snapshot lookup
          const snapshotMap: Record<string, { total: number; successful: number; success_pct: number }> = {};
          for (const s of snapshots_by_platform) {
            snapshotMap[s.platform] = { total: s.total, successful: s.successful, success_pct: s.success_pct };
          }

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

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

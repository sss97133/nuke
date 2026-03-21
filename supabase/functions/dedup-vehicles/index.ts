// dedup-vehicles: Find and merge duplicate vehicles by listing_url.
// Uses a direct Postgres connection to bypass PostgREST statement timeouts.
// Each invocation processes up to `batch_size` listing_url groups (default 100),
// capped at `max_merges` total merge operations (default 500).
// Safe: re-points child records to primary vehicle, soft-deletes duplicates.
//
// Modes:
//   "exact"      — (default) Group by exact listing_url match
//   "normalized" — Group by normalized URL / canonical listing ID
//                  Catches URL-variant duplicates (e.g., JamesEdition title-appended URLs)
//
// POST /functions/v1/dedup-vehicles
// { "mode": "normalized", "batch_size": 100, "max_merges": 500, "dry_run": true }

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { normalizeListingUrl } from "../_shared/urlNormalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: {
    batch_size?: number;
    max_merges?: number;
    dry_run?: boolean;
    mode?: "exact" | "normalized";
  } = {};
  try {
    body = await req.json();
  } catch (_) {
    // use defaults
  }

  const batchSize = Math.min(body.batch_size ?? 100, 1000);
  const maxMergesPerCall = Math.min(body.max_merges ?? 500, 5000);
  const dryRun = body.dry_run ?? false;
  const mode = body.mode ?? "exact";

  const dbUrl =
    Deno.env.get("SUPABASE_DB_URL") ||
    `postgresql://postgres.qkgaybvrernstplzjaam:${Deno.env.get(
      "SUPABASE_DB_PASSWORD"
    )}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;

  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 600,
    connect_timeout: 30,
  });

  const stats = {
    dry_run: dryRun,
    mode,
    listing_url_groups_found: 0,
    normalized_url_groups_found: 0,
    total_duplicates_merged: 0,
    total_images_moved: 0,
    total_comments_moved: 0,
    total_observations_moved: 0,
    total_events_moved: 0,
    stopped_at_merge_limit: false,
    errors: [] as string[],
    sample_groups: [] as Array<{ listing_url: string; canonical_id?: string; count: number; primary_id: string }>,
  };

  try {
    // Disable statement timeout for this session — we need long-running queries
    await sql`SET statement_timeout = 0`;

    if (mode === "normalized") {
      // ── NORMALIZED MODE ──────────────────────────────────────────────
      // Fetch all non-merged vehicles with listing URLs, then group by
      // canonical listing ID in application code.
      // This catches URL-variant duplicates that exact matching misses.

      const rows = await sql`
        SELECT id, listing_url, created_at
        FROM vehicles
        WHERE listing_url IS NOT NULL
          AND listing_url != ''
          AND (status IS DISTINCT FROM 'merged')
          AND (status IS DISTINCT FROM 'deleted')
          AND merged_into_vehicle_id IS NULL
        ORDER BY created_at ASC
      `;

      // Group by canonical listing ID
      const groups = new Map<string, Array<{ id: string; listing_url: string; created_at: string }>>();
      for (const row of rows) {
        const norm = normalizeListingUrl(row.listing_url);
        if (!norm?.canonicalListingId) continue;
        const key = norm.canonicalListingId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ id: row.id, listing_url: row.listing_url, created_at: row.created_at });
      }

      // Filter to groups with duplicates
      const dupGroups = [...groups.entries()]
        .filter(([_, vehicles]) => vehicles.length > 1)
        .slice(0, batchSize);

      stats.normalized_url_groups_found = dupGroups.length;

      if (dryRun) {
        for (const [canonicalId, vehicles] of dupGroups.slice(0, 10)) {
          stats.sample_groups.push({
            listing_url: vehicles[0].listing_url,
            canonical_id: canonicalId,
            count: vehicles.length,
            primary_id: vehicles[0].id,
          });
        }
        stats.total_duplicates_merged = dupGroups.reduce(
          (sum, [_, vehicles]) => sum + (vehicles.length - 1),
          0,
        );
      } else {
        // Merge duplicates: oldest vehicle (by created_at) is primary
        outer_norm: for (const [canonicalId, vehicles] of dupGroups) {
          // Vehicles are already sorted by created_at ASC from the query
          const primaryId = vehicles[0].id;
          const dupIds = vehicles.slice(1).map((v) => v.id);

          for (const dupId of dupIds) {
            if (stats.total_duplicates_merged >= maxMergesPerCall) {
              stats.stopped_at_merge_limit = true;
              break outer_norm;
            }

            try {
              const result = await sql`
                SELECT merge_into_primary(${primaryId}::uuid, ${dupId}::uuid) AS result
              `;
              const r = result[0]?.result ?? {};
              if (!r.skipped) {
                stats.total_duplicates_merged++;
                stats.total_images_moved += Number(r.images_moved ?? 0);
                stats.total_comments_moved += Number(r.comments_moved ?? 0);
                stats.total_observations_moved += Number(r.observations_moved ?? 0);
                stats.total_events_moved += Number(r.events_moved ?? 0);
              }
            } catch (e) {
              stats.errors.push(`merge ${primaryId} ← ${dupId} (${canonicalId}): ${String(e).slice(0, 200)}`);
            }
          }

          if (stats.sample_groups.length < 5) {
            stats.sample_groups.push({
              listing_url: vehicles[0].listing_url,
              canonical_id: canonicalId,
              count: vehicles.length,
              primary_id: primaryId,
            });
          }
        }
      }
    } else {
      // ── EXACT MODE (original behavior) ───────────────────────────────
      // Find groups with duplicate listing_urls.
      // No ORDER BY — allows hash aggregation with early exit at LIMIT,
      // much faster than sorted aggregation on 1.25M rows without an index.
      const dupGroups = await sql`
        SELECT
          listing_url,
          COUNT(*) AS total_count,
          array_agg(id ORDER BY created_at ASC, id ASC) AS ordered_ids
        FROM vehicles
        WHERE listing_url IS NOT NULL
          AND listing_url != ''
          AND (status IS DISTINCT FROM 'merged')
          AND merged_into_vehicle_id IS NULL
        GROUP BY listing_url
        HAVING COUNT(*) > 1
        LIMIT ${batchSize}
      `;

      stats.listing_url_groups_found = dupGroups.length;

      if (dryRun) {
        for (const group of dupGroups.slice(0, 10)) {
          stats.sample_groups.push({
            listing_url: group.listing_url,
            count: Number(group.total_count),
            primary_id: group.ordered_ids[0],
          });
        }
        stats.total_duplicates_merged = dupGroups.reduce(
          (sum: number, g: { total_count: number }) => sum + (Number(g.total_count) - 1),
          0,
        );
      } else {
        // Process each group: merge all duplicates into the oldest vehicle
        outer: for (const group of dupGroups) {
          const primaryId = group.ordered_ids[0];
          const dupIds: string[] = group.ordered_ids.slice(1);

          for (const dupId of dupIds) {
            if (stats.total_duplicates_merged >= maxMergesPerCall) {
              stats.stopped_at_merge_limit = true;
              break outer;
            }

            try {
              const result = await sql`
                SELECT merge_into_primary(${primaryId}::uuid, ${dupId}::uuid) AS result
              `;
              const r = result[0]?.result ?? {};
              if (!r.skipped) {
                stats.total_duplicates_merged++;
                stats.total_images_moved += Number(r.images_moved ?? 0);
                stats.total_comments_moved += Number(r.comments_moved ?? 0);
                stats.total_observations_moved += Number(r.observations_moved ?? 0);
                stats.total_events_moved += Number(r.events_moved ?? 0);
              }
            } catch (e) {
              stats.errors.push(`merge ${primaryId} ← ${dupId}: ${String(e).slice(0, 200)}`);
            }
          }

          if (stats.sample_groups.length < 5) {
            stats.sample_groups.push({
              listing_url: group.listing_url,
              count: Number(group.total_count),
              primary_id: primaryId,
            });
          }
        }
      }
    }
  } catch (e) {
    stats.errors.push(`top-level: ${String(e).slice(0, 300)}`);
  } finally {
    await sql.end();
  }

  return new Response(JSON.stringify(stats, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// Edge function: dedup-vehicle-images
// Deletes duplicate vehicle_images rows keeping the earliest per (vehicle_id, image_url)
// Uses direct Postgres connection to bypass PostgREST 8s statement_timeout

import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Edge functions have DATABASE_URL injected automatically by Supabase
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ||
                `postgresql://postgres.qkgaybvrernstplzjaam:${Deno.env.get("SUPABASE_DB_PASSWORD")}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;

  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 300,
    connect_timeout: 30,
  });

  const results: Record<string, unknown> = {};

  try {
    // Step 1: Scoped count for bat_import
    // Use pg_stats estimate for the total, then count duplicates via efficient query
    const scope = await sql`
      SELECT
        (SELECT COUNT(*) FROM vehicle_images WHERE source = 'bat_import' AND image_url IS NOT NULL) as total_bat_import_rows,
        (SELECT COUNT(DISTINCT vehicle_id || '|' || image_url) FROM vehicle_images WHERE source = 'bat_import' AND image_url IS NOT NULL) as distinct_pairs
    `;
    const row = scope[0];
    results.step1_total_bat_import_rows = Number(row.total_bat_import_rows);
    results.step1_distinct_pairs = Number(row.distinct_pairs);
    results.step1_duplicate_rows = Number(row.total_bat_import_rows) - Number(row.distinct_pairs);
  } catch (e) {
    results.step1_error = String(e);
  }

  // Step 2: Delete duplicates across entire table
  try {
    const del = await sql`
      DELETE FROM vehicle_images
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                     PARTITION BY vehicle_id, image_url
                     ORDER BY created_at ASC, id ASC
                 ) as rn
          FROM vehicle_images
          WHERE image_url IS NOT NULL
        ) ranked
        WHERE rn > 1
      )
    `;
    results.step2_deleted_count = del.count;
    results.step2_status = "completed";
  } catch (e) {
    results.step2_error = String(e);
  }

  // Step 3: Verify Vanagon
  try {
    const vanagon = await sql`
      SELECT COUNT(*) as remaining_rows, COUNT(DISTINCT image_url) as distinct_urls
      FROM vehicle_images
      WHERE vehicle_id = '6169c011-be07-4baa-af12-4a151b5beb95'
    `;
    results.step3_vanagon_remaining_rows = Number(vanagon[0].remaining_rows);
    results.step3_vanagon_distinct_urls = Number(vanagon[0].distinct_urls);
  } catch (e) {
    results.step3_error = String(e);
  }

  await sql.end();

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});

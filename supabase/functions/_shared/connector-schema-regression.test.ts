/**
 * Connector ↔ schema regression test.
 *
 * The recurring bug class: a tool query SELECTs a column that does not exist
 * (vehicle_images.url → "column does not exist"; organizations.type vs business_type).
 * This test pins every column the mcp-connector reads/writes against the LIVE
 * information_schema, so a drift fails CI instead of a production tool call.
 *
 * Run: dotenvx run -f .env -f .env.local -- deno test --allow-env --allow-net \
 *        supabase/functions/_shared/connector-schema-regression.test.ts
 *
 * Skips (does not fail) when SUPABASE_URL / SERVICE_ROLE_KEY are absent, so a
 * secret-less CI lane is green; the dotenvx lane is the enforcing one.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Exact columns the connector depends on, per table. Keep in sync with the SELECTs in index.ts.
// When you add a column to a connector query, add it here too.
const REQUIRED: Record<string, string[]> = {
  vehicle_images: [
    "id", "image_url", "thumbnail_url", "medium_url", "large_url", "storage_path",
    "angle", "condition_score", "photo_quality_score", "ai_processing_status",
    "damage_flags", "modification_flags", "fabrication_stage", "vision_analyzed_at",
    "created_at", "exif_data", "taken_at", "latitude", "longitude", "camera_pose", "caption",
  ],
  vehicles: [
    "id", "year", "make", "model", "vin", "body_style", "color", "color_primary",
    "displacement", "engine_displacement", "horsepower", "torque", "seats",
    "canonical_outcome", "is_for_sale", "status",
  ],
  projection_event: [
    "id", "request_envelope", "result_envelope", "result_kind", "model_id",
    "model_caller", "prompt_sha256", "observation_ids", "observed_at", "recorded_at",
  ],
  model_registry: ["id", "slug", "provider", "version", "caller_kind", "base_trust", "last_seen"],
  prompt_template_registry: ["prompt_sha256", "template_name", "template_body", "schema_hint", "last_used_at"],
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.test({
  name: "connector queries reference only columns that exist in the live schema",
  ignore: !SUPABASE_URL || !SERVICE_ROLE_KEY,
  async fn() {
    const sb = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Exercise the SAME resolution path the connector uses: PostgREST column selection.
    // A non-existent column (e.g. the old vehicle_images.url) makes PostgREST return error
    // code 42703 — exactly the production failure this test guards against. limit(0) means
    // no rows transferred; we only care whether the column list resolves.
    const failures: string[] = [];
    for (const [table, cols] of Object.entries(REQUIRED)) {
      const { error } = await sb.from(table).select(cols.join(",")).limit(0);
      if (error) failures.push(`${table}: ${error.message} (code ${error.code ?? "?"})`);
    }

    assert(
      failures.length === 0,
      `Connector column lists do not resolve against the live schema:\n  ${failures.join("\n  ")}`,
    );
  },
});

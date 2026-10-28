#!/usr/bin/env node
/**
 * vision-enrich-urlless-vehicles.mjs
 *
 * Enriches vehicles that have images but no description/URL.
 * Uses cloud vision APIs (Gemini free → Haiku fallback) to:
 *   1. Verify/correct make identification from hero image
 *   2. Generate a description from vehicle data + image analysis
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-enrich-urlless-vehicles.mjs [--max 100] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const MAX = parseInt(args.find((a) => a.startsWith("--max="))?.split("=")[1] || "500");
const DRY_RUN = args.includes("--dry-run");
const BATCH_SIZE = 5;

async function callEdgeFn(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${name} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  console.log(`Vision enrichment: max=${MAX} dry_run=${DRY_RUN} batch=${BATCH_SIZE}`);

  // Get vehicles with images but no description
  // Query by sale_price desc to prioritize high-value vehicles
  const { data: vehicles, error } = await sb
    .from("vehicles")
    .select("id, year, make, model, trim, sale_price, asking_price, auction_source, image_count, city, state, location")
    .eq("status", "active")
    .is("description", null)
    .gt("image_count", 5)
    .order("sale_price", { ascending: false, nullsFirst: false })
    .limit(MAX);

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${vehicles.length} vehicles to enrich`);

  let identified = 0, described = 0, errors = 0;

  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (v) => {
      try {
        // Get hero image
        const { data: imgs } = await sb
          .from("vehicle_images")
          .select("id, image_url, source_url, photo_quality_score")
          .eq("vehicle_id", v.id)
          .not("image_url", "is", null)
          .order("photo_quality_score", { ascending: false, nullsFirst: false })
          .limit(1);

        const heroUrl = imgs?.[0]?.image_url || imgs?.[0]?.source_url;
        if (!heroUrl) {
          console.log(`  [${v.id}] No image URL found, skipping`);
          return;
        }

        // Step 1: Identify vehicle from image (free Gemini tier)
        let identification = null;
        try {
          identification = await callEdgeFn("identify-vehicle-from-image", {
            image_url: heroUrl,
            context: {
              title: `${v.year} ${v.make} ${v.model || ""}`.trim(),
            },
            vehicle_id: DRY_RUN ? undefined : v.id,
            min_confidence: 0.4,
          });
          identified++;
          console.log(`  [${v.year} ${v.make} ${v.model}] ID: ${identification?.make || "?"} ${identification?.model || "?"} conf=${identification?.confidence || "?"}`);
        } catch (e) {
          console.warn(`  [${v.id}] identify failed: ${e.message.slice(0, 80)}`);
        }

        // Step 2: Generate description
        if (!DRY_RUN) {
          try {
            await callEdgeFn("generate-vehicle-description", {
              vehicle_id: v.id,
            });
            described++;
          } catch (e) {
            // Generate description may not exist or may fail — that's ok
            // Fall back to the database's own composer (compose_vehicle_description): identity, the sold price and date when
            // reconciled, location, photo count. It never prints "listed at" for a sold car or an internal source token like
            // "user-submission" (the old template did, so a reconciled sale still read as a $45,000 listing).
            const { data: desc, error: composeErr } = await sb.rpc("compose_vehicle_description", { p_vehicle_id: v.id });
            if (composeErr || !desc) throw composeErr || new Error("compose_vehicle_description returned nothing");
            await sb.from("vehicles").update({ description: desc, description_source: "composed_from_record", description_generated_at: new Date().toISOString() }).eq("id", v.id);
            described++;
          }
        }
      } catch (e) {
        errors++;
        console.error(`  [${v.id}] Error: ${e.message.slice(0, 100)}`);
      }
    }));

    const pct = Math.round(((i + batch.length) / vehicles.length) * 100);
    console.log(`Progress: ${i + batch.length}/${vehicles.length} (${pct}%) | ID=${identified} Desc=${described} Err=${errors}`);

    // Brief pause between batches
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDONE: ${identified} identified, ${described} described, ${errors} errors out of ${vehicles.length} vehicles`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface GeoJSONFeature {
  type: "Feature";
  properties: {
    name: string;
    url: string;
    instagram: string | null;
    country: string;
    city: string;
    source?: string;
  };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface GeoJSONData {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

/**
 * Seed ECR Collections into businesses table
 *
 * Reads collections-map-enhanced.geojson and upserts each collection
 * into `businesses` with business_type='collection'.
 *
 * Usage:
 *   POST { "geojson_url": "https://..." }       — fetch GeoJSON from URL
 *   POST { "features": [...] }                   — pass features directly
 *   POST {}                                      — uses default public URL
 *   POST { "dry_run": true }                     — preview without writing
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    let features: GeoJSONFeature[];

    if (body.features && Array.isArray(body.features)) {
      features = body.features;
    } else {
      // Fetch GeoJSON from URL (default: the frontend public data)
      const url =
        body.geojson_url ||
        `${supabaseUrl.replace("/functions/v1", "").replace("supabase.co", "supabase.co")}/storage/v1/object/public/vehicle-data/collections-map-enhanced.geojson`;

      // Try the provided URL first, fall back to fetching from the frontend
      let geojsonData: GeoJSONData | null = null;

      // If features were passed in the body directly
      if (body.geojson) {
        geojsonData = body.geojson as GeoJSONData;
      } else {
        // Try fetching
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            geojsonData = await resp.json();
          }
        } catch {
          // Will fall through to error
        }

        // If the storage URL didn't work, try common patterns
        if (!geojsonData && !body.geojson_url) {
          const fallbackUrls = [
            "https://nuke.skylar.agency/data/collections-map-enhanced.geojson",
            "https://nuke-frontend.vercel.app/data/collections-map-enhanced.geojson",
          ];
          for (const fallback of fallbackUrls) {
            try {
              const resp = await fetch(fallback);
              if (resp.ok) {
                geojsonData = await resp.json();
                break;
              }
            } catch {
              continue;
            }
          }
        }
      }

      if (!geojsonData?.features) {
        return new Response(
          JSON.stringify({
            error: "Could not load GeoJSON. Pass features directly or provide geojson_url.",
            hint: "POST with { features: [...] } or { geojson_url: 'https://...' }",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      features = geojsonData.features;
    }

    console.log(`\n🏛️ SEED ECR COLLECTIONS`);
    console.log(`Features to process: ${features.length}`);
    console.log(`Dry run: ${dryRun}\n`);

    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] as string[] };

    // Process in batches to avoid overwhelming the DB
    const BATCH_SIZE = 50;
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);

      const rows = batch.map((f) => {
        const slug = f.properties.name; // e.g., "thermal-ferrari-collection"
        const businessName = slug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

        const socialLinks: Record<string, string> = {};
        if (f.properties.instagram) {
          socialLinks.instagram = f.properties.instagram.replace(/^@/, "");
        }

        return {
          slug,
          business_name: businessName,
          business_type: "collection" as const,
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          city: f.properties.city || null,
          country: f.properties.country || null,
          website: f.properties.url || null,
          social_links: socialLinks,
          is_public: true,
          is_verified: true,
          status: "active" as const,
          metadata: {
            ecr_slug: slug,
            ecr_url: f.properties.url,
            ecr_source: f.properties.source || "pattern",
            seeded_at: new Date().toISOString(),
          },
        };
      });

      if (dryRun) {
        results.inserted += rows.length;
        continue;
      }

      const { data, error } = await supabase
        .from("businesses")
        .upsert(rows, {
          onConflict: "slug",
          ignoreDuplicates: false,
        })
        .select("id, slug");

      if (error) {
        console.error(`Batch ${i}-${i + batch.length} error:`, error.message);
        // Try individual inserts for the batch
        for (const row of rows) {
          const { error: singleError } = await supabase
            .from("businesses")
            .upsert(row, { onConflict: "slug", ignoreDuplicates: false });

          if (singleError) {
            results.errors.push(`${row.slug}: ${singleError.message}`);
            results.skipped++;
          } else {
            results.inserted++;
          }
        }
      } else {
        results.inserted += data?.length || rows.length;
      }
    }

    console.log(`\n✅ Seeding complete:`);
    console.log(`   Inserted/Updated: ${results.inserted}`);
    console.log(`   Skipped: ${results.skipped}`);
    console.log(`   Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        total_features: features.length,
        ...results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("seed-ecr-collections error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

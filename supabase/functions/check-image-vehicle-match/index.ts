import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface CheckRequest {
  vehicle_id?: string;
  image_ids?: string[];
  batch_size?: number;
  source_filter?: string;
  dry_run?: boolean;
}

interface MatchResult {
  image_id: string;
  image_url: string;
  status: "confirmed" | "mismatch" | "ambiguous" | "unrelated";
  ai_detected_vehicle: string | null;
  confidence: number;
  reason: string;
}

// URL patterns that are obviously not vehicle photos
const NOISE_PATTERNS = [
  /\/icons?\//i, /\/ui\//i, /logo|header|footer|nav/i,
  /social|share|facebook|twitter/i, /avatar|profile/i,
  /placeholder|blank|empty|default\./i, /\.svg$/i,
  /badge|button|arrow|chevron/i, /-\d{1,2}x\d{1,2}\./i,
];

function isNoiseUrl(url: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(url));
}

async function classifyImage(
  imageUrl: string,
  expectedVehicle: string,
  anthropicKey: string
): Promise<{
  is_vehicle: boolean;
  matches_expected: boolean;
  detected_vehicle: string | null;
  image_type: string;
  confidence: number;
  reason: string;
}> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl },
            },
            {
              type: "text",
              text: `Expected vehicle: ${expectedVehicle}

Classify this image. Return ONLY valid JSON:
{
  "is_vehicle": boolean,
  "matches_expected": boolean,
  "detected_vehicle": "YEAR MAKE MODEL" or null,
  "image_type": "exterior"|"interior"|"engine"|"undercarriage"|"documentation"|"ui_element"|"unrelated",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Rules:
- is_vehicle: true if image shows any car/truck/motorcycle
- matches_expected: true ONLY if it matches the expected vehicle above (same make, model, similar year)
- detected_vehicle: what vehicle is actually shown (null if not a vehicle)
- Be strict: a Ford is not a BMW, a sedan is not an SUV`,
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || "";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  }

  return JSON.parse(jsonMatch[0]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabase = createClient(supabaseUrl, serviceKey);
    const body: CheckRequest = await req.json();
    const batchSize = Math.min(body.batch_size || 10, 20);
    const dryRun = body.dry_run ?? false;

    // --- Determine which images to check ---
    let images: { id: string; image_url: string; vehicle_id: string }[] = [];

    if (body.image_ids?.length) {
      const { data, error } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id")
        .in("id", body.image_ids)
        .not("vehicle_id", "is", null)
        .limit(batchSize);
      if (error) throw new Error(`Image query failed: ${error.message} (${error.code})`);
      images = data || [];
    } else if (body.vehicle_id) {
      const { data, error } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id")
        .eq("vehicle_id", body.vehicle_id)
        .is("image_vehicle_match_status", null)
        .limit(batchSize);
      if (error) throw new Error(`Image query failed: ${error.message} (${error.code})`);
      images = data || [];
    } else {
      // Auto-pick from high-risk dealer sources
      const sources = body.source_filter
        ? [body.source_filter]
        : [
            "jamesedition", "facebook_marketplace", "mecum", "gooding",
            "bonhams", "broad_arrow", "pcarmarket", "autotrader",
            "cargurus", "hemmings",
          ];

      const { data, error } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id")
        .is("image_vehicle_match_status", null)
        .not("vehicle_id", "is", null)
        .in("source", sources)
        .limit(batchSize);
      if (error) throw new Error(`Image query failed: ${error.message} (${error.code})`);
      images = data || [];
    }

    if (images.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No unchecked images found", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Get parent vehicles ---
    const vehicleIds = [...new Set(images.map((i) => i.vehicle_id))];
    const { data: vehicles, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, year, make, model")
      .in("id", vehicleIds);

    // If vehicle lookup fails entirely, abort — don't mark everything as orphaned
    if (vehicleError) {
      throw new Error(`Vehicle lookup failed: ${vehicleError.message} (code: ${vehicleError.code})`);
    }
    if (!vehicles || vehicles.length === 0) {
      // If we got images with vehicle_ids but zero vehicles found, the DB is likely unhealthy
      throw new Error(
        `Vehicle lookup returned 0 results for ${vehicleIds.length} vehicle_ids. ` +
        `PostgREST may be unhealthy. Aborting to prevent false orphan marking.`
      );
    }

    const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v]));

    // Only mark as orphan if we successfully loaded MOST vehicles (a few missing = real orphans)
    const lookupRate = vehicles.length / vehicleIds.length;

    // --- Process each image ---
    const results: MatchResult[] = [];
    const errors: { image_id: string; error: string }[] = [];

    for (const img of images) {
      const vehicle = vehicleMap.get(img.vehicle_id);
      if (!vehicle) {
        // Only mark orphan if we successfully loaded most vehicles in this batch
        // If lookup rate is low, something is wrong — skip instead of marking
        if (lookupRate < 0.5) {
          errors.push({
            image_id: img.id,
            error: `Skipped: vehicle ${img.vehicle_id} not found but lookup rate too low (${(lookupRate * 100).toFixed(0)}%)`,
          });
          continue;
        }
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "unrelated" })
            .eq("id", img.id);
        }
        results.push({
          image_id: img.id, image_url: img.image_url, status: "unrelated",
          ai_detected_vehicle: null, confidence: 1.0, reason: "Orphaned image — parent vehicle not found",
        });
        continue;
      }

      const url = (img.image_url || "").trim();

      // Fast rejection: URLs that Claude vision can't fetch (expired CDN tokens, etc.)
      if (url.includes("fbcdn.net") || url.includes("facebook.com/photo")) {
        const r: MatchResult = {
          image_id: img.id, image_url: url, status: "ambiguous",
          ai_detected_vehicle: null, confidence: 0,
          reason: "Facebook CDN URL — signed tokens likely expired, cannot verify via API",
        };
        results.push(r);
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "ambiguous" })
            .eq("id", img.id);
        }
        continue;
      }

      // Fast rejection: placeholder/noise URLs
      if (!url || url.includes("placeholder.nuke.app") || isNoiseUrl(url)) {
        const r: MatchResult = {
          image_id: img.id, image_url: url, status: "unrelated",
          ai_detected_vehicle: null, confidence: 1.0,
          reason: "Noise/placeholder URL",
        };
        results.push(r);
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "unrelated" })
            .eq("id", img.id);
        }
        continue;
      }

      // Call Claude vision
      const expectedVehicle = [vehicle.year, vehicle.make, vehicle.model]
        .filter(Boolean).join(" ");

      try {
        const ai = await classifyImage(url, expectedVehicle, anthropicKey);

        let status: MatchResult["status"];
        if (!ai.is_vehicle) {
          status = "unrelated";
        } else if (ai.matches_expected) {
          status = "confirmed";
        } else if (
          ai.image_type === "interior" ||
          ai.image_type === "engine" ||
          ai.image_type === "undercarriage" ||
          ai.image_type === "documentation"
        ) {
          // Hard to identify vehicle from interior/engine — ambiguous unless very confident
          status = ai.confidence > 0.85 ? "mismatch" : "ambiguous";
        } else {
          status = "mismatch";
        }

        const r: MatchResult = {
          image_id: img.id,
          image_url: url,
          status,
          ai_detected_vehicle: ai.detected_vehicle || null,
          confidence: ai.confidence,
          reason: ai.reason,
        };
        results.push(r);

        if (!dryRun) {
          const update: Record<string, any> = {
            image_vehicle_match_status: status,
          };
          if (ai.detected_vehicle) {
            update.ai_detected_vehicle = ai.detected_vehicle;
          }
          await supabase.from("vehicle_images")
            .update(update).eq("id", img.id);
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        errors.push({ image_id: img.id, error: `Vision error: ${errMsg}` });
        // Mark failed images as ambiguous so they don't loop forever
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "ambiguous" })
            .eq("id", img.id);
        }
      }
    }

    // --- Summary ---
    const summary = {
      total: images.length,
      processed: results.length,
      confirmed: results.filter((r) => r.status === "confirmed").length,
      mismatch: results.filter((r) => r.status === "mismatch").length,
      ambiguous: results.filter((r) => r.status === "ambiguous").length,
      unrelated: results.filter((r) => r.status === "unrelated").length,
      errors: errors.length,
    };

    return new Response(
      JSON.stringify({
        success: true, dry_run: dryRun, summary, results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

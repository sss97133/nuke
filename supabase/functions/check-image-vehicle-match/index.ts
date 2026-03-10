import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckRequest {
  // Mode: "check" (default/legacy), "build_signatures", "disambiguate"
  mode?: "check" | "build_signatures" | "disambiguate";

  // Common
  vehicle_id?: string;
  user_id?: string;
  image_ids?: string[];
  batch_size?: number;
  source_filter?: string;
  dry_run?: boolean;

  // Disambiguate mode: use session clustering to reduce API calls
  use_sessions?: boolean; // default true
  session_gap_minutes?: number; // default 30
}

interface MatchResult {
  image_id: string;
  image_url: string;
  status: "confirmed" | "mismatch" | "ambiguous" | "unrelated" | "reassigned";
  ai_detected_vehicle: string | null;
  suggested_vehicle_id: string | null;
  confidence: number;
  reason: string;
  session_propagated?: boolean;
}

interface VehicleSignature {
  vehicle_id: string;
  label: string; // "A", "B", "C"...
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  signature: {
    paint_colors: string[];
    body_style: string;
    modifications: string[];
    unique_features: string[];
    typical_location: string | null;
  } | null;
  reference_image_url: string | null;
}

// ---------------------------------------------------------------------------
// URL noise detection
// ---------------------------------------------------------------------------

const NOISE_PATTERNS = [
  /\/icons?\//i, /\/ui\//i, /logo|header|footer|nav/i,
  /social|share|facebook|twitter/i, /avatar|profile/i,
  /placeholder|blank|empty|default\./i, /\.svg$/i,
  /badge|button|arrow|chevron/i, /-\d{1,2}x\d{1,2}\./i,
  /placehold\.co/i,
];

function isNoiseUrl(url: string): boolean {
  if (!url || url.startsWith("file://")) return true;
  return NOISE_PATTERNS.some((p) => p.test(url));
}

function isUnfetchableUrl(url: string): boolean {
  return url.includes("fbcdn.net") || url.includes("facebook.com/photo");
}

// ---------------------------------------------------------------------------
// Vision: Build visual signature for a vehicle
// ---------------------------------------------------------------------------

async function buildVehicleSignature(
  imageUrls: string[],
  vehicleDesc: string,
  anthropicKey: string,
): Promise<VehicleSignature["signature"]> {
  const imageContent = imageUrls
    .filter((u) => !isNoiseUrl(u) && !isUnfetchableUrl(u))
    .slice(0, 4)
    .map((url) => ({
      type: "image" as const,
      source: { type: "url" as const, url },
    }));

  if (imageContent.length === 0) return null;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: `These photos are of: ${vehicleDesc}

Describe this SPECIFIC vehicle's distinguishing visual features so it can be told apart from similar vehicles of the same make. Return ONLY valid JSON:
{
  "paint_colors": ["primary color", "secondary if two-tone"],
  "body_style": "e.g. short bed pickup, K5 Blazer with removable top, crew cab long bed",
  "modifications": ["lift kit", "aftermarket wheels", "custom bumper", etc.],
  "unique_features": ["distinctive dent on left fender", "specific wheel style", "roof rack", "license plate state", etc.],
  "typical_location": "description of background/setting if consistent across photos, or null"
}

Be SPECIFIC about colors (not just "red" but "dark red/maroon metallic"). Focus on features that distinguish THIS vehicle from others of the same make/model/era.`,
          },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Signature API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in signature response: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Vision: Disambiguate — which specific vehicle is in this photo?
// ---------------------------------------------------------------------------

async function disambiguateImage(
  imageUrl: string,
  candidates: VehicleSignature[],
  anthropicKey: string,
): Promise<{
  assigned_label: string;
  vehicle_id: string;
  confidence: number;
  distinguishing_features: string[];
  image_type: string;
  reason: string;
}> {
  // Build the context: reference images + text descriptions for each candidate
  const content: any[] = [];

  // First, add reference images for each candidate (if available)
  const candidateDescriptions: string[] = [];
  for (const c of candidates) {
    const desc = [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ");
    let sigDesc = "";
    if (c.signature) {
      const parts: string[] = [];
      if (c.signature.paint_colors?.length) parts.push(`Paint: ${c.signature.paint_colors.join("/")}`);
      if (c.signature.body_style) parts.push(`Body: ${c.signature.body_style}`);
      if (c.signature.modifications?.length) parts.push(`Mods: ${c.signature.modifications.join(", ")}`);
      if (c.signature.unique_features?.length) parts.push(`Unique: ${c.signature.unique_features.join(", ")}`);
      sigDesc = parts.join(". ");
    }

    // Add reference image if available
    if (c.reference_image_url && !isNoiseUrl(c.reference_image_url) && !isUnfetchableUrl(c.reference_image_url)) {
      content.push({
        type: "text",
        text: `--- Reference photo for Vehicle ${c.label} (${desc}): ---`,
      });
      content.push({
        type: "image",
        source: { type: "url", url: c.reference_image_url },
      });
    }

    candidateDescriptions.push(
      `Vehicle ${c.label}: ${desc}${c.vin ? ` (VIN: ${c.vin})` : ""}${sigDesc ? `\n  ${sigDesc}` : ""}`,
    );
  }

  // Add the image to classify
  content.push({
    type: "text",
    text: "--- Image to classify: ---",
  });
  content.push({
    type: "image",
    source: { type: "url", url: imageUrl },
  });

  // The disambiguation prompt
  content.push({
    type: "text",
    text: `The owner of these vehicles needs help sorting photos into the correct vehicle profiles.

CANDIDATE VEHICLES:
${candidateDescriptions.join("\n\n")}

Look at the image to classify above. Which SPECIFIC vehicle (${candidates.map((c) => c.label).join("/")}) is shown?

Consider ALL available clues:
- Paint color and finish (most reliable differentiator)
- Body style and proportions (Blazer vs pickup vs Suburban)
- Wheels, tires, and suspension height
- Modifications, accessories, bumpers
- Any visible damage, patina, or unique wear
- Background location context
- Any visible text, plates, decals, or identifiers
- Interior details (if interior shot)
- If this is a document, receipt, or non-vehicle photo, say "none"

Return ONLY valid JSON:
{
  "assigned_label": "${candidates[0]?.label || "A"}",
  "confidence": 0.0-1.0,
  "distinguishing_features": ["feature1", "feature2"],
  "image_type": "exterior"|"interior"|"engine"|"undercarriage"|"documentation"|"detail"|"unrelated",
  "reason": "brief explanation of why this matches the assigned vehicle"
}

If you genuinely cannot tell which vehicle it is (e.g. extreme close-up of a generic part), use confidence < 0.3 and assign to the vehicle it's currently on.`,
  });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Disambiguate API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in disambiguate response: ${text.slice(0, 200)}`);

  const result = JSON.parse(jsonMatch[0]);

  // Resolve label to vehicle_id
  const matched = candidates.find((c) => c.label === result.assigned_label);
  return {
    ...result,
    vehicle_id: matched?.vehicle_id || candidates[0]?.vehicle_id || "",
  };
}

// ---------------------------------------------------------------------------
// Vision: Simple check (legacy mode — single vehicle, no siblings)
// ---------------------------------------------------------------------------

async function classifyImage(
  imageUrl: string,
  expectedVehicle: string,
  anthropicKey: string,
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
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
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
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
    const mode = body.mode || "check";
    const batchSize = Math.min(body.batch_size || 10, 50);
    const dryRun = body.dry_run ?? false;

    // =====================================================================
    // MODE: build_signatures
    // Build visual fingerprints for a vehicle and its siblings
    // =====================================================================
    if (mode === "build_signatures") {
      if (!body.vehicle_id) throw new Error("vehicle_id required for build_signatures mode");
      if (!body.user_id) throw new Error("user_id required for build_signatures mode");

      // Get the target vehicle + its siblings
      const { data: target } = await supabase
        .from("vehicles")
        .select("id, year, make, model, trim, vin, visual_signature, primary_image_url")
        .eq("id", body.vehicle_id)
        .single();
      if (!target) throw new Error("Vehicle not found");

      const { data: siblings } = await supabase.rpc("get_sibling_vehicles", {
        p_vehicle_id: body.vehicle_id,
        p_user_id: body.user_id,
      });

      const allVehicles = [
        { ...target, vehicle_id: target.id },
        ...(siblings || []).map((s: any) => ({
          id: s.vehicle_id, year: s.v_year, make: s.v_make, model: s.v_model,
          trim: s.v_trim, vin: s.v_vin, visual_signature: s.visual_signature,
          primary_image_url: s.primary_image_url,
        })),
      ];

      const results: { vehicle_id: string; desc: string; signature: any; skipped?: string }[] = [];

      for (const v of allVehicles) {
        const desc = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");

        // Skip if already has a signature and not forcing rebuild
        if (v.visual_signature && !body.source_filter) {
          results.push({ vehicle_id: v.id, desc, signature: v.visual_signature, skipped: "already has signature" });
          continue;
        }

        // Get signature-quality images
        const { data: sigImages } = await supabase.rpc("get_signature_images", {
          p_vehicle_id: v.id,
          p_limit: 5,
        });

        if (!sigImages || sigImages.length === 0) {
          results.push({ vehicle_id: v.id, desc, signature: null, skipped: "no usable images" });
          continue;
        }

        const imageUrls = sigImages.map((i: any) => i.image_url).filter(Boolean);

        try {
          const signature = await buildVehicleSignature(imageUrls, desc, anthropicKey);

          if (!dryRun && signature) {
            await supabase
              .from("vehicles")
              .update({
                visual_signature: {
                  ...signature,
                  signature_image_ids: sigImages.map((i: any) => i.image_id),
                  built_at: new Date().toISOString(),
                },
              })
              .eq("id", v.id);
          }

          results.push({ vehicle_id: v.id, desc, signature });
        } catch (err) {
          results.push({
            vehicle_id: v.id, desc, signature: null,
            skipped: `Vision error: ${(err as Error).message}`,
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, mode, dry_run: dryRun, vehicles_processed: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // MODE: disambiguate
    // Full cross-vehicle disambiguation with session clustering
    // =====================================================================
    if (mode === "disambiguate") {
      if (!body.vehicle_id) throw new Error("vehicle_id required for disambiguate mode");
      if (!body.user_id) throw new Error("user_id required for disambiguate mode");

      const useSessions = body.use_sessions ?? true;
      const sessionGap = body.session_gap_minutes ?? 30;

      // Get the target vehicle
      const { data: target } = await supabase
        .from("vehicles")
        .select("id, year, make, model, trim, vin, visual_signature, primary_image_url")
        .eq("id", body.vehicle_id)
        .single();
      if (!target) throw new Error("Vehicle not found");

      // Get siblings
      const { data: siblings } = await supabase.rpc("get_sibling_vehicles", {
        p_vehicle_id: body.vehicle_id,
        p_user_id: body.user_id,
      });

      // Build candidate list with labels
      const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const candidates: VehicleSignature[] = [
        {
          vehicle_id: target.id,
          label: labels[0],
          year: target.year, make: target.make, model: target.model,
          trim: target.trim, vin: target.vin,
          signature: target.visual_signature,
          reference_image_url: target.primary_image_url,
        },
        ...(siblings || []).map((s: any, i: number) => ({
          vehicle_id: s.vehicle_id,
          label: labels[i + 1] || `V${i + 2}`,
          year: s.v_year, make: s.v_make, model: s.v_model,
          trim: s.v_trim, vin: s.v_vin,
          signature: s.visual_signature,
          reference_image_url: s.primary_image_url,
        })),
      ];

      // Get images to check
      let imagesToCheck: { id: string; image_url: string; session_num?: number }[] = [];

      if (body.image_ids?.length) {
        // Explicit image IDs
        const { data } = await supabase
          .from("vehicle_images")
          .select("id, image_url")
          .in("id", body.image_ids)
          .limit(batchSize);
        imagesToCheck = (data || []).map((i: any) => ({ id: i.id, image_url: i.image_url }));
      } else if (useSessions) {
        // Use session clustering: pick one representative per session
        const { data: sessions } = await supabase.rpc("cluster_vehicle_images_by_session", {
          p_vehicle_id: body.vehicle_id,
          p_session_gap_minutes: sessionGap,
        });

        if (sessions && sessions.length > 0) {
          // Pick one image per session (first image with a usable URL)
          const sessionMap = new Map<number, any>();
          for (const s of sessions) {
            if (!sessionMap.has(s.session_num) &&
                s.image_url && !isNoiseUrl(s.image_url) && !isUnfetchableUrl(s.image_url) &&
                !s.image_vehicle_match_status) {
              sessionMap.set(s.session_num, s);
            }
          }
          imagesToCheck = [...sessionMap.values()]
            .slice(0, batchSize)
            .map((s: any) => ({ id: s.image_id, image_url: s.image_url, session_num: s.session_num }));
        }

        // Also get non-session images (no timestamp) that need checking
        if (imagesToCheck.length < batchSize) {
          const remaining = batchSize - imagesToCheck.length;
          const { data: noTimestamp } = await supabase
            .from("vehicle_images")
            .select("id, image_url")
            .eq("vehicle_id", body.vehicle_id)
            .is("image_vehicle_match_status", null)
            .is("taken_at", null)
            .not("image_url", "like", "file://%")
            .limit(remaining);
          if (noTimestamp) {
            imagesToCheck.push(
              ...noTimestamp
                .filter((i: any) => i.image_url && !isNoiseUrl(i.image_url) && !isUnfetchableUrl(i.image_url))
                .map((i: any) => ({ id: i.id, image_url: i.image_url })),
            );
          }
        }
      } else {
        // No sessions — just grab unvalidated images
        const { data } = await supabase
          .from("vehicle_images")
          .select("id, image_url")
          .eq("vehicle_id", body.vehicle_id)
          .is("image_vehicle_match_status", null)
          .not("image_url", "like", "file://%")
          .limit(batchSize);
        imagesToCheck = (data || [])
          .filter((i: any) => i.image_url && !isNoiseUrl(i.image_url) && !isUnfetchableUrl(i.image_url))
          .map((i: any) => ({ id: i.id, image_url: i.image_url }));
      }

      if (imagesToCheck.length === 0) {
        return new Response(
          JSON.stringify({
            success: true, mode, message: "No images to disambiguate",
            candidates: candidates.map((c) => `${c.label}: ${[c.year, c.make, c.model].filter(Boolean).join(" ")}`),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Process each image (or session representative)
      const results: MatchResult[] = [];
      const errors: { image_id: string; error: string }[] = [];
      const currentVehicleLabel = candidates[0].label;

      for (const img of imagesToCheck) {
        try {
          const ai = await disambiguateImage(img.image_url, candidates, anthropicKey);

          const isCurrentVehicle = ai.vehicle_id === body.vehicle_id;
          let status: MatchResult["status"];

          if (ai.image_type === "unrelated" || ai.image_type === "documentation") {
            status = ai.confidence > 0.7 ? "unrelated" : "ambiguous";
          } else if (isCurrentVehicle) {
            status = "confirmed";
          } else if (ai.confidence >= 0.5) {
            status = "reassigned"; // Should move to a different vehicle
          } else {
            status = "ambiguous";
          }

          const r: MatchResult = {
            image_id: img.id,
            image_url: img.image_url,
            status,
            ai_detected_vehicle: ai.distinguishing_features?.join(", ") || null,
            suggested_vehicle_id: isCurrentVehicle ? null : ai.vehicle_id,
            confidence: ai.confidence,
            reason: ai.reason,
          };
          results.push(r);

          // Write results
          if (!dryRun) {
            const update: Record<string, any> = {
              image_vehicle_match_status: status === "reassigned" ? "mismatch" : status,
            };
            if (!isCurrentVehicle && ai.confidence >= 0.5) {
              update.suggested_vehicle_id = ai.vehicle_id;
              update.auto_suggestion_confidence = ai.confidence;
              update.auto_suggestion_reasons = ai.distinguishing_features || [];
            }
            await supabase.from("vehicle_images").update(update).eq("id", img.id);

            // Session propagation: if this was a session representative, propagate to all images in that session
            if (img.session_num != null && status === "confirmed" && ai.confidence >= 0.7) {
              const { data: sessionImages } = await supabase.rpc("cluster_vehicle_images_by_session", {
                p_vehicle_id: body.vehicle_id,
                p_session_gap_minutes: sessionGap,
              });
              if (sessionImages) {
                const sessionPeers = sessionImages
                  .filter((s: any) => s.session_num === img.session_num && s.image_id !== img.id && !s.image_vehicle_match_status);
                for (const peer of sessionPeers) {
                  await supabase.from("vehicle_images")
                    .update({ image_vehicle_match_status: "confirmed" })
                    .eq("id", peer.image_id);
                  results.push({
                    image_id: peer.image_id,
                    image_url: peer.image_url,
                    status: "confirmed",
                    ai_detected_vehicle: null,
                    suggested_vehicle_id: null,
                    confidence: ai.confidence * 0.9, // Slight discount for propagation
                    reason: `Session propagation from ${img.id} (session ${img.session_num})`,
                    session_propagated: true,
                  });
                }
              }
            }
          }
        } catch (err) {
          errors.push({ image_id: img.id, error: `Disambiguate error: ${(err as Error).message}` });
          if (!dryRun) {
            await supabase.from("vehicle_images")
              .update({ image_vehicle_match_status: "ambiguous" })
              .eq("id", img.id);
          }
        }
      }

      const summary = {
        total_checked: imagesToCheck.length,
        total_results: results.length,
        confirmed: results.filter((r) => r.status === "confirmed").length,
        reassigned: results.filter((r) => r.status === "reassigned").length,
        ambiguous: results.filter((r) => r.status === "ambiguous").length,
        unrelated: results.filter((r) => r.status === "unrelated").length,
        session_propagated: results.filter((r) => r.session_propagated).length,
        errors: errors.length,
        candidates: candidates.map((c) => ({
          label: c.label,
          vehicle_id: c.vehicle_id,
          desc: [c.year, c.make, c.model].filter(Boolean).join(" "),
          has_signature: !!c.signature,
        })),
      };

      return new Response(
        JSON.stringify({
          success: true, mode, dry_run: dryRun, summary, results,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // MODE: check (default/legacy)
    // Simple single-vehicle match checking
    // =====================================================================
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
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicleIds = [...new Set(images.map((i) => i.vehicle_id))];
    const { data: vehicles, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, year, make, model")
      .in("id", vehicleIds);

    if (vehicleError) {
      throw new Error(`Vehicle lookup failed: ${vehicleError.message} (code: ${vehicleError.code})`);
    }
    if (!vehicles || vehicles.length === 0) {
      throw new Error(
        `Vehicle lookup returned 0 results for ${vehicleIds.length} vehicle_ids. PostgREST may be unhealthy.`,
      );
    }

    const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v]));
    const lookupRate = vehicles.length / vehicleIds.length;

    const results: MatchResult[] = [];
    const errors: { image_id: string; error: string }[] = [];

    for (const img of images) {
      const vehicle = vehicleMap.get(img.vehicle_id);
      if (!vehicle) {
        if (lookupRate < 0.5) {
          errors.push({
            image_id: img.id,
            error: `Skipped: vehicle ${img.vehicle_id} not found but lookup rate too low`,
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
          ai_detected_vehicle: null, suggested_vehicle_id: null,
          confidence: 1.0, reason: "Orphaned image — parent vehicle not found",
        });
        continue;
      }

      const url = (img.image_url || "").trim();

      if (isUnfetchableUrl(url)) {
        results.push({
          image_id: img.id, image_url: url, status: "ambiguous",
          ai_detected_vehicle: null, suggested_vehicle_id: null,
          confidence: 0, reason: "Facebook CDN URL — cannot verify via API",
        });
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "ambiguous" })
            .eq("id", img.id);
        }
        continue;
      }

      if (!url || isNoiseUrl(url)) {
        results.push({
          image_id: img.id, image_url: url, status: "unrelated",
          ai_detected_vehicle: null, suggested_vehicle_id: null,
          confidence: 1.0, reason: "Noise/placeholder/local URL",
        });
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "unrelated" })
            .eq("id", img.id);
        }
        continue;
      }

      const expectedVehicle = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");

      try {
        const ai = await classifyImage(url, expectedVehicle, anthropicKey);

        let status: MatchResult["status"];
        if (!ai.is_vehicle) {
          status = "unrelated";
        } else if (ai.matches_expected) {
          status = "confirmed";
        } else if (["interior", "engine", "undercarriage", "documentation"].includes(ai.image_type)) {
          status = ai.confidence > 0.85 ? "mismatch" : "ambiguous";
        } else {
          status = "mismatch";
        }

        results.push({
          image_id: img.id, image_url: url, status,
          ai_detected_vehicle: ai.detected_vehicle || null,
          suggested_vehicle_id: null,
          confidence: ai.confidence, reason: ai.reason,
        });

        if (!dryRun) {
          const update: Record<string, any> = { image_vehicle_match_status: status };
          if (ai.detected_vehicle) update.ai_detected_vehicle = ai.detected_vehicle;
          await supabase.from("vehicle_images").update(update).eq("id", img.id);
        }
      } catch (err) {
        errors.push({ image_id: img.id, error: `Vision error: ${(err as Error).message}` });
        if (!dryRun) {
          await supabase.from("vehicle_images")
            .update({ image_vehicle_match_status: "ambiguous" })
            .eq("id", img.id);
        }
      }
    }

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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * analyze-vehicle-image-haiku
 *
 * Deep vehicle image analysis using Claude Haiku vision.
 * Zone-specific expert prompts that snowball — findings from earlier
 * images feed into analysis of later images for the same vehicle.
 *
 * Modes:
 *   single: Analyze one image with zone-appropriate prompt
 *   batch:  Analyze all images for a vehicle, snowballing context
 *
 * POST /functions/v1/analyze-vehicle-image-haiku
 *   { mode: "single", image_url, image_id?, vehicle_id?, zone? }
 *   { mode: "batch", vehicle_id }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callTierVision } from "../_shared/agentTiers.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Zone-Specific Expert Prompts ──────────────────────────────
// Each zone gets a specialized prompt that knows EXACTLY what an expert
// looks for in that type of photo. These encode decades of automotive
// knowledge that would otherwise require a human appraiser.

const ZONE_PROMPTS: Record<string, string> = {
  vehicle_exterior: `You are an expert vehicle appraiser analyzing an exterior photo.

EXTRACT (JSON):
{
  "zone": "ext_front|ext_rear|ext_driver|ext_passenger|ext_3quarter_front|ext_3quarter_rear|ext_overhead",
  "year_indicators": ["specific visual cues that narrow the model year — headlight shape, bumper style, grille pattern, body line changes"],
  "make_model_confidence": {"make": "...", "model": "...", "generation": "...", "confidence": 0.0-1.0, "evidence": ["what you see"]},
  "trim_indicators": [
    {"feature": "body side molding|bumper style|wheel type|badge|mirror style|glass trim|etc",
     "observation": "what you see",
     "trim_implication": "what trim level this suggests and why"}
  ],
  "paint": {"color": "...", "condition": "original|repaint|primer|rattle_can|professional_respray|patina", "evidence": "..."},
  "body_condition": {"score": 1-5, "rust_locations": [], "dents": [], "missing_parts": [], "damage": []},
  "modifications": [{"part": "...", "type": "aftermarket|oem_upgrade|custom", "details": "..."}],
  "wheels_tires": {"type": "stock_steel|rally|aftermarket_alloy|custom", "tire_type": "...", "condition": "...", "size_estimate": "..."},
  "structural_observations": "any visible frame, unibody, or structural concerns",
  "license_plate": {"state": "...", "number": "...", "visible": true/false},
  "setting": "dealership|private_residence|storage_yard|shop|outdoor|etc"
}

CRITICAL TRIM INDICATORS (GM trucks 1967-1991):
- Body side chrome molding = Cheyenne or higher (Custom/Custom Deluxe lack this)
- Tailgate chrome lock strip = Cheyenne or higher
- Bright window trim = Scottsdale/Cheyenne
- Wheel opening moldings = Silverado
- Two-tone paint (factory) = often Cheyenne Super or Silverado
- Roof drip rail molding = Scottsdale or higher

CRITICAL TRIM INDICATORS (Ford trucks 1967-1996):
- Body side tape stripe = Explorer/XLT
- Chrome bumper vs painted = trim level indicator
- Sliding rear window = often XLT or higher
- Bed rail caps = Lariat

If you can read ANY badge, emblem, or nameplate text, report it exactly.`,

  vehicle_interior: `You are an expert vehicle appraiser analyzing an interior photo.

EXTRACT (JSON):
{
  "zone": "interior_dash|interior_front_seats|interior_rear_seats|interior_cargo|interior_headliner|interior_door_panel",
  "trim_indicators": [
    {"feature": "dash material|seat type|door panel material|headliner|carpet|console|steering_wheel|gauge_cluster|column_type",
     "observation": "what you see",
     "trim_implication": "what this indicates about trim level"}
  ],
  "dash_analysis": {
    "material": "plain_vinyl|woodgrain_insert|padded|brushed_aluminum|etc",
    "gauge_cluster": "present|missing|partial|aftermarket",
    "gauge_count": "number of gauge holes/pods",
    "radio": "original|aftermarket|missing",
    "hvac_controls": "present|missing|type",
    "ac_present": true/false
  },
  "steering": {"column_type": "standard|tilt", "wheel": "original|aftermarket|sport", "shift_type": "column|floor|console"},
  "seats": {"type": "bench|bucket|split_bench|captain", "material": "vinyl|cloth|leather", "condition": "...", "original": true/false},
  "console": {"present": true/false, "type": "factory|aftermarket", "condition": "..."},
  "floor_condition": {"carpet": "present|missing|replaced", "floor_pans": "solid|surface_rust|rust_through|patched", "mats": "..."},
  "headliner": {"condition": "good|sagging|missing|replaced"},
  "missing_parts": ["list everything that should be there but isn't"],
  "modifications": ["any non-original parts"],
  "condition_score": 1-5,
  "overall_assessment": "..."
}

CRITICAL INTERIOR TRIM INDICATORS (GM trucks 1973-1987):
- Plain vinyl dash = Custom (base)
- Color-keyed vinyl dash = Custom Deluxe
- Woodgrain dash insert = Cheyenne or Cheyenne Super
- Brushed aluminum dash = Silverado (1981+)
- Standard column = Custom/Custom Deluxe
- Tilt column = Cheyenne and above (or RPO N33 option)
- Bench seat = base/Custom Deluxe; Buckets + console = Cheyenne Super option
- Door panel: plain = Custom, patterned vinyl = Custom Deluxe, full trim = Cheyenne+

Report the SPID label if visible (glove box door, sun visor, or B-pillar).`,

  engine_bay: `You are an expert mechanic analyzing an engine bay photo.

EXTRACT (JSON):
{
  "zone": "engine_bay",
  "engine_identification": {
    "manufacturer": "Chevrolet|Ford|Mopar|etc",
    "family": "Small Block Chevy|Big Block Chevy|Windsor|FE|Cleveland|Slant Six|LA|etc",
    "evidence": ["valve cover color (orange=Chevy factory, blue=Ford, red/orange=Mopar)", "valve cover style", "intake manifold", "distributor location"],
    "displacement_estimate": "based on visible casting numbers, valve cover width, or known configurations",
    "fuel_system": "carburetor|fuel_injection|tbi|efi",
    "carburetor_type": "Rochester|Holley|Edelbrock|Carter|etc — if visible",
    "air_cleaner": "stock|aftermarket — brand if identifiable (K&N, Edelbrock, etc)"
  },
  "accessories": {
    "ac_compressor": "present|removed|bracket_only|aftermarket",
    "power_steering": "present|absent|type",
    "alternator": "stock|aftermarket|high_output",
    "smog_equipment": "present|removed|era_correct"
  },
  "exhaust": {"manifolds": "stock_cast_iron|headers|type_if_identifiable"},
  "modifications": [{"component": "...", "observation": "...", "type": "performance|replacement|custom"}],
  "wiring": {"condition": "factory|modified|hack_job|rewired", "observations": "..."},
  "fluid_leaks": ["any visible leaks or stains"],
  "rust_corrosion": {"firewall": "...", "fender_wells": "...", "cowl": "...", "battery_tray": "..."},
  "overall_condition": 1-5,
  "notable": "anything unusual, valuable, or concerning"
}

ENGINE COLOR GUIDE (factory colors indicate originality):
- Chevrolet: Orange (1955-1985 standard), Red (Corvette), Blue (some marine/industrial)
- Ford: Ford Blue (289/302/351W), Black (351C/400/460), Medium Blue (later)
- Mopar: Hemi Orange, Red (some LA engines)
- Pontiac: Metallic Blue
- Buick: Red (Stage 1), Gold (Buick V8)
- If repainted black/silver/other — note as "non-factory color, likely rebuilt or dressed"

CASTING NUMBERS: Look for any visible casting numbers on block, heads, intake manifold. Report exactly what's visible.`,

  undercarriage: `You are an expert vehicle appraiser analyzing an undercarriage/suspension photo.

EXTRACT (JSON):
{
  "zone": "undercarriage_front|undercarriage_rear|undercarriage_frame|wheel_well",
  "suspension_type": {"front": "coil_spring|leaf_spring|torsion_bar|independent", "rear": "leaf_spring|coil_spring|4_link"},
  "drivetrain_indicators": {"4wd_evidence": "transfer_case|front_axle|cv_shafts|etc", "axle_type": "..."},
  "frame_condition": {"type": "body_on_frame|unibody", "rust": "none|surface|moderate|severe|rot_through", "locations": []},
  "brake_system": {"type": "drum|disc|disc_front_drum_rear", "condition": "..."},
  "exhaust_visible": {"type": "single|dual", "condition": "...", "material": "stock|stainless|aftermarket"},
  "rust_assessment": {"severity": 1-5, "structural_concern": true/false, "locations": [], "details": "..."},
  "modifications": ["lift kit", "lowering", "aftermarket shocks", "etc"],
  "tire_tread": {"remaining_pct": "estimate", "even_wear": true/false, "type": "..."},
  "fluid_leaks": ["any visible drips or stains"],
  "overall_condition": 1-5
}

4WD IDENTIFICATION (GM trucks):
- K-series (K5, K10, K20) = 4WD: look for front differential, transfer case, front driveshaft
- C-series (C10, C20) = 2WD: no front differential
- Coil spring front = K5 Blazer/Jimmy, later K-series
- Leaf spring front = early K-series (pre-1973 for some)`,

  detail_closeup: `You are an expert vehicle appraiser analyzing a detail/closeup photo.

EXTRACT (JSON):
{
  "zone": "detail",
  "subject": "what the closeup shows — badge, rust spot, part, damage, etc",
  "text_visible": ["any text, numbers, casting numbers, part numbers, labels"],
  "badge_emblem": {"text": "...", "location": "...", "indicates": "..."},
  "condition_detail": {"what": "...", "severity": 1-5, "repair_needed": "..."},
  "part_identification": {"name": "...", "oem_or_aftermarket": "...", "brand": "...", "part_number": "..."},
  "implications": "what this detail tells us about the vehicle — trim level, condition, history, originality"
}

Look for: VIN plates, door jamb stickers, SPID labels, RPO stickers, casting numbers, date codes, part numbers, assembly plant codes. ANY alphanumeric text visible should be reported exactly.`,

  other: `You are an expert vehicle appraiser. Analyze this automotive image.

EXTRACT (JSON):
{
  "zone": "best classification of what this shows",
  "description": "what you see",
  "vehicle_identification": {"year_range": "...", "make": "...", "model": "...", "confidence": 0.0-1.0},
  "condition_indicators": ["anything visible about condition"],
  "notable": "anything interesting or valuable",
  "text_visible": ["any text in the image"]
}`,
};

// ── Snowball Context Builder ──────────────────────────────────
// Takes findings from previous images and builds context for the next one

function buildSnowballContext(previousFindings: any[]): string {
  if (!previousFindings.length) return "";

  const lines = ["\n\nCONTEXT FROM OTHER IMAGES OF THIS VEHICLE:"];
  for (const f of previousFindings) {
    if (f.zone) lines.push(`- [${f.zone}]: ${f.summary || JSON.stringify(f).slice(0, 200)}`);
  }
  lines.push("\nUse this context to VERIFY, CONTRADICT, or ADD DETAIL to your analysis. Flag any discrepancies between images.");
  return lines.join("\n");
}

// ── Single Image Analysis ────────────────────────────────────

interface AnalysisResult {
  zone: string;
  analysis: any;
  summary: string;
  extracted_fields: Record<string, any>;
  cost_usd: number;
}

async function analyzeSingle(
  imageUrl: string,
  zone: string | null,
  vehicleContext: string | null,
  snowballContext: string,
): Promise<AnalysisResult> {
  // Pick zone-specific prompt
  const promptKey = zone && ZONE_PROMPTS[zone] ? zone : "other";
  let systemPrompt = ZONE_PROMPTS[promptKey];

  // Add vehicle context if known
  if (vehicleContext) {
    systemPrompt += `\n\nKNOWN VEHICLE CONTEXT:\n${vehicleContext}`;
  }

  // Add snowball context from prior images
  if (snowballContext) {
    systemPrompt += snowballContext;
  }

  const result = await callTierVision(
    "haiku",
    systemPrompt,
    "Analyze this vehicle image. Return JSON only.",
    [imageUrl],
    { maxTokens: 2048 },
  );

  if (!result.content) {
    throw new Error(`Vision analysis failed: no content returned`);
  }

  // Parse JSON from response
  let analysis: any = {};
  try {
    const text = result.content;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[0]);
    }
  } catch {
    analysis = { raw_response: result.content?.slice(0, 500) };
  }

  // Extract key fields
  const extracted: Record<string, any> = {};
  const detectedZone = analysis.zone || zone || "unknown";

  // Pull out fields that map to vehicle columns
  if (analysis.make_model_confidence?.make) extracted.make = analysis.make_model_confidence.make;
  if (analysis.make_model_confidence?.model) extracted.model = analysis.make_model_confidence.model;
  if (analysis.engine_identification?.family) extracted.engine_family = analysis.engine_identification.family;
  if (analysis.engine_identification?.displacement_estimate) extracted.engine_size = analysis.engine_identification.displacement_estimate;
  if (analysis.paint?.color) extracted.exterior_color = analysis.paint.color;
  if (analysis.dash_analysis?.material) extracted.dash_material = analysis.dash_analysis.material;
  if (analysis.steering?.column_type) extracted.column_type = analysis.steering.column_type;
  if (analysis.license_plate?.state) extracted.plate_state = analysis.license_plate.state;
  if (analysis.license_plate?.number) extracted.plate_number = analysis.license_plate.number;

  // Trim indicators
  const trimIndicators = analysis.trim_indicators || [];
  if (trimIndicators.length > 0) extracted.trim_indicators = trimIndicators;

  // Build summary for snowball context
  const summaryParts: string[] = [];
  if (analysis.body_condition?.score) summaryParts.push(`condition:${analysis.body_condition.score}/5`);
  if (analysis.overall_condition) summaryParts.push(`condition:${analysis.overall_condition}/5`);
  if (analysis.condition_score) summaryParts.push(`condition:${analysis.condition_score}/5`);
  if (trimIndicators.length) summaryParts.push(`${trimIndicators.length} trim indicators`);
  if (analysis.modifications?.length) summaryParts.push(`${analysis.modifications.length} mods`);
  if (analysis.missing_parts?.length) summaryParts.push(`${analysis.missing_parts.length} missing parts`);
  if (extracted.engine_family) summaryParts.push(extracted.engine_family);

  return {
    zone: detectedZone,
    analysis,
    summary: summaryParts.join(", ") || "analyzed",
    extracted_fields: extracted,
    cost_usd: result.costCents ? result.costCents / 100 : 0,
  };
}

// ── Batch Analysis (Snowball Mode) ───────────────────────────

async function analyzeBatch(vehicleId: string): Promise<{
  results: AnalysisResult[];
  synthesis: any;
  total_cost_usd: number;
}> {
  // Get all images for this vehicle
  const { data: images } = await supabase
    .from("vehicle_images")
    .select("id, image_url, ai_processing_status")
    .eq("vehicle_id", vehicleId)
    .not("image_url", "is", null)
    .order("is_primary", { ascending: false })
    .order("created_at");

  if (!images?.length) {
    throw new Error("No images found for vehicle");
  }

  // Get vehicle context for informed analysis
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("year, make, model, trim, color, mileage, description, notes")
    .eq("id", vehicleId)
    .single();

  const vehicleContext = vehicle
    ? `${vehicle.year || "?"} ${vehicle.make || "?"} ${vehicle.model || "?"} ${vehicle.trim ? `(${vehicle.trim})` : ""}. Color: ${vehicle.color || "unknown"}. Mileage: ${vehicle.mileage || "unknown"}.`
    : null;

  // First pass: Gemini classify zones (if not already done)
  // For now, we'll let Haiku self-classify the zone during analysis

  const results: AnalysisResult[] = [];
  let totalCost = 0;

  for (const img of images) {
    // Build snowball context from previous findings
    const snowball = buildSnowballContext(
      results.map(r => ({ zone: r.zone, summary: r.summary }))
    );

    try {
      console.log(`[haiku-vision] Analyzing image ${img.id} (${results.length + 1}/${images.length})...`);
      const result = await analyzeSingle(img.image_url, null, vehicleContext, snowball);
      results.push(result);
      totalCost += result.cost_usd;

      // Update the image record
      await supabase.from("vehicle_images").update({
        ai_processing_status: "completed",
        ai_scan_metadata: {
          haiku_analysis: result.analysis,
          zone: result.zone,
          extracted_fields: result.extracted_fields,
          analyzed_at: new Date().toISOString(),
        },
      }).eq("id", img.id);

    } catch (err: any) {
      console.warn(`[haiku-vision] Image ${img.id} failed: ${err.message}`);
      await supabase.from("vehicle_images").update({
        ai_processing_status: "failed",
      }).eq("id", img.id);
    }

    // Brief pause between images
    await new Promise(r => setTimeout(r, 500));
  }

  // Synthesis pass: aggregate all findings into vehicle-level assessment
  let synthesis: any = null;
  if (results.length >= 2) {
    try {
      const synthResult = await callTierVision(
        "haiku",
        `You are an expert vehicle appraiser. You have analyzed ${results.length} images of the same vehicle. Synthesize all findings into a unified vehicle assessment.

Return JSON:
{
  "confirmed_identity": {"year": ..., "make": "...", "model": "...", "trim": "...", "confidence": 0.0-1.0},
  "trim_determination": {"level": "...", "confidence": 0.0-1.0, "evidence": ["list of indicators from across all images"], "needs_verification": ["what would confirm/deny"]},
  "condition_overall": {"score": 1-5, "category": "concours|excellent|good|fair|project|parts_car", "summary": "..."},
  "engine": {"type": "...", "displacement": "...", "original": true/false/unknown},
  "drivetrain": {"type": "2wd|4wd|awd", "transmission": "...", "evidence": "..."},
  "modifications_summary": ["all mods found across images"],
  "missing_parts_summary": ["all missing parts found across images"],
  "rust_assessment": {"severity": 1-5, "structural": true/false, "locations": []},
  "discrepancies": ["any contradictions between seller claims and photo evidence"],
  "seller_questions": ["questions to ask the seller based on photo analysis"],
  "value_factors": {"positives": ["..."], "negatives": ["..."], "unknowns": ["..."]}
}`,
        "Individual image analyses:\n" + results.map((r, i) =>
          `Image ${i + 1} [${r.zone}]: ${JSON.stringify(r.analysis).slice(0, 800)}`
        ).join("\n\n"),
        [images[0].image_url], // Include primary image for reference
        { maxTokens: 3000 },
      );

      if (synthResult.content) {
        const jsonMatch = synthResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) synthesis = JSON.parse(jsonMatch[0]);
        totalCost += synthResult.costCents ? synthResult.costCents / 100 : 0;
      }
    } catch (err: any) {
      console.warn(`[haiku-vision] Synthesis failed: ${err.message}`);
    }
  }

  return { results, synthesis, total_cost_usd: totalCost };
}

// ── Serve ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const mode = body.mode || "single";

    if (mode === "single") {
      const imageUrl = body.image_url;
      if (!imageUrl) {
        return new Response(JSON.stringify({ error: "image_url required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await analyzeSingle(
        imageUrl,
        body.zone || null,
        body.vehicle_context || null,
        body.snowball_context || "",
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "batch") {
      const vehicleId = body.vehicle_id;
      if (!vehicleId) {
        return new Response(JSON.stringify({ error: "vehicle_id required for batch mode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await analyzeBatch(vehicleId);

      return new Response(JSON.stringify({
        vehicle_id: vehicleId,
        images_analyzed: result.results.length,
        synthesis: result.synthesis,
        total_cost_usd: result.total_cost_usd,
        results: result.results.map(r => ({
          zone: r.zone,
          summary: r.summary,
          extracted_fields: r.extracted_fields,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "mode must be 'single' or 'batch'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

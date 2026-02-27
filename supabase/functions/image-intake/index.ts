/**
 * Image Intake - Simple bulk image upload with vehicle routing
 *
 * Upload images → AI identifies vehicle → routes to DB
 * Texts user ONLY when confused about which vehicle
 *
 * POST /functions/v1/image-intake
 * Body: { userId, images: [{url, takenAt?, caption?}], notifyPhone? }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Compute SHA-256 hash of image bytes — used for exact duplicate detection
async function computeSha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Fetch image bytes and compute file_hash. Returns null if fetch fails or times out.
async function tryComputeFileHash(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await computeSha256(new Uint8Array(await resp.arrayBuffer()));
  } catch {
    return null;
  }
}

// Fire-and-forget: record image appearance in image_source_appearances.
// Non-blocking — intake must not fail if this fails.
function recordSourceAppearance(params: {
  imageId: string;
  canonicalImageId: string;
  phash: string | null;
  source: string | null;
  sourceUrl: string | null;
  vehicleId: string | null;
}): void {
  supabase.from("image_source_appearances").insert({
    image_id: params.imageId,
    canonical_image_id: params.canonicalImageId,
    phash: params.phash,
    source: params.source || "image_intake",
    source_url: params.sourceUrl,
    vehicle_id: params.vehicleId,
    seen_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.error("image_source_appearances insert failed (non-fatal):", error.message);
  });
}

interface ImageInput {
  url: string;
  takenAt?: string;
  caption?: string;
  localPath?: string;
}

interface VehicleMatch {
  vehicleId: string | null;
  confidence: number;
  hints: {
    year?: number;
    make?: string;
    model?: string;
    color?: string;
    vin?: string;
  };
  description: string;
  isVehiclePhoto: boolean;
}

// Analyze images in batch - identify vehicles
async function analyzeImages(
  images: ImageInput[],
  knownVehicles: Array<{ id: string; year: number; make: string; model: string; color?: string }>
): Promise<VehicleMatch[]> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const vehicleList = knownVehicles.length > 0
    ? `Known vehicles:\n${knownVehicles.map((v, i) =>
        `${i + 1}. ${v.year} ${v.make} ${v.model}${v.color ? ` (${v.color})` : ''} [ID: ${v.id}]`
      ).join('\n')}`
    : 'No known vehicles provided.';

  const prompt = `Analyze these ${images.length} images. For each, determine:
1. Is it a vehicle photo? (exterior, interior, engine, undercarriage, detail shot, etc.)
2. If yes, identify: year, make, model, color
3. Match to known vehicles if possible

${vehicleList}

Return JSON array with one object per image (same order as input):
[
  {
    "isVehiclePhoto": true,
    "vehicleId": "uuid-if-matched-or-null",
    "confidence": 0.95,
    "hints": {"year": 2019, "make": "Ford", "model": "F-150", "color": "white"},
    "description": "Exterior front 3/4 view"
  },
  ...
]

For non-vehicle photos (documents, people, random), set isVehiclePhoto: false.
Only set vehicleId if you're confident it matches a known vehicle.`;

  const imageContents = images.map((img) => ({
    type: "image",
    source: { type: "url", url: img.url },
  }));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [...imageContents, { type: "text", text: prompt }],
        }],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Image analysis failed:", e);
  }

  // Fallback - mark all as needing review
  return images.map(() => ({
    vehicleId: null,
    confidence: 0,
    hints: {},
    description: "Analysis failed",
    isVehiclePhoto: false,
  }));
}

// Find matching vehicle from hints
async function findVehicle(
  hints: { year?: number; make?: string; model?: string; vin?: string },
  userId: string
): Promise<string | null> {
  if (hints.vin) {
    const { data } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", hints.vin)
      .maybeSingle();
    if (data) return data.id;
  }

  if (!hints.year && !hints.make && !hints.model) return null;

  // Search user's vehicles first
  let query = supabase
    .from("vehicles")
    .select("id")
    .limit(5);

  if (hints.year) query = query.eq("year", hints.year);
  if (hints.make) query = query.ilike("make", `%${hints.make}%`);
  if (hints.model) query = query.ilike("model", `%${hints.model}%`);

  const { data } = await query;
  if (data?.length === 1) return data[0].id;

  return null;
}

// Send clarification SMS
async function sendClarificationSMS(
  phone: string,
  unclearImages: Array<{ url: string; hints: any; index: number }>
) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromNumber || accountSid.includes("your-")) {
    console.log("Twilio not configured, skipping SMS");
    return;
  }

  const count = unclearImages.length;
  const samples = unclearImages.slice(0, 3).map(img => {
    const h = img.hints;
    return h.year || h.make || h.model
      ? `${h.year || '?'} ${h.make || '?'} ${h.model || '?'}`
      : 'unknown vehicle';
  });

  const message = `${count} image${count > 1 ? 's' : ''} need vehicle ID:\n${samples.join('\n')}${count > 3 ? `\n+${count - 3} more` : ''}\n\nReply with VIN or year/make/model for each.`;

  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone.startsWith("+") ? phone : `+${phone}`,
          From: fromNumber,
          Body: message,
        }),
      }
    );
  } catch (e) {
    console.error("SMS failed:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Verify authenticated user
    const authHeader = req.headers.get("Authorization");
    let authenticatedUserId: string | null = null;

    if (authHeader) {
      const { createClient: createAuthClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const authSupabase = createAuthClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await authSupabase.auth.getUser();
      authenticatedUserId = user?.id || null;
    }

    // Require auth - either JWT or service role key
    const isServiceRole = authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "NONE");
    if (!authenticatedUserId && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { userId, images, notifyPhone } = await req.json();

    // Use authenticated user ID, only allow userId override for service role calls
    const effectiveUserId = isServiceRole ? (userId || authenticatedUserId) : authenticatedUserId;

    if (!images?.length) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${images.length} images for user ${effectiveUserId}`);

    // Get user's known vehicles for matching (scoped to user)
    let vehicleQuery = supabase
      .from("vehicles")
      .select("id, year, make, model, exterior_color")
      .limit(50);
    if (effectiveUserId) {
      vehicleQuery = vehicleQuery.eq("user_id", effectiveUserId);
    }
    const { data: userVehicles } = await vehicleQuery;

    const knownVehicles = (userVehicles || []).map(v => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.exterior_color,
    }));

    // Process in batches of 10
    const batchSize = 10;
    const results: Array<{
      imageUrl: string;
      vehicleId: string | null;
      status: "matched" | "created" | "pending" | "skipped";
      confidence: number;
    }> = [];

    const pendingClarification: Array<{ url: string; hints: any; index: number }> = [];

    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const analyses = await analyzeImages(batch, knownVehicles);

      for (let j = 0; j < batch.length; j++) {
        const img = batch[j];
        const analysis = analyses[j] || { isVehiclePhoto: false, vehicleId: null, confidence: 0, hints: {}, description: "" };

        // Skip non-vehicle photos
        if (!analysis.isVehiclePhoto) {
          results.push({
            imageUrl: img.url,
            vehicleId: null,
            status: "skipped",
            confidence: 0,
          });
          continue;
        }

        let vehicleId = analysis.vehicleId;
        let status: "matched" | "created" | "pending" = "pending";

        // If AI matched to known vehicle with high confidence, use it
        if (vehicleId && analysis.confidence >= 0.8) {
          status = "matched";
        }
        // Try to find vehicle from hints
        else if (analysis.hints && Object.keys(analysis.hints).length > 0) {
          const foundId = await findVehicle(analysis.hints, effectiveUserId);
          if (foundId) {
            vehicleId = foundId;
            status = "matched";
          }
        }

        // If still no match and confidence is low, queue for clarification
        if (!vehicleId || analysis.confidence < 0.7) {
          pendingClarification.push({
            url: img.url,
            hints: analysis.hints,
            index: i + j,
          });
          status = "pending";
        }

        // Hash + dedup check (non-blocking on failure)
        let fileHash: string | null = null;
        let isDuplicate = false;
        let duplicateOf: string | null = null;
        try {
          fileHash = await tryComputeFileHash(img.url);
          if (fileHash) {
            const { data: hashMatch } = await supabase
              .from("vehicle_images")
              .select("id")
              .eq("file_hash", fileHash)
              .maybeSingle();
            if (hashMatch) {
              isDuplicate = true;
              duplicateOf = hashMatch.id;
            }
          }
        } catch (dedupErr) {
          console.error("Dedup check failed (non-fatal):", dedupErr);
        }

        // Insert image record
        if (vehicleId) {
          const insertPayload: Record<string, unknown> = {
            vehicle_id: vehicleId,
            image_url: img.url,
            category: "work",
            caption: analysis.description,
            source: "image_intake",
            metadata: {
              source: "image_intake",
              taken_at: img.takenAt,
              ai_confidence: analysis.confidence,
              ai_hints: analysis.hints,
            },
          };
          if (fileHash) insertPayload.file_hash = fileHash;
          if (isDuplicate) {
            insertPayload.is_duplicate = true;
            insertPayload.duplicate_of = duplicateOf;
          }

          const { data: insertedImage } = await supabase
            .from("vehicle_images")
            .insert(insertPayload)
            .select("id, source, source_url, phash")
            .maybeSingle();

          // Fire-and-forget: record appearance in image_source_appearances
          if (insertedImage) {
            const canonicalId = isDuplicate && duplicateOf ? duplicateOf : insertedImage.id;
            recordSourceAppearance({
              imageId: insertedImage.id,
              canonicalImageId: canonicalId,
              phash: insertedImage.phash ?? null,
              source: insertedImage.source ?? "image_intake",
              sourceUrl: insertedImage.source_url ?? img.url,
              vehicleId,
            });
          }
        } else {
          // Store in pending queue
          await supabase.from("pending_image_assignments").upsert({
            image_url: img.url,
            user_id: effectiveUserId,
            ai_hints: analysis.hints,
            ai_description: analysis.description,
            ai_confidence: analysis.confidence,
            status: "pending",
            created_at: new Date().toISOString(),
          }, { onConflict: "image_url" });
        }

        results.push({
          imageUrl: img.url,
          vehicleId,
          status,
          confidence: analysis.confidence,
        });
      }
    }

    // Send clarification SMS if needed
    if (pendingClarification.length > 0 && notifyPhone) {
      await sendClarificationSMS(notifyPhone, pendingClarification);
    }

    const matched = results.filter(r => r.status === "matched").length;
    const pending = results.filter(r => r.status === "pending").length;
    const skipped = results.filter(r => r.status === "skipped").length;

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total: images.length,
        matched,
        pending,
        skipped,
        clarificationSent: pendingClarification.length > 0 && notifyPhone ? true : false,
      },
      results,
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Image intake error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

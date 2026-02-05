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
      .single();
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
    const { userId, images, notifyPhone } = await req.json();

    if (!images?.length) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${images.length} images for user ${userId}`);

    // Get user's known vehicles for matching
    const { data: userVehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, exterior_color")
      .limit(50);

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
          const foundId = await findVehicle(analysis.hints, userId);
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

        // Insert image record
        if (vehicleId) {
          await supabase.from("vehicle_images").insert({
            vehicle_id: vehicleId,
            image_url: img.url,
            category: "work", // Default category
            caption: analysis.description,
            metadata: {
              source: "image_intake",
              taken_at: img.takenAt,
              ai_confidence: analysis.confidence,
              ai_hints: analysis.hints,
            },
          });
        } else {
          // Store in pending queue
          await supabase.from("pending_image_assignments").upsert({
            image_url: img.url,
            user_id: userId,
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

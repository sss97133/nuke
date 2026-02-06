/**
 * Ingest Photo Library - Ultimate Onboarding Service
 *
 * Scans a user's photo library, identifies automotive content,
 * clusters by vehicle, and reconstructs work history.
 *
 * This is how we build an instant career portfolio from years of photos.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!
});

interface PhotoClassification {
  is_automotive: boolean;
  confidence: number;
  category: 'vehicle_exterior' | 'vehicle_interior' | 'engine_bay' | 'undercarriage' |
            'detail_shot' | 'parts' | 'receipt' | 'documentation' | 'shop_environment' |
            'progress_shot' | 'before_after' | 'not_automotive';
  vehicle_hints: {
    make?: string;
    model?: string;
    year_range?: string;
    color?: string;
    body_style?: string;
    distinguishing_features?: string[];
  };
  work_type_hints?: string[];  // ac, electrical, body, paint, mechanical, etc.
  is_receipt: boolean;
  text_detected?: string[];
  quality_score: number;  // 0-1, for portfolio curation
}

interface PhotoBatch {
  photos: Array<{
    id: string;
    url: string;
    taken_at: string;
    filename: string;
  }>;
  user_id: string;
  batch_id: string;
}

// Classify a single photo
async function classifyPhoto(photoUrl: string): Promise<PhotoClassification> {
  try {
    const imageResponse = await fetch(photoUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);

    let base64Image = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      base64Image += String.fromCharCode.apply(null, Array.from(chunk));
    }
    base64Image = btoa(base64Image);

    const mediaType = photoUrl.includes('.png') ? 'image/png' : 'image/jpeg';

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: `Analyze this photo for automotive content. We're building a technician's career portfolio.

Is this photo related to cars, trucks, motorcycles, or automotive work? If yes, classify it.

Return JSON:
{
  "is_automotive": true/false,
  "confidence": 0.0-1.0,
  "category": "vehicle_exterior|vehicle_interior|engine_bay|undercarriage|detail_shot|parts|receipt|documentation|shop_environment|progress_shot|before_after|not_automotive",
  "vehicle_hints": {
    "make": "if identifiable",
    "model": "if identifiable",
    "year_range": "e.g. 1980-1985",
    "color": "primary color",
    "body_style": "truck/sedan/coupe/suv/etc",
    "distinguishing_features": ["rust on fender", "aftermarket wheels", etc]
  },
  "work_type_hints": ["ac", "electrical", "body", "paint", "mechanical", "restoration", "maintenance"],
  "is_receipt": true/false,
  "text_detected": ["any visible text"],
  "quality_score": 0.0-1.0  // How good is this for a portfolio?
}

Be generous with is_automotive - include shop environments, tools in use, parts on workbenches, etc.` }
        ]
      }]
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response");

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Classification failed:", error);
    return {
      is_automotive: false,
      confidence: 0,
      category: 'not_automotive',
      vehicle_hints: {},
      is_receipt: false,
      quality_score: 0
    };
  }
}

// Store classification result
async function storeClassification(
  photoId: string,
  userId: string,
  takenAt: string,
  classification: PhotoClassification
) {
  await supabase.from("photo_library_classifications").upsert({
    photo_id: photoId,
    user_id: userId,
    taken_at: takenAt,
    is_automotive: classification.is_automotive,
    confidence: classification.confidence,
    category: classification.category,
    vehicle_hints: classification.vehicle_hints,
    work_type_hints: classification.work_type_hints,
    is_receipt: classification.is_receipt,
    text_detected: classification.text_detected,
    quality_score: classification.quality_score,
    classified_at: new Date().toISOString()
  }, { onConflict: "photo_id" });
}

// Cluster automotive photos by vehicle
async function clusterByVehicle(userId: string) {
  // Get all automotive photos for user
  const { data: photos } = await supabase
    .from("photo_library_classifications")
    .select("*")
    .eq("user_id", userId)
    .eq("is_automotive", true)
    .order("taken_at", { ascending: true });

  if (!photos?.length) return { clusters: [] };

  // Simple clustering: group by vehicle hints
  const clusters: Record<string, any[]> = {};

  for (const photo of photos) {
    const hints = photo.vehicle_hints || {};
    // Create a signature from available hints
    const sig = [
      hints.make?.toLowerCase(),
      hints.model?.toLowerCase(),
      hints.color?.toLowerCase(),
      hints.body_style?.toLowerCase()
    ].filter(Boolean).join('_') || 'unknown';

    if (!clusters[sig]) clusters[sig] = [];
    clusters[sig].push(photo);
  }

  return { clusters };
}

// Infer work sessions from photo clusters
async function inferWorkSessions(userId: string, vehicleId: string, photos: any[]) {
  // Group photos by date
  const byDate: Record<string, any[]> = {};

  for (const photo of photos) {
    const date = photo.taken_at?.split('T')[0];
    if (!date) continue;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(photo);
  }

  // Create work sessions for dates with significant activity
  const sessions = [];
  for (const [date, datePhotos] of Object.entries(byDate)) {
    if (datePhotos.length < 2) continue; // Skip single photos

    // Infer work type from photos
    const workTypes = new Set<string>();
    for (const p of datePhotos) {
      if (p.work_type_hints) {
        p.work_type_hints.forEach((t: string) => workTypes.add(t));
      }
    }

    sessions.push({
      date,
      photo_count: datePhotos.length,
      work_types: Array.from(workTypes),
      categories: [...new Set(datePhotos.map((p: any) => p.category))],
      has_receipts: datePhotos.some((p: any) => p.is_receipt)
    });
  }

  return sessions;
}

// Main handler
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, user_id, photos, batch_size = 10 } = body;

    if (action === "classify_batch") {
      // Classify a batch of photos
      if (!photos || !Array.isArray(photos)) {
        return new Response(
          JSON.stringify({ error: "photos array required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const results = [];
      for (const photo of photos.slice(0, batch_size)) {
        console.log(`Classifying: ${photo.id}`);
        const classification = await classifyPhoto(photo.url);
        await storeClassification(photo.id, user_id, photo.taken_at, classification);
        results.push({
          photo_id: photo.id,
          ...classification
        });
      }

      const summary = {
        total: results.length,
        automotive: results.filter(r => r.is_automotive).length,
        receipts: results.filter(r => r.is_receipt).length,
        high_quality: results.filter(r => r.quality_score >= 0.7).length
      };

      return new Response(
        JSON.stringify({ summary, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "cluster") {
      // Cluster all automotive photos by vehicle
      const clusters = await clusterByVehicle(user_id);
      return new Response(
        JSON.stringify(clusters),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "infer_sessions") {
      // Infer work sessions from a vehicle cluster
      const { vehicle_id, photo_ids } = body;

      const { data: photos } = await supabase
        .from("photo_library_classifications")
        .select("*")
        .in("photo_id", photo_ids);

      const sessions = await inferWorkSessions(user_id, vehicle_id, photos || []);

      return new Response(
        JSON.stringify({ sessions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "stats") {
      // Get ingestion stats for user
      const { data: classified, count: totalClassified } = await supabase
        .from("photo_library_classifications")
        .select("*", { count: "exact" })
        .eq("user_id", user_id);

      const automotive = classified?.filter(p => p.is_automotive) || [];
      const byCategory = automotive.reduce((acc: Record<string, number>, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {});

      return new Response(
        JSON.stringify({
          total_classified: totalClassified,
          automotive_count: automotive.length,
          by_category: byCategory,
          receipt_count: automotive.filter(p => p.is_receipt).length,
          unique_vehicles_estimate: new Set(
            automotive.map(p => JSON.stringify(p.vehicle_hints))
          ).size
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use: classify_batch, cluster, infer_sessions, stats" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * enhance-qb-confidence
 *
 * For each QB transaction on a vehicle with confidence > 0:
 * 1. Temporal: Find photos within +/- 30 days → more photos = higher score
 * 2. Vendor specialization: known vehicle vendors score higher
 * 3. Amount pattern: large single purchases likely specific parts
 * 4. Combines into enhanced_confidence score
 */

// Vendor specialization scores — how likely this vendor is selling K5-specific parts
const VENDOR_SPECIALIZATION: Record<string, number> = {
  "delmo speed": 0.95,
  "toms off road": 0.90,
  "tom's off road": 0.90,
  "lesa's autobody": 0.85,
  "holley": 0.85,
  "holley performance": 0.85,
  "discount tire": 0.80,
  "autozone": 0.60,
  "o'reilly auto parts": 0.60,
  "carquest": 0.55,
  "ebay": 0.50,
  "a cars life": 0.95,
  "smog vets": 0.70,
  "boulder pit stop": 0.65,
  "dmv": 0.60,
};

function getVendorScore(vendorName: string | null): number {
  if (!vendorName) return 0.3;
  const lower = vendorName.toLowerCase().trim();
  for (const [pattern, score] of Object.entries(VENDOR_SPECIALIZATION)) {
    if (lower.includes(pattern)) return score;
  }
  return 0.3; // unknown vendor
}

function getAmountScore(amount: number): number {
  // Large single purchases are more likely specific parts
  if (amount >= 1000) return 0.9;
  if (amount >= 500) return 0.8;
  if (amount >= 200) return 0.7;
  if (amount >= 50) return 0.5;
  if (amount >= 20) return 0.3;
  return 0.2; // very small — likely consumable
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get all K5 transactions with confidence > 0
    const { data: transactions, error: txErr } = await sb
      .from("qb_transactions")
      .select("id, qb_id, date, vendor_name, total_amount, line_amount, confidence, category")
      .eq("vehicle_id", vehicle_id)
      .gt("confidence", 0)
      .order("date");
    if (txErr) throw new Error(`TX query: ${txErr.message}`);

    // 2. Get all photos with timestamps for this vehicle
    const { data: photos, error: photoErr } = await sb.rpc("execute_sql", {
      query: `
        SELECT id, taken_at::date as photo_date
        FROM vehicle_images
        WHERE vehicle_id = '${vehicle_id}' AND taken_at IS NOT NULL
        ORDER BY taken_at
      `,
    });
    if (photoErr) throw new Error(`Photo query: ${photoErr.message}`);

    // 3. Get manifest devices for cross-referencing
    const { data: devices, error: devErr } = await sb
      .from("vehicle_build_manifest")
      .select("id, device_name, manufacturer, supplier")
      .eq("vehicle_id", vehicle_id);
    if (devErr) throw new Error(`Device query: ${devErr.message}`);

    // 4. Process each transaction
    const updates: any[] = [];
    const photoDateIndex = (photos || []).map((p: any) => ({
      id: p.id,
      date: new Date(p.photo_date),
    }));

    for (const tx of (transactions || [])) {
      const txDate = new Date(tx.date);
      const amount = parseFloat(tx.line_amount || tx.total_amount) || 0;

      // 4a. Temporal correlation: photos within +/- 30 days
      const windowStart = new Date(txDate);
      windowStart.setDate(windowStart.getDate() - 30);
      const windowEnd = new Date(txDate);
      windowEnd.setDate(windowEnd.getDate() + 30);

      const nearbyPhotos = photoDateIndex.filter(
        (p) => p.date >= windowStart && p.date <= windowEnd
      );
      const correlatedPhotoIds = nearbyPhotos.slice(0, 20).map((p) => p.id);

      // Temporal score: 0-1 based on photo density in window
      // 0 photos = 0, 1-5 = 0.3, 6-15 = 0.6, 16+ = 0.9
      let temporalScore = 0;
      if (nearbyPhotos.length >= 16) temporalScore = 0.9;
      else if (nearbyPhotos.length >= 6) temporalScore = 0.6;
      else if (nearbyPhotos.length >= 1) temporalScore = 0.3;

      // 4b. Vendor specialization
      const vendorScore = getVendorScore(tx.vendor_name);

      // 4c. Amount pattern
      const amountScore = getAmountScore(amount);

      // 4d. Photo evidence score (proximity-weighted)
      let photoScore = 0;
      if (nearbyPhotos.length > 0) {
        // Weight photos closer to transaction date more heavily
        const weights = nearbyPhotos.map((p) => {
          const daysDiff = Math.abs(
            (p.date.getTime() - txDate.getTime()) / 86400000
          );
          return Math.max(0, 1 - daysDiff / 30);
        });
        photoScore = Math.min(
          1,
          weights.reduce((s, w) => s + w, 0) / 10
        );
      }

      // 4e. Manifest device correlation
      const correlatedDeviceIds: string[] = [];
      if (tx.vendor_name) {
        const vendorLower = tx.vendor_name.toLowerCase();
        for (const dev of (devices || [])) {
          const supplier = (dev.supplier || "").toLowerCase();
          const mfg = (dev.manufacturer || "").toLowerCase();
          if (
            (supplier && vendorLower.includes(supplier)) ||
            (mfg && mfg.length > 4 && vendorLower.includes(mfg))
          ) {
            correlatedDeviceIds.push(dev.id);
          }
        }
      }

      // 5. Composite enhanced confidence
      // Weights: original confidence 30%, vendor 25%, temporal 20%, amount 15%, photo 10%
      const enhanced = Math.min(1, Math.round((
        (tx.confidence || 0) * 0.30 +
        vendorScore * 0.25 +
        temporalScore * 0.20 +
        amountScore * 0.15 +
        photoScore * 0.10
      ) * 1000) / 1000);

      updates.push({
        id: tx.id,
        enhanced_confidence: enhanced,
        temporal_correlation_score: Math.round(temporalScore * 1000) / 1000,
        photo_evidence_score: Math.round(photoScore * 1000) / 1000,
        correlated_photo_ids: correlatedPhotoIds,
        correlated_manifest_device_ids: correlatedDeviceIds,
        enhanced_at: new Date().toISOString(),
      });
    }

    // 6. Apply updates in batches
    let applied = 0;
    const BATCH = 50;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      for (const u of batch) {
        const { error: upErr } = await sb
          .from("qb_transactions")
          .update({
            enhanced_confidence: u.enhanced_confidence,
            temporal_correlation_score: u.temporal_correlation_score,
            photo_evidence_score: u.photo_evidence_score,
            correlated_photo_ids: u.correlated_photo_ids,
            correlated_manifest_device_ids: u.correlated_manifest_device_ids,
            enhanced_at: u.enhanced_at,
          })
          .eq("id", u.id);
        if (upErr) {
          console.error(`Update failed for ${u.id}: ${upErr.message}`);
        } else {
          applied++;
        }
      }
    }

    // 7. Stats
    const avgEnhanced =
      updates.reduce((s, u) => s + u.enhanced_confidence, 0) / (updates.length || 1);
    const highConf = updates.filter((u) => u.enhanced_confidence >= 0.7).length;
    const medConf = updates.filter(
      (u) => u.enhanced_confidence >= 0.4 && u.enhanced_confidence < 0.7
    ).length;
    const lowConf = updates.filter((u) => u.enhanced_confidence < 0.4).length;
    const withPhotos = updates.filter(
      (u) => u.correlated_photo_ids.length > 0
    ).length;
    const withDevices = updates.filter(
      (u) => u.correlated_manifest_device_ids.length > 0
    ).length;

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        transactions_enhanced: applied,
        confidence_distribution: { high: highConf, medium: medConf, low: lowConf },
        average_enhanced_confidence: Math.round(avgEnhanced * 1000) / 1000,
        with_photo_correlation: withPhotos,
        with_device_correlation: withDevices,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

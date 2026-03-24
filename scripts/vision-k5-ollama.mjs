#!/usr/bin/env node
/**
 * K5 Blazer Vision Analysis — Local Ollama (FREE)
 *
 * Uses qwen2.5vl:7b locally for zone classification, component identification,
 * and condition assessment of K5 build photos. Zero cost, no rate limits.
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-k5-ollama.mjs                    # 20 images
 *   dotenvx run -- node scripts/vision-k5-ollama.mjs --batch-size 100   # 100 images
 *   dotenvx run -- node scripts/vision-k5-ollama.mjs --all              # all pending
 */

import { createClient } from "@supabase/supabase-js";

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const OLLAMA_URL = "http://localhost:11434";
const MODEL = "qwen2.5vl:7b";
const MAX_IMAGE_BYTES = 500_000; // Resize images > 500KB to prevent OOM

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing env"); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const bsIdx = args.indexOf("--batch-size");
const BATCH_SIZE = ALL ? 9999 : (bsIdx >= 0 ? parseInt(args[bsIdx + 1]) : 20);

const VISION_PROMPT = `You are an expert automotive photographer and vehicle appraiser analyzing a build-in-progress photo of a 1977 Chevrolet K5 Blazer restomod with LS swap and MoTeC engine management.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "zone": "engine_bay|exterior_front|exterior_rear|exterior_side|interior_dash|interior_seats|undercarriage|wheel_tire|detail_closeup|wiring|fabrication|part_closeup|document|shop_environment|other",
  "sub_zone": "more specific area within the zone",
  "build_stage": "disassembly|bare_chassis|fabrication|paint_body|mechanical_install|electrical_wiring|interior_assembly|final_assembly|testing|completed|documentation",
  "visible_components": ["list every identifiable part, brand, or component visible"],
  "condition_notes": "what condition or progress state is shown",
  "modification_type": "stock|mild|moderate|extensive|ground_up",
  "quality_indicators": "craftsmanship observations — weld quality, wire routing, paint quality, fitment",
  "is_before_after": false,
  "contains_people": false,
  "contains_text": "any readable text, labels, part numbers, brands visible",
  "photo_quality": "professional|good|adequate|poor|screenshot",
  "confidence": 0.0-1.0
}`;

async function analyzeImage(imageUrl) {
  // Download image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return { error: `Image fetch failed: ${imgRes.status}` };
  let buf = Buffer.from(await imgRes.arrayBuffer());

  // Resize if too large (prevents Ollama OOM on 7B model)
  if (buf.length > MAX_IMAGE_BYTES) {
    try {
      const { execSync } = await import("child_process");
      const tmpIn = `/tmp/k5-vision-in-${Date.now()}.jpg`;
      const tmpOut = `/tmp/k5-vision-out-${Date.now()}.jpg`;
      const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
      writeFileSync(tmpIn, buf);
      execSync(`sips -Z 800 "${tmpIn}" --out "${tmpOut}" 2>/dev/null`);
      buf = readFileSync(tmpOut);
      try { unlinkSync(tmpIn); unlinkSync(tmpOut); } catch {}
    } catch { /* sips failed, use original */ }
  }
  const base64 = buf.toString("base64");

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: VISION_PROMPT,
      images: [base64],
      stream: false,
      options: { temperature: 0.1, num_predict: 800 },
    }),
  });

  if (!res.ok) return { error: `Ollama error: ${res.status}` };
  const data = await res.json();
  const text = data.response || "";

  // Try to parse JSON from response
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { error: "No JSON in response", raw: text.slice(0, 300) };
  } catch {
    return { error: "JSON parse failed", raw: text.slice(0, 300) };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log(`K5 Blazer Vision — Ollama ${MODEL} (FREE, local)`);
  console.log(`Batch: ${ALL ? "ALL" : BATCH_SIZE}`);
  console.log("=".repeat(70));

  // Check Ollama is running
  try {
    const health = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!health.ok) throw new Error("Ollama not responding");
    const tags = await health.json();
    const hasModel = tags.models?.some(m => m.name?.startsWith("qwen2.5vl"));
    if (!hasModel) { console.error("qwen2.5vl not loaded. Run: ollama pull qwen2.5vl:7b"); process.exit(1); }
    console.log("Ollama OK, model loaded");
  } catch (e) {
    console.error("Ollama not running:", e.message);
    process.exit(1);
  }

  // Get pending images
  const { data: images, error } = await sb
    .from("vehicle_images")
    .select("id, image_url, storage_path, file_name")
    .eq("vehicle_id", VEHICLE_ID)
    .eq("ai_processing_status", "pending")
    .order("created_at")
    .limit(BATCH_SIZE);

  if (error) { console.error("DB error:", error); process.exit(1); }
  console.log(`Pending images: ${images.length}\n`);

  let ok = 0, fail = 0;
  const startTime = Date.now();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const url = img.image_url || `${SUPABASE_URL}/storage/v1/object/public/vehicle-photos/${img.storage_path}`;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = ok > 0 ? (ok / ((Date.now() - startTime) / 60000)).toFixed(1) : "—";

    process.stdout.write(`[${i + 1}/${images.length}] ${(img.file_name || img.id).slice(0, 30).padEnd(30)} `);

    // Mark processing
    await sb.from("vehicle_images").update({ ai_processing_status: "processing" }).eq("id", img.id);

    const result = await analyzeImage(url);

    if (result.error) {
      console.log(`FAIL: ${result.error}`);
      await sb.from("vehicle_images").update({
        ai_processing_status: "failed",
        ai_scan_metadata: { ...result, pipeline: "ollama_qwen2.5vl", processed_at: new Date().toISOString() },
      }).eq("id", img.id);
      fail++;
    } else {
      console.log(`${result.zone || "?"} | ${(result.visible_components || []).slice(0, 3).join(", ")} | ${elapsed}s (${rate}/min)`);
      await sb.from("vehicle_images").update({
        ai_processing_status: "completed",
        organization_status: "organized",
        ai_scan_metadata: {
          ...result,
          pipeline: "ollama_qwen2.5vl",
          pipeline_version: "v3_local",
          processed_at: new Date().toISOString(),
          vehicle_zone: result.zone,
          build_stage: result.build_stage,
        },
      }).eq("id", img.id);
      ok++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Done: ${ok} analyzed, ${fail} failed in ${totalTime}s (${(ok / (totalTime / 60)).toFixed(1)}/min)`);
  console.log("=".repeat(70));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

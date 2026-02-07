import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (d: any, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// 100-point rubric: Exterior 30, Interior 20, Mechanical 20, Documentation 15, Presentation 15
const RUBRIC: Record<string, Record<string, number>> = {
  exterior: { paint_quality: 8, body_panels: 8, trim_chrome: 5, glass: 4, wheels_tires: 5 },
  interior: { seats: 6, dashboard: 4, carpets: 3, headliner: 3, controls: 4 },
  mechanical: { engine_bay: 6, fluid_leaks: 5, belts_hoses: 4, underbody: 5 },
  documentation: { vin_visible: 4, service_records: 4, original_manuals: 4, build_sheet: 3 },
  presentation: { photo_quality: 5, coverage_completeness: 5, staging: 5 },
};

const PROMPT = `You are a professional vehicle condition appraiser. Score ONLY categories clearly visible in THIS image.

RUBRIC (100 pts total):
EXTERIOR (30): paint_quality(0-8) surface/clearcoat/oxidation, body_panels(0-8) dents/rust/alignment, trim_chrome(0-5) trim/emblems/weatherstrip, glass(0-4) chips/cracks/hazing, wheels_tires(0-5) finish/tread/curb rash
INTERIOR (20): seats(0-6) tears/wear/bolsters, dashboard(0-4) cracks/fading/gauges, carpets(0-3) stains/wear, headliner(0-3) sag/stains, controls(0-4) switches/knobs/steering
MECHANICAL (20): engine_bay(0-6) cleanliness/components, fluid_leaks(0-5) oil/coolant stains, belts_hoses(0-4) cracking/swelling, underbody(0-5) frame/rust/exhaust
DOCUMENTATION (15): vin_visible(0-4) legible/unaltered, service_records(0-4) maintenance evidence, original_manuals(0-4) manual/toolkit/key, build_sheet(0-3) build sheet/SPID/sticker
PRESENTATION (15): photo_quality(0-5) focus/lighting, coverage_completeness(0-5) useful detail shown, staging(0-5) cleanliness/background

Use null for categories NOT visible. Return ONLY valid JSON:
{"visible_categories":{"exterior":{"paint_quality":{"score":N,"max":8,"notes":""},...},"interior":{...},"mechanical":{...},"documentation":{...},"presentation":{...}},"concerns":["red flags"],"image_summary":"one sentence"}`;

interface Sub { score: number | null; max: number; notes: string }
interface ImageResult { image_id: string; image_url: string; scores: Record<string, Record<string, Sub>>; concerns: string[]; image_summary: string; error?: string }

function aggregate(results: ImageResult[]) {
  const collected: Record<string, number[]> = {};
  for (const cat of Object.keys(RUBRIC)) for (const sub of Object.keys(RUBRIC[cat])) collected[`${cat}.${sub}`] = [];

  for (const r of results) {
    if (r.error || !r.scores) continue;
    for (const cat of Object.keys(RUBRIC)) {
      if (!r.scores[cat]) continue;
      for (const sub of Object.keys(RUBRIC[cat])) {
        const v = r.scores[cat]?.[sub]?.score;
        if (typeof v === "number") collected[`${cat}.${sub}`].push(v);
      }
    }
  }

  const finals: Record<string, { score: number; max: number; n: number; ok: boolean }> = {};
  let total = 0, assessedMax = 0, assessedN = 0, totalN = 0;
  const catScore: Record<string, number> = {}, catAssessedMax: Record<string, number> = {};
  for (const c of Object.keys(RUBRIC)) { catScore[c] = 0; catAssessedMax[c] = 0; }

  for (const cat of Object.keys(RUBRIC)) {
    for (const sub of Object.keys(RUBRIC[cat])) {
      const key = `${cat}.${sub}`, max = RUBRIC[cat][sub], arr = collected[key];
      totalN++;
      if (arr.length === 0) { finals[key] = { score: 0, max, n: 0, ok: false }; continue; }
      arr.sort((a, b) => a - b);
      const mid = Math.floor(arr.length / 2);
      const med = arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
      const sc = Math.min(Math.max(0, Math.round(med * 10) / 10), max);
      finals[key] = { score: sc, max, n: arr.length, ok: true };
      total += sc; assessedMax += max; assessedN++;
      catScore[cat] += sc; catAssessedMax[cat] += max;
    }
  }

  const scaled = assessedMax > 0 ? Math.round((total / assessedMax) * 100) : 0;
  const rate = (cat: string, maxPts: number) => catAssessedMax[cat] > 0 ? Math.round((catScore[cat] / catAssessedMax[cat]) * maxPts) : 0;

  // undercarriage_rating maps to underbody + documentation (using the DB column we have)
  const ubScore = (finals["mechanical.underbody"]?.ok ? finals["mechanical.underbody"].score : 0) + catScore.documentation;
  const ubMax = (finals["mechanical.underbody"]?.ok ? finals["mechanical.underbody"].max : 0) + catAssessedMax.documentation;
  const ubRating = ubMax > 0 ? Math.round((ubScore / ubMax) * 15) : 0;

  const concerns = [...new Set(results.flatMap(r => r.concerns || []))].slice(0, 20);
  const gaps = Object.entries(finals).filter(([, v]) => !v.ok).map(([k]) => k);

  return {
    overall: scaled, exterior: rate("exterior", 30), interior: rate("interior", 20),
    mechanical: rate("mechanical", 20), undercarriage: ubRating,
    multiplier: Math.round((0.5 + (scaled / 100)) * 100) / 100,
    completeness: Math.round((assessedN / totalN) * 100),
    subcategories: finals, concerns, coverage_gaps: gaps,
    images_scored: results.filter(r => !r.error).length,
    images_failed: results.filter(r => r.error).length,
  };
}

async function scoreImage(url: string, id: string, key: string): Promise<ImageResult> {
  const fail = (e: string): ImageResult => ({ image_id: id, image_url: url, scores: {}, concerns: [], image_summary: "", error: e });
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 1500,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url } }, { type: "text", text: PROMPT }] }] }),
    });
    if (!resp.ok) { const t = await resp.text(); console.error(`[score] ${id} API ${resp.status}:`, t.slice(0, 200)); return fail(`API ${resp.status}`); }
    const text = (await resp.json()).content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fail("No JSON");
    const p = JSON.parse(m[0]);
    return { image_id: id, image_url: url, scores: p.visible_categories || {}, concerns: p.concerns || [], image_summary: p.image_summary || "" };
  } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
}

async function scoreVehicle(vehicleId: string, sb: any, key: string) {
  const t0 = Date.now();
  const { data: imgs, error: ie } = await sb.from("vehicle_images").select("id, image_url")
    .eq("vehicle_id", vehicleId).not("image_url", "is", null)
    .order("is_primary", { ascending: false }).order("position", { ascending: true }).limit(20);
  if (ie || !imgs?.length) return { vehicle_id: vehicleId, error: ie?.message || "No images", images_found: 0 };
  const valid = imgs.filter((i: any) => i.image_url?.startsWith("http"));
  if (!valid.length) return { vehicle_id: vehicleId, error: "No valid URLs", images_found: imgs.length };

  console.log(`[score] ${valid.length} images for ${vehicleId}`);
  const results: ImageResult[] = [];
  for (let i = 0; i < valid.length; i += 5) {
    const batch = valid.slice(i, i + 5);
    results.push(...await Promise.all(batch.map((m: any) => scoreImage(m.image_url, m.id, key))));
  }

  const agg = aggregate(results);

  // Upsert condition assessment
  const { error: ue } = await sb.from("vehicle_condition_assessments").upsert({
    vehicle_id: vehicleId, assessment_date: new Date().toISOString(),
    overall_condition_rating: agg.overall, exterior_rating: agg.exterior,
    interior_rating: agg.interior, mechanical_rating: agg.mechanical,
    undercarriage_rating: agg.undercarriage, condition_value_multiplier: agg.multiplier,
    images_assessed: valid.map((i: any) => i.id), assessment_completeness: agg.completeness,
    assessed_by_model: "claude-3-5-haiku-latest", human_verified: false,
  }, { onConflict: "vehicle_id", ignoreDuplicates: false });
  if (ue) console.error("[score] Assessment upsert error:", ue);

  // Write component conditions (best effort)
  let compWritten = 0;
  try {
    const rows: any[] = [];
    for (const r of results) {
      if (r.error || !r.scores) continue;
      for (const [cat, subs] of Object.entries(r.scores)) {
        if (!subs || typeof subs !== "object") continue;
        for (const [sub, val] of Object.entries(subs as Record<string, Sub>)) {
          if (!val || val.score == null) continue;
          rows.push({
            vehicle_id: vehicleId, image_id: r.image_id, component_name: sub, component_type: cat,
            condition_rating: Math.max(1, Math.round(val.score)), damage_types: r.concerns?.length ? r.concerns : [],
            needs_attention: val.score < val.max * 0.5,
            repair_priority: val.score < val.max * 0.3 ? "high" : val.score < val.max * 0.6 ? "medium" : "low",
            detected_by_model: "claude-3-5-haiku-latest", confidence: 75,
          });
        }
      }
    }
    for (let i = 0; i < rows.length; i += 50) {
      const { error: ce, data: cd } = await sb.from("component_conditions").insert(rows.slice(i, i + 50)).select("id");
      if (ce) console.warn("[score] component insert:", JSON.stringify(ce));
      else compWritten += cd?.length || 0;
    }
  } catch (e) { console.warn("[score] component write failed:", e); }

  // Write paint assessments (best effort)
  let paintWritten = 0;
  try {
    const rows: any[] = [];
    for (const r of results) {
      if (!r.scores?.exterior) continue;
      const pq = r.scores.exterior.paint_quality;
      if (!pq || pq.score == null) continue;
      const n = (pq.notes || "").toLowerCase();
      rows.push({
        vehicle_id: vehicleId, image_id: r.image_id,
        panel_name: (r.image_summary || "unknown").slice(0, 100),
        appears_original: !n.includes("repaint") && !n.includes("respray"),
        repaint_quality: n.includes("repaint") ? (pq.score >= 6 ? "excellent" : pq.score >= 4 ? "good" : "poor") : null,
        orange_peel_level: n.includes("orange peel") ? "visible" : n.includes("smooth") ? "minimal" : null,
        defects: (r.concerns || []).filter(c => /paint|clear|fade|chip|scratch/i.test(c)),
        paint_quality_score: Math.round(pq.score), assessed_by_model: "claude-3-5-haiku-latest",
      });
    }
    if (rows.length) {
      const { error: pe, data: pd } = await sb.from("paint_quality_assessments").insert(rows).select("id");
      if (pe) console.warn("[score] paint insert:", pe.message);
      else paintWritten = pd?.length || 0;
    }
  } catch (e) { console.warn("[score] paint write failed:", e); }

  const dur = Math.round((Date.now() - t0) / 100) / 10;
  return {
    vehicle_id: vehicleId, overall_score: agg.overall, exterior_rating: agg.exterior,
    interior_rating: agg.interior, mechanical_rating: agg.mechanical, undercarriage_rating: agg.undercarriage,
    condition_value_multiplier: agg.multiplier, completeness: agg.completeness,
    images_scored: agg.images_scored, images_failed: agg.images_failed,
    components_written: compWritten, paint_assessments_written: paintWritten,
    coverage_gaps: agg.coverage_gaps, concerns: agg.concerns, duration_seconds: dur,
    subcategories: agg.subcategories,
    per_image: results.map(r => ({ image_id: r.image_id, summary: r.image_summary, concerns: r.concerns, error: r.error || null })),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, detectSessionInUrl: false } });
    const key = Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("NUKE_CLAUDE_API") ?? "";
    if (!key) return json({ error: "No ANTHROPIC_API_KEY configured" }, 500);

    const body = await req.json();

    // Single vehicle mode
    if (body.vehicle_id) return json(await scoreVehicle(body.vehicle_id, sb, key));

    // Batch mode: find unscored vehicles with images
    const limit = Math.min(body.batch_size || 5, 20);
    let vids: string[] = [];

    // Try RPC first, fallback to manual query
    const { data: cands, error: ce } = await sb.rpc("get_unscored_vehicles", { lim: limit });
    if (!ce && cands?.length) { vids = cands.map((c: any) => c.vehicle_id); }
    else {
      const { data: assessed } = await sb.from("vehicle_condition_assessments").select("vehicle_id");
      const done = new Set((assessed || []).map((a: any) => a.vehicle_id));
      const { data: wi } = await sb.from("vehicle_images").select("vehicle_id").not("image_url", "is", null).not("vehicle_id", "is", null).limit(500);
      if (wi) vids = [...new Set(wi.map((i: any) => i.vehicle_id).filter((id: string) => !done.has(id)))].slice(0, limit) as string[];
    }

    if (!vids.length) return json({ message: "No unscored vehicles with images found", vehicles_processed: 0 });

    console.log(`[score] Batch: ${vids.length} vehicles`);
    const results: any[] = [];
    for (const v of vids) results.push(await scoreVehicle(v, sb, key));
    return json({ vehicles_processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[score-vehicle-condition] Fatal:", msg);
    return json({ error: msg, success: false }, 500);
  }
});

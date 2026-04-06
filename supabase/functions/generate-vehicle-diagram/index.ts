// generate-vehicle-diagram — Vehicle-layout SVG diagram (plan view)
// Shows wires routed on the actual truck with real dimensions, trunk paths, component positions.
// Different from generate-wiring-diagram which produces WireViz connection diagrams.
//
// Request: { vehicle_id, view?: "plan"|"engine_bay", show_bulkhead?: boolean, highlight_zone?: string }
// Response: { success, diagram_url|diagram_inline, diagram_type, summary }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeWiringOverlay } from "../_shared/wiringCompute.ts";
import { renderPlanViewSvg, renderZoneDetailSvg } from "../_shared/vehicleLayout.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      vehicle_id,
      view = "plan",
      show_bulkhead = true,
      highlight_zone = null,
    } = body;

    if (!vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Load manifest ──
    const { data: devices, error: devErr } = await supabase
      .from("vehicle_build_manifest")
      .select("*")
      .eq("vehicle_id", vehicle_id)
      .order("device_category");

    if (devErr) throw devErr;
    if (!devices || devices.length === 0) {
      return new Response(JSON.stringify({ error: "No devices in build manifest", vehicle_id }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. If show_bulkhead is false, filter out bulkhead devices from computation ──
    const effectiveDevices = show_bulkhead
      ? devices
      : devices.filter((d: any) => d.signal_type !== 'bulkhead_passthrough');

    // ── 3. Compute wiring overlay ──
    const result = computeWiringOverlay(vehicle_id, effectiveDevices);

    // ── 4. Generate SVG ──
    let svg: string;
    let diagramType: string;

    if (view === "plan" || view === "vehicle") {
      svg = renderPlanViewSvg(effectiveDevices, result, {
        showBulkhead: show_bulkhead,
        highlightZone: highlight_zone,
      });
      diagramType = "plan_view";
    } else {
      // Zone detail view (engine_bay, dash, rear, etc.)
      svg = renderZoneDetailSvg(view, effectiveDevices, result);
      diagramType = `zone_${view}`;
    }

    // ── 5. Store in Supabase storage ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const storagePath = `wiring-diagrams/${vehicle_id}/${diagramType}_${timestamp}.svg`;
    const svgBytes = new TextEncoder().encode(svg);

    const { error: uploadErr } = await supabase.storage
      .from("vehicle-data")
      .upload(storagePath, svgBytes, { contentType: "image/svg+xml", upsert: false });

    const summary = {
      total_devices: result.summary.total_devices,
      total_wires: result.summary.total_wires,
      total_wire_length_ft: result.summary.total_wire_length_ft,
      total_continuous_amps: result.summary.total_continuous_amps,
      ecu: result.ecu.model,
      pdm: result.pdm.model,
      pdm_channels_used: result.pdm.channels_used,
      alternator: `${result.alternator.amps}A`,
      bulkhead: result.bulkhead,
      warnings: result.warnings,
      available_zones: result.available_zones,
    };

    if (uploadErr) {
      // Return SVG inline if storage fails
      const diagramBase64 = btoa(String.fromCharCode(...svgBytes));
      return new Response(JSON.stringify({
        success: true,
        diagram_inline: true,
        diagram_base64: diagramBase64,
        diagram_content_type: "image/svg+xml",
        diagram_type: diagramType,
        storage_error: uploadErr.message,
        summary,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from("vehicle-data").getPublicUrl(storagePath);

    // ── 6. Return URL + summary ──
    return new Response(JSON.stringify({
      success: true,
      diagram_url: urlData.publicUrl,
      diagram_type: diagramType,
      summary,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

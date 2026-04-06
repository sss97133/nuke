// generate-wiring-diagram
// Pipeline: load manifest → compute overlay → generate WireViz YAML → POST Kroki.io → store SVG/PNG → return URL + summary
// This is the missing piece for agentic wiring design: agent writes to manifest, calls this, gets diagram URL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeWiringOverlay } from "../_shared/wiringCompute.ts";
import { generateSystemOverviewYaml, generateZoneYaml, groupByZone } from "../_shared/wirevizYaml.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { vehicle_id, zone, format = "svg" } = body;

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

    // ── 2. Compute overlay ──
    const result = computeWiringOverlay(vehicle_id, devices);

    // ── 3. Generate WireViz YAML ──
    let yaml: string;
    let diagramType: string;

    if (zone) {
      const zones = groupByZone(devices);
      const zoneDevices = zones.get(zone);
      if (!zoneDevices || zoneDevices.length === 0) {
        return new Response(JSON.stringify({
          error: `Zone '${zone}' not found`,
          available_zones: result.available_zones,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      yaml = generateZoneYaml(zone, zoneDevices, result.wires);
      diagramType = zone;
      if (!yaml) {
        return new Response(JSON.stringify({
          error: `Zone '${zone}' has no wired devices`,
          available_zones: result.available_zones,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      yaml = generateSystemOverviewYaml(devices, result);
      diagramType = "system_overview";
    }

    // ── 4. POST to Kroki.io ──
    const krokiFormat = format === "png" ? "png" : "svg";
    const krokiUrl = `https://kroki.io/wireviz/${krokiFormat}`;

    let diagramData: ArrayBuffer;
    try {
      const krokiResp = await fetch(krokiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: yaml,
      });
      if (!krokiResp.ok) {
        const errText = await krokiResp.text();
        return new Response(JSON.stringify({
          error: `Kroki render failed: ${krokiResp.status}`,
          kroki_error: errText,
          yaml_preview: yaml.substring(0, 2000),
          summary: result.summary,
        }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      diagramData = await krokiResp.arrayBuffer();
    } catch (fetchErr) {
      return new Response(JSON.stringify({
        error: `Kroki unreachable: ${String(fetchErr)}`,
        yaml_preview: yaml.substring(0, 2000),
        summary: result.summary,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Store in Supabase storage ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const ext = krokiFormat;
    const contentType = krokiFormat === "svg" ? "image/svg+xml" : "image/png";
    const storagePath = `wiring-diagrams/${vehicle_id}/${diagramType}_${timestamp}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("vehicle-data")
      .upload(storagePath, diagramData, {
        contentType,
        upsert: false,
      });

    let diagramUrl: string;
    if (uploadErr) {
      // If storage fails (bucket doesn't exist, etc.), return the diagram inline
      const diagramBase64 = btoa(String.fromCharCode(...new Uint8Array(diagramData)));
      return new Response(JSON.stringify({
        success: true,
        diagram_inline: true,
        diagram_base64: diagramBase64,
        diagram_content_type: contentType,
        diagram_type: diagramType,
        storage_error: uploadErr.message,
        summary: {
          total_devices: result.summary.total_devices,
          total_wires: result.summary.total_wires,
          total_wire_length_ft: result.summary.total_wire_length_ft,
          total_continuous_amps: result.summary.total_continuous_amps,
          ecu: result.ecu.model,
          pdm: result.pdm.model,
          pdm_channels_used: result.pdm.channels_used,
          alternator: `${result.alternator.amps}A`,
          warnings: result.warnings,
          available_zones: result.available_zones,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from("vehicle-data").getPublicUrl(storagePath);
    diagramUrl = urlData.publicUrl;

    // ── 6. Return URL + summary ──
    return new Response(JSON.stringify({
      success: true,
      diagram_url: diagramUrl,
      diagram_type: diagramType,
      summary: {
        total_devices: result.summary.total_devices,
        total_wires: result.summary.total_wires,
        total_wire_length_ft: result.summary.total_wire_length_ft,
        total_continuous_amps: result.summary.total_continuous_amps,
        ecu: result.ecu.model,
        pdm: result.pdm.model,
        pdm_channels_used: result.pdm.channels_used,
        alternator: `${result.alternator.amps}A`,
        warnings: result.warnings,
        available_zones: result.available_zones,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

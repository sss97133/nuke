// compute-wiring-overlay
// Given a vehicle_id, computes the complete wiring specification.
// Delegates all computation to _shared/wiringCompute.ts.
// This handler: loads DB data, calls shared compute, upserts result, loads ECU pin maps.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeWiringOverlay, computeECUOptions } from "../_shared/wiringCompute.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { vehicle_id, action = "compute" } = body;

    if (!vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load all devices from build manifest ──
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

    // ── Compute overlay via shared engine ──
    const computed = computeWiringOverlay(vehicle_id, devices);

    // ── Load ECU pin maps for pin-level assignment ──
    const { data: ecuPins } = await supabase.from("device_pin_maps")
      .select("pin_number, pin_function, signal_type, connector_name, max_current_amps, default_wire_gauge_awg")
      .eq("device_model", computed.ecu.model)
      .order("connector_name").order("pin_number");

    const ecuOptions = computeECUOptions(computed.io_requirements);

    // Build pin assignment map
    const pins = ecuPins || [];
    const injectorPins = pins.filter(p => p.signal_type === 'injector_output').sort((a, b) => {
      return (parseInt(a.pin_function.replace(/\D/g, '')) || 0) - (parseInt(b.pin_function.replace(/\D/g, '')) || 0);
    });
    const ignitionPins = pins.filter(p => p.signal_type === 'ignition_output').sort((a, b) => {
      return (parseInt(a.pin_function.replace(/\D/g, '')) || 0) - (parseInt(b.pin_function.replace(/\D/g, '')) || 0);
    });
    const crankPin = pins.find(p => p.pin_function === 'UDIG1');
    const camPin = pins.find(p => p.pin_function === 'UDIG2');
    const knockPins = pins.filter(p => p.signal_type === 'knock_input');
    const analogPins = pins.filter(p => p.signal_type === 'analog_voltage_input');
    const tempPins = pins.filter(p => p.signal_type === 'analog_temp_input');

    let injIdx = 0, ignIdx = 0, knkIdx = 0, avIdx = 0, atIdx = 0;

    // deno-lint-ignore no-explicit-any
    function getECUPinRef(device: any): string {
      const name = device.device_name || '';
      if (name.startsWith('Fuel Injector') && injIdx < injectorPins.length) {
        return `${computed.ecu.model}:${injectorPins[injIdx++].pin_number}`;
      }
      if (name.startsWith('Ignition Coil') && ignIdx < ignitionPins.length) {
        return `${computed.ecu.model}:${ignitionPins[ignIdx++].pin_number}`;
      }
      if (name.includes('Crank') && crankPin) return `${computed.ecu.model}:${crankPin.pin_number}`;
      if (name.includes('Cam') && camPin) return `${computed.ecu.model}:${camPin.pin_number}`;
      if (name.includes('Knock') && knkIdx < knockPins.length) {
        return `${computed.ecu.model}:${knockPins[knkIdx++].pin_number}`;
      }
      if (device.signal_type === 'analog_temp' && atIdx < tempPins.length) {
        return `${computed.ecu.model}:${tempPins[atIdx++].pin_number}`;
      }
      if (device.signal_type === 'analog_5v' && avIdx < analogPins.length) {
        return `${computed.ecu.model}:${analogPins[avIdx++].pin_number}`;
      }
      return 'ECU';
    }

    // Enrich wire list with ECU pin references
    for (const wire of computed.wires) {
      if (wire.fromDevice === 'ECU') {
        const device = devices.find((d: any) => d.device_name === wire.toDevice);
        if (device) {
          wire.fromDevice = getECUPinRef(device);
        }
      }
    }

    // Build result matching original format
    const result = {
      vehicle_id,
      computed_at: computed.computed_at,
      summary: computed.summary,
      ecu: computed.ecu,
      ecu_options: ecuOptions,
      alternator: computed.alternator,
      pdm: computed.pdm,
      io_requirements: computed.io_requirements,
      wires: action === 'summary' ? undefined : computed.wires,
      warnings: computed.warnings,
    };

    // ── Update the overlay record ──
    await supabase.from("vehicle_wiring_overlays").upsert({
      vehicle_id,
      factory_generation: 'squarebody_1973_1987',
      total_circuits: computed.wires.length,
      total_wire_length_ft: computed.summary.total_wire_length_ft,
      estimated_hours: Math.round(computed.wires.length * 0.5),
      status: 'planning',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vehicle_id' });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

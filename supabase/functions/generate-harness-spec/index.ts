// generate-harness-spec — Complete harness fabrication document
// Produces the spec package a builder or illustrator needs:
//   1. Wire schedule (every wire, pin-to-pin, gauge, color, length, routing)
//   2. ECU pin assignment table (M130 Connector A + B)
//   3. PDM channel assignment table (30 channels)
//   4. Bulkhead pin assignment table (61-pin milspec)
//   5. Component table (every device, zone, connector, amps)
//   6. Trunk routing summary (which wires bundle together)
//   7. Power budget (total draw, alternator sizing, voltage drop flags)
//   8. Physical notes (zone measurements, trunk path lengths)
//
// Output: JSON with structured tables + a "text" field with formatted plaintext spec

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeWiringOverlay } from "../_shared/wiringCompute.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { vehicle_id, format = "full" } = body; // format: "full" | "wire_schedule" | "text"

    if (!vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load manifest ──
    const { data: devices, error: devErr } = await supabase
      .from("vehicle_build_manifest")
      .select("*")
      .eq("vehicle_id", vehicle_id)
      .order("device_category, device_name");

    if (devErr) throw devErr;
    if (!devices || devices.length === 0) {
      return new Response(JSON.stringify({ error: "No devices in build manifest", vehicle_id }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Compute overlay ──
    const computed = computeWiringOverlay(vehicle_id, devices);

    // ── Load ECU pin maps ──
    const { data: ecuPins } = await supabase.from("device_pin_maps")
      .select("pin_number, pin_function, signal_type, connector_name, max_current_amps, default_wire_gauge_awg")
      .eq("device_model", computed.ecu.model)
      .order("connector_name, pin_number");

    const pins = ecuPins || [];

    // ── Build ECU pin assignments ──
    // Match each wire to its actual ECU pin
    const injPins = pins.filter(p => p.signal_type === 'injector_output').sort((a, b) => a.pin_number.localeCompare(b.pin_number));
    const ignPins = pins.filter(p => p.signal_type === 'ignition_output').sort((a, b) => a.pin_number.localeCompare(b.pin_number));
    const crankPin = pins.find(p => p.pin_function === 'UDIG1');
    const camPin = pins.find(p => p.pin_function === 'UDIG2');
    const knockPins = pins.filter(p => p.signal_type === 'knock_input');
    const avPins = pins.filter(p => p.signal_type === 'analog_voltage_input');
    const atPins = pins.filter(p => p.signal_type === 'analog_temp_input');
    const hbPins = pins.filter(p => p.signal_type === 'half_bridge_output');
    const canPins = pins.filter(p => p.signal_type === 'can_bus');

    let injIdx = 0, ignIdx = 0, knkIdx = 0, avIdx = 0, atIdx = 0, hbIdx = 0;

    // deno-lint-ignore no-explicit-any
    function resolveECUPin(device: any): { pin: string; function: string; connector: string } | null {
      const name = device.device_name || '';
      const sig = device.signal_type || '';
      if (name.startsWith('Fuel Injector') && injIdx < injPins.length) {
        const p = injPins[injIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if (name.startsWith('Ignition Coil') && ignIdx < ignPins.length) {
        const p = ignPins[ignIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if (name.includes('Crank') && crankPin) return { pin: crankPin.pin_number, function: crankPin.pin_function, connector: crankPin.connector_name };
      if (name.includes('Cam') && camPin) return { pin: camPin.pin_number, function: camPin.pin_function, connector: camPin.connector_name };
      if (sig === 'piezoelectric' && knkIdx < knockPins.length) {
        const p = knockPins[knkIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if (sig === 'analog_temp' && atIdx < atPins.length) {
        const p = atPins[atIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if (sig === 'analog_5v' && avIdx < avPins.length) {
        const p = avPins[avIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if (sig === 'h_bridge_motor' && hbIdx < hbPins.length) {
        const p = hbPins[hbIdx++];
        return { pin: p.pin_number, function: p.pin_function, connector: p.connector_name };
      }
      if ((sig === 'can_bus' || sig === 'can_display') && canPins.length > 0) {
        return { pin: canPins[0].pin_number, function: 'CAN_H/CAN_L', connector: canPins[0].connector_name };
      }
      return null;
    }

    // ══════════════════════════════════════════════════════════════════
    // TABLE 1: WIRE SCHEDULE
    // ══════════════════════════════════════════════════════════════════

    interface WireRow {
      wire_num: number;
      from_device: string;
      from_zone: string;
      from_pin: string;
      to_device: string;
      to_zone: string;
      to_connector: string;
      gauge_awg: number;
      color: string;
      length_ft: number;
      fuse_amps: number | null;
      shielded: boolean;
      twisted_pair: boolean;
      signal_type: string;
      voltage_drop_pct: number;
      pdm_channel: number | null;
      bulkhead_pin: number | null;
      through_bulkhead: boolean;
    }

    const wireSchedule: WireRow[] = [];
    // Reset pin counters for wire schedule pass
    injIdx = 0; ignIdx = 0; knkIdx = 0; avIdx = 0; atIdx = 0; hbIdx = 0;

    for (const wire of computed.wires) {
      const dev = devices.find((dd: any) => dd.device_name === wire.toDevice);
      const ecuPin = dev ? resolveECUPin(dev) : null;

      let fromPin = wire.fromDevice;
      if (ecuPin && !wire.fromDevice.startsWith('PDM')) {
        fromPin = `${computed.ecu.model}:${ecuPin.connector}:${ecuPin.pin} (${ecuPin.function})`;
      }

      wireSchedule.push({
        wire_num: wire.wireNumber,
        from_device: wire.fromDevice.startsWith('PDM') ? 'PDM' : computed.ecu.model,
        from_zone: wire.fromLocation,
        from_pin: fromPin,
        to_device: wire.toDevice,
        to_zone: wire.toLocation,
        to_connector: dev?.connector_type || 'unknown',
        gauge_awg: wire.gauge,
        color: wire.color,
        length_ft: Math.round(wire.lengthFt * 10) / 10,
        fuse_amps: wire.fuseRating,
        shielded: wire.isShielded,
        twisted_pair: wire.isTwistedPair,
        signal_type: wire.signalType,
        voltage_drop_pct: Math.round(wire.voltageDropPct * 100) / 100,
        pdm_channel: wire.pdmChannel,
        bulkhead_pin: wire.bulkheadPin,
        through_bulkhead: wire.routesThroughBulkhead,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // TABLE 2: ECU PIN ASSIGNMENT
    // ══════════════════════════════════════════════════════════════════

    interface ECUPinRow {
      pin: string;
      connector: string;
      function: string;
      signal_type: string;
      assigned_to: string;
      wire_num: number | null;
      wire_gauge: number | null;
      wire_color: string;
      max_amps: number;
    }

    // Reset counters again
    injIdx = 0; ignIdx = 0; knkIdx = 0; avIdx = 0; atIdx = 0; hbIdx = 0;

    const ecuPinTable: ECUPinRow[] = [];
    const pinAssignments = new Map<string, { device: string; wireNum: number; gauge: number; color: string }>();

    // First pass: figure out which device goes to which pin
    for (const wire of computed.wires) {
      if (wire.fromDevice.startsWith('PDM')) continue;
      const dev = devices.find((dd: any) => dd.device_name === wire.toDevice);
      if (!dev) continue;
      const ecuPin = resolveECUPin(dev);
      if (ecuPin) {
        pinAssignments.set(ecuPin.pin, { device: wire.toDevice, wireNum: wire.wireNumber, gauge: wire.gauge, color: wire.color });
      }
    }

    for (const p of pins) {
      const assignment = pinAssignments.get(p.pin_number);
      ecuPinTable.push({
        pin: p.pin_number,
        connector: p.connector_name,
        function: p.pin_function,
        signal_type: p.signal_type,
        assigned_to: assignment?.device || '— UNUSED —',
        wire_num: assignment?.wireNum || null,
        wire_gauge: assignment?.gauge || null,
        wire_color: assignment?.color || '',
        max_amps: parseFloat(p.max_current_amps) || 0,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // TABLE 3: PDM CHANNEL ASSIGNMENT
    // ══════════════════════════════════════════════════════════════════

    const pdmTable = computed.pdm.assignments.map(ch => {
      const wire = computed.wires.find(w => w.pdmChannel === ch.channel);
      return {
        channel: ch.channel,
        max_amps: ch.maxAmps,
        device: ch.deviceName,
        actual_amps: ch.actualAmps,
        pwm: ch.pwmCapable,
        wire_num: wire?.wireNumber || null,
        wire_gauge: wire?.gauge || null,
        wire_color: wire?.color || '',
        wire_length_ft: wire ? Math.round(wire.lengthFt * 10) / 10 : null,
      };
    });

    // ══════════════════════════════════════════════════════════════════
    // TABLE 4: BULKHEAD PIN ASSIGNMENT
    // ══════════════════════════════════════════════════════════════════

    const bulkheadTable = computed.wires
      .filter(w => w.routesThroughBulkhead && w.bulkheadPin)
      .sort((a, b) => (a.bulkheadPin || 0) - (b.bulkheadPin || 0))
      .map(w => ({
        bulkhead_pin: w.bulkheadPin,
        wire_num: w.wireNumber,
        from_device: w.fromDevice,
        from_zone: w.fromLocation,
        to_device: w.toDevice,
        to_zone: w.toLocation,
        gauge_awg: w.gauge,
        color: w.color,
        signal_type: w.signalType,
      }));

    // ══════════════════════════════════════════════════════════════════
    // TABLE 5: COMPONENT TABLE
    // ══════════════════════════════════════════════════════════════════

    // deno-lint-ignore no-explicit-any
    const componentTable = devices.map((dd: any) => ({
      device: dd.device_name,
      category: dd.device_category,
      zone: dd.location_zone,
      connector: dd.connector_type,
      pin_count: dd.pin_count,
      amps: parseFloat(dd.power_draw_amps) || 0,
      signal_type: dd.signal_type || '',
      recommended_gauge: dd.wire_gauge_recommended || null,
      notes: dd.notes || '',
    }));

    // ══════════════════════════════════════════════════════════════════
    // TABLE 6: TRUNK ROUTING SUMMARY
    // ══════════════════════════════════════════════════════════════════

    // Group wires by their from/to zone pairs to show trunk bundles
    const trunkMap = new Map<string, { wire_count: number; total_amps: number; gauges: number[]; wires: number[] }>();
    for (const w of computed.wires) {
      const key = `${w.fromLocation} → ${w.toLocation}`;
      const existing = trunkMap.get(key) || { wire_count: 0, total_amps: 0, gauges: [], wires: [] };
      existing.wire_count++;
      const dev = devices.find((dd: any) => dd.device_name === w.toDevice);
      existing.total_amps += parseFloat(dev?.power_draw_amps) || 0;
      existing.gauges.push(w.gauge);
      existing.wires.push(w.wireNumber);
      trunkMap.set(key, existing);
    }

    const trunkSummary = Array.from(trunkMap.entries()).map(([route, data]) => ({
      route,
      wire_count: data.wire_count,
      total_amps: Math.round(data.total_amps * 10) / 10,
      heaviest_gauge: Math.min(...data.gauges),
      lightest_gauge: Math.max(...data.gauges),
      through_bulkhead: route.includes('engine_bay') && (route.includes('dash') || route.includes('doors') || route.includes('rear')),
      wire_numbers: data.wires,
    })).sort((a, b) => b.wire_count - a.wire_count);

    // ══════════════════════════════════════════════════════════════════
    // TABLE 7: POWER BUDGET
    // ══════════════════════════════════════════════════════════════════

    const powerBudget = {
      total_continuous_amps: computed.summary.total_continuous_amps,
      alternator_required: computed.alternator.amps,
      alternator_recommendation: computed.alternator.recommendation,
      headroom_amps: computed.alternator.amps - computed.summary.total_continuous_amps,
      headroom_pct: Math.round(((computed.alternator.amps - computed.summary.total_continuous_amps) / computed.alternator.amps) * 100),
      voltage_drop_violations: computed.wires.filter(w => w.voltageDropPct > 3).map(w => ({
        wire_num: w.wireNumber,
        device: w.toDevice,
        drop_pct: Math.round(w.voltageDropPct * 100) / 100,
        gauge: w.gauge,
        length_ft: Math.round(w.lengthFt * 10) / 10,
      })),
      high_current_circuits: computed.wires.filter(w => {
        const dev = devices.find((dd: any) => dd.device_name === w.toDevice);
        return (parseFloat(dev?.power_draw_amps) || 0) >= 15;
      }).map(w => {
        const dev = devices.find((dd: any) => dd.device_name === w.toDevice);
        return {
          wire_num: w.wireNumber,
          device: w.toDevice,
          amps: parseFloat(dev?.power_draw_amps) || 0,
          gauge: w.gauge,
          fuse: w.fuseRating,
        };
      }).sort((a, b) => b.amps - a.amps),
    };

    // ══════════════════════════════════════════════════════════════════
    // TABLE 8: PHYSICAL DIMENSIONS / ZONE REFERENCE
    // ══════════════════════════════════════════════════════════════════

    const physicalRef = {
      vehicle: '1977 Chevrolet K5 Blazer',
      wheelbase_in: 106.5,
      overall_length_in: 184.8,
      width_in: 79.6,
      height_in: 73.7,
      frame_rail_width_in: 34,
      zones: {
        engine_bay: { description: 'Front bumper to firewall', length_in: 32, width_in: 79.6 },
        firewall: { description: 'Vertical barrier, engine bay to cabin', thickness_in: 1.5, width_in: 60 },
        dash: { description: 'Firewall to rear of front seats', length_in: 36, width_in: 60 },
        doors: { description: 'Driver and passenger doors', height_in: 36, width_in: 4 },
        rear: { description: 'Behind front seats to tailgate', length_in: 72, width_in: 60 },
        underbody: { description: 'Below floor pan, frame rails', length_in: 184.8, rail_spacing_in: 34 },
      },
      trunk_paths: {
        engine_main: 'Driver side valve cover to firewall — primary engine harness trunk',
        front_crossbar: 'Left fender to right fender across radiator support — headlights, horns, fans',
        firewall_grommets: 'H1 (driver), H2 (center), H3 (passenger), H4 (lower/trans) — 4 penetration points',
        dash_crossbar: 'Driver kick panel to passenger kick panel behind instrument panel',
        rear_trunk: 'Under center console along driver frame rail to rear — tail lights, fuel pump, backup camera',
      },
      notes: [
        'All engine↔interior wires route through Firewall Bulkhead Connector (milspec D38999/26WA98SN)',
        'ECU mounted under dash, driver side kick panel',
        'PDM mounted under dash, replaces fuse block',
        'Battery in engine bay, passenger side',
        'Star ground point on engine block, body ground under dash',
      ],
    };

    // ══════════════════════════════════════════════════════════════════
    // FORMATTED PLAINTEXT (the thing you'd hand to a fabricator)
    // ══════════════════════════════════════════════════════════════════

    const textLines: string[] = [];
    const hr = '═'.repeat(90);
    const hr2 = '─'.repeat(90);

    textLines.push(hr);
    textLines.push('  HARNESS FABRICATION SPECIFICATION');
    textLines.push(`  ${physicalRef.vehicle} — LS3 Swap`);
    textLines.push(`  Generated: ${new Date().toISOString().substring(0, 10)}`);
    textLines.push(`  Vehicle ID: ${vehicle_id}`);
    textLines.push(hr);
    textLines.push('');

    // Summary
    textLines.push('  SUMMARY');
    textLines.push(hr2);
    textLines.push(`  Total wires:        ${computed.summary.total_wires}`);
    textLines.push(`  Total wire length:   ${computed.summary.total_wire_length_ft} ft`);
    textLines.push(`  ECU:                ${computed.ecu.model} (${computed.ecu.reason})`);
    textLines.push(`  PDM:                ${computed.pdm.model} (${computed.pdm.channels_used}/${computed.pdm.channels_available} channels)`);
    textLines.push(`  Alternator:         ${computed.alternator.amps}A — ${computed.alternator.recommendation}`);
    textLines.push(`  Continuous draw:    ${computed.summary.total_continuous_amps}A`);
    textLines.push(`  Shielded wires:     ${computed.summary.shielded_wires}`);
    textLines.push(`  Twisted pairs:      ${computed.summary.twisted_pairs}`);
    if (computed.bulkhead.present) {
      textLines.push(`  Bulkhead:           ${computed.bulkhead.device_name} — ${computed.bulkhead.pins_used}/${computed.bulkhead.pins_available} pins`);
    }
    textLines.push('');

    // Warnings
    if (computed.warnings.length > 0) {
      textLines.push('  WARNINGS');
      textLines.push(hr2);
      for (const w of computed.warnings) textLines.push(`  ⚠ ${w}`);
      textLines.push('');
    }

    // Wire schedule
    textLines.push('  WIRE SCHEDULE');
    textLines.push(hr2);
    textLines.push('  W#   FROM                              TO                         GA  COLOR       LEN   FUSE  BH#  SIGNAL');
    textLines.push('  ' + '─'.repeat(130));
    for (const w of wireSchedule) {
      const fromStr = w.from_pin.substring(0, 33).padEnd(33);
      const toStr = (w.to_device + ' (' + w.to_zone + ')').substring(0, 26).padEnd(26);
      const bhStr = w.bulkhead_pin ? String(w.bulkhead_pin).padStart(3) : '  —';
      const fuseStr = w.fuse_amps ? String(w.fuse_amps) + 'A' : '—';
      textLines.push(`  ${String(w.wire_num).padStart(3)}  ${fromStr} ${toStr} ${String(w.gauge_awg).padStart(2)}  ${w.color.padEnd(10)} ${String(w.length_ft).padStart(5)}  ${fuseStr.padStart(4)}  ${bhStr}  ${w.signal_type}`);
    }
    textLines.push('');

    // Bulkhead table
    if (bulkheadTable.length > 0) {
      textLines.push('  BULKHEAD PIN ASSIGNMENT (D38999/26WA98SN — 61 pins)');
      textLines.push(hr2);
      textLines.push('  PIN  W#   FROM DEVICE                    TO DEVICE                      GA  COLOR       SIGNAL');
      textLines.push('  ' + '─'.repeat(120));
      for (const b of bulkheadTable) {
        textLines.push(`  ${String(b.bulkhead_pin).padStart(3)}  ${String(b.wire_num).padStart(3)}  ${b.from_device.substring(0, 29).padEnd(29)} ${b.to_device.substring(0, 29).padEnd(29)} ${String(b.gauge_awg).padStart(2)}  ${b.color.padEnd(10)} ${b.signal_type}`);
      }
      textLines.push(`\n  ${bulkheadTable.length} of 61 pins assigned — ${61 - bulkheadTable.length} spare`);
      textLines.push('');
    }

    // PDM table
    textLines.push(`  PDM CHANNEL ASSIGNMENT (${computed.pdm.model})`);
    textLines.push(hr2);
    textLines.push('  CH   MAX    DEVICE                              AMPS   GA  COLOR       LEN');
    textLines.push('  ' + '─'.repeat(90));
    for (const ch of pdmTable) {
      textLines.push(`  ${String(ch.channel).padStart(2)}   ${String(ch.max_amps).padStart(3)}A   ${ch.device.substring(0, 34).padEnd(34)} ${String(ch.actual_amps).padStart(5)}A  ${String(ch.wire_gauge || '—').padStart(2)}  ${(ch.wire_color || '—').padEnd(10)} ${String(ch.wire_length_ft || '—').padStart(5)}`);
    }
    textLines.push('');

    // Trunk summary
    textLines.push('  TRUNK ROUTING SUMMARY');
    textLines.push(hr2);
    for (const t of trunkSummary) {
      const bhTag = t.through_bulkhead ? ' [THROUGH BULKHEAD]' : '';
      textLines.push(`  ${t.route.padEnd(30)} ${String(t.wire_count).padStart(3)} wires   ${String(t.total_amps).padStart(6)}A total   gauge ${t.heaviest_gauge}-${t.lightest_gauge} AWG${bhTag}`);
    }
    textLines.push('');

    // Power budget
    textLines.push('  POWER BUDGET');
    textLines.push(hr2);
    textLines.push(`  Continuous draw:     ${powerBudget.total_continuous_amps}A`);
    textLines.push(`  Alternator:          ${powerBudget.alternator_required}A (${powerBudget.alternator_recommendation})`);
    textLines.push(`  Headroom:            ${powerBudget.headroom_amps}A (${powerBudget.headroom_pct}%)`);
    if (powerBudget.high_current_circuits.length > 0) {
      textLines.push('');
      textLines.push('  HIGH CURRENT CIRCUITS (≥15A):');
      for (const hc of powerBudget.high_current_circuits) {
        textLines.push(`    W${hc.wire_num} ${hc.device.padEnd(30)} ${hc.amps}A   ${hc.gauge} AWG   fuse ${hc.fuse || 'PDM'}`);
      }
    }
    textLines.push('');

    // Physical reference
    textLines.push('  PHYSICAL REFERENCE');
    textLines.push(hr2);
    textLines.push(`  Wheelbase: ${physicalRef.wheelbase_in}"   Length: ${physicalRef.overall_length_in}"   Width: ${physicalRef.width_in}"`);
    textLines.push(`  Frame rail spacing: ${physicalRef.frame_rail_width_in}"`);
    textLines.push('');
    textLines.push('  TRUNK PATHS:');
    for (const [name, desc] of Object.entries(physicalRef.trunk_paths)) {
      textLines.push(`    ${name.padEnd(20)} ${desc}`);
    }
    textLines.push('');
    textLines.push('  NOTES:');
    for (const n of physicalRef.notes) {
      textLines.push(`    • ${n}`);
    }
    textLines.push('');
    textLines.push(hr);
    textLines.push(`  END OF SPECIFICATION — ${computed.summary.total_wires} wires, ${devices.length} devices`);
    textLines.push(hr);

    const text = textLines.join('\n');

    // ── Store text version ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const storagePath = `wiring-diagrams/${vehicle_id}/harness_spec_${timestamp}.txt`;
    const textBytes = new TextEncoder().encode(text);
    const { error: uploadErr } = await supabase.storage
      .from("vehicle-data")
      .upload(storagePath, textBytes, { contentType: "text/plain", upsert: false });

    let specUrl: string | null = null;
    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from("vehicle-data").getPublicUrl(storagePath);
      specUrl = urlData.publicUrl;
    }

    // ── Response ──
    if (format === "text") {
      return new Response(text, {
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (format === "wire_schedule") {
      return new Response(JSON.stringify({ wire_schedule: wireSchedule, bulkhead: bulkheadTable, summary: computed.summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Full package
    return new Response(JSON.stringify({
      success: true,
      spec_url: specUrl,
      vehicle_id,
      generated_at: new Date().toISOString(),
      summary: computed.summary,
      ecu: computed.ecu,
      pdm: { model: computed.pdm.model, channels_used: computed.pdm.channels_used, channels_available: computed.pdm.channels_available },
      alternator: computed.alternator,
      bulkhead: computed.bulkhead,
      warnings: computed.warnings,
      tables: {
        wire_schedule: wireSchedule,
        ecu_pin_assignment: ecuPinTable,
        pdm_channels: pdmTable,
        bulkhead_pins: bulkheadTable,
        components: componentTable,
        trunk_routing: trunkSummary,
        power_budget: powerBudget,
      },
      physical_reference: physicalRef,
      text,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

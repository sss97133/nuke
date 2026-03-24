// generate-connector-schedule — Pin-by-pin assignment for ECU, PDM, and bulkhead connectors
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { vehicle_id, ecu_model = 'M130', format = 'json' } = await req.json();
    if (!vehicle_id) return new Response(JSON.stringify({ error: "vehicle_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load pin maps for the ECU model
    const { data: ecuPins } = await supabase.from("device_pin_maps")
      .select("*").eq("device_model", ecu_model).order("connector_name").order("pin_number");

    const { data: pdmPins } = await supabase.from("device_pin_maps")
      .select("*").eq("device_model", "PDM30").order("pin_number");

    const { data: devices } = await supabase.from("vehicle_build_manifest")
      .select("*").eq("vehicle_id", vehicle_id);

    const { data: vehicle } = await supabase.from("vehicles")
      .select("year, make, model").eq("id", vehicle_id).single();

    const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : vehicle_id;

    // Build ECU connector schedule
    interface PinAssignment {
      pin: string;
      function: string;
      assignedTo: string;
      wireColor: string;
      wireGauge: number;
      signalType: string;
      shielded: boolean;
      notes: string;
    }

    interface ConnectorBlock {
      name: string;
      type: string;
      pinCount: number;
      assignments: PinAssignment[];
      unusedPins: string[];
    }

    const connectors: ConnectorBlock[] = [];

    // Group ECU pins by connector
    const ecuConnectors = new Map<string, typeof ecuPins>();
    for (const pin of ecuPins || []) {
      const list = ecuConnectors.get(pin.connector_name) || [];
      list.push(pin);
      ecuConnectors.set(pin.connector_name, list);
    }

    // Match devices to ECU pins by signal type
    // Pin function format: INJ_PH1, IGN_LS1, UDIG1, KNOCK1, AV1, AT1, OUT_HB1, etc.
    // Signal types: injector_output, injector_low_side, ignition_output, universal_digital_input,
    //   knock_input, analog_voltage_input, analog_temp_input, half_bridge_output,
    //   power_ground, power_supply, sensor_supply, sensor_ground, can_bus, ethernet
    const matchedDevices = new Set<string>();

    // Helper to extract number from pin_function (e.g., INJ_PH1→1, IGN_LS8→8, KNOCK2→2)
    function extractPinNum(fn: string): string | null {
      const m = fn.match(/(\d+)\s*$/);
      return m ? m[1] : null;
    }

    for (const [connName, pins] of ecuConnectors) {
      const assignments: PinAssignment[] = [];
      const unusedPins: string[] = [];

      for (const pin of pins) {
        let assigned = false;
        const fn = pin.pin_function || '';
        const st = pin.signal_type || '';

        // --- Injectors: INJ_PH* or INJ_LS* ---
        if (st === 'injector_output' || st === 'injector_low_side' || fn.startsWith('INJ_')) {
          const injNum = extractPinNum(fn);
          if (injNum) {
            const device = devices?.find(d => d.device_name === `Fuel Injector ${injNum}`);
            if (device) {
              assignments.push({
                pin: pin.pin_number, function: fn,
                assignedTo: device.device_name, wireColor: 'GRN', wireGauge: 18,
                signalType: st, shielded: false,
                notes: `${device.part_number || ''} EV6/USCAR connector`,
              });
              matchedDevices.add(device.id);
              assigned = true;
            }
          }
        }

        // --- Ignition: IGN_LS* ---
        if (!assigned && (st === 'ignition_output' || fn.startsWith('IGN_'))) {
          const ignNum = extractPinNum(fn);
          if (ignNum) {
            const device = devices?.find(d => d.device_name === `Ignition Coil ${ignNum}`);
            if (device) {
              assignments.push({
                pin: pin.pin_number, function: fn,
                assignedTo: device.device_name, wireColor: 'WHT', wireGauge: 20,
                signalType: st, shielded: false,
                notes: `${device.part_number || ''} D510C 4-pin`,
              });
              matchedDevices.add(device.id);
              assigned = true;
            }
          }
        }

        // --- Crank/Cam: UDIG1 (firmware-locked to crank), UDIG2 (cam) ---
        if (!assigned && st === 'universal_digital_input') {
          if (fn === 'UDIG1') {
            const device = devices?.find(d => d.device_name.includes('Crank'));
            if (device) {
              assignments.push({
                pin: pin.pin_number, function: fn,
                assignedTo: device.device_name, wireColor: 'BLU/WHT', wireGauge: 22,
                signalType: st, shielded: true,
                notes: `SHIELDED. ${device.part_number || ''} Firmware-locked to crank position.`,
              });
              matchedDevices.add(device.id);
              assigned = true;
            }
          } else if (fn === 'UDIG2') {
            const device = devices?.find(d => d.device_name.includes('Cam'));
            if (device) {
              assignments.push({
                pin: pin.pin_number, function: fn,
                assignedTo: device.device_name, wireColor: 'BLU/WHT', wireGauge: 22,
                signalType: st, shielded: true,
                notes: `SHIELDED. ${device.part_number || ''}`,
              });
              matchedDevices.add(device.id);
              assigned = true;
            }
          }
          // Other UDIG pins remain unassigned (available for speed sensor, switches, etc.)
        }

        // --- Knock sensors: KNOCK1, KNOCK2 ---
        if (!assigned && (st === 'knock_input' || fn.startsWith('KNOCK'))) {
          const bankNum = extractPinNum(fn) || '1';
          const device = devices?.find(d => d.device_name === `Knock Sensor Bank ${bankNum}`);
          if (device) {
            assignments.push({
              pin: pin.pin_number, function: fn,
              assignedTo: device.device_name, wireColor: 'GRY', wireGauge: 22,
              signalType: st, shielded: true,
              notes: `SHIELDED. Drain to sensor ground.`,
            });
            matchedDevices.add(device.id);
            assigned = true;
          }
        }

        // --- Infrastructure pins: power, ground, sensor supply, CAN, ethernet ---
        if (!assigned) {
          const isInfra = ['power_ground', 'power_supply', 'sensor_supply', 'sensor_ground', 'can_bus', 'ethernet'].includes(st);
          if (isInfra) {
            const isGround = st.includes('ground');
            const isCan = st === 'can_bus';
            assignments.push({
              pin: pin.pin_number, function: fn,
              assignedTo: '—', wireColor: pin.default_wire_color || '—',
              wireGauge: pin.default_wire_gauge_awg || 18,
              signalType: st, shielded: false,
              notes: isGround ? 'Star ground point' : isCan ? '120 ohm termination required' : '',
            });
          } else {
            unusedPins.push(pin.pin_number);
          }
        }
      }

      connectors.push({
        name: `${ecu_model} ${connName}`,
        type: `Superseal ${pins[0]?.pin_count || '?'}-pin`,
        pinCount: pins[0]?.pin_count || 0,
        assignments,
        unusedPins,
      });
    }

    // PDM channel assignments
    // New PDM30 pin format: OUT1_A/OUT1_B (20A, paralleled), OUT9-OUT30 (8A), DIG1-DIG16 (switch inputs)
    if (pdmPins?.length) {
      const pdmAssignments: PinAssignment[] = [];
      const pdmUnused: string[] = [];

      const pdmDevices = (devices || [])
        .filter(d => d.pdm_controlled === true && (d.power_draw_amps || 0) > 0
          && !d.device_name.startsWith('Fuel Injector') && !d.device_name.startsWith('Ignition Coil'))
        .sort((a, b) => (b.power_draw_amps || 0) - (a.power_draw_amps || 0));

      // Collect unique output channels (OUT1 through OUT30)
      // 20A outputs have _A/_B pin pairs — show as single channel
      const outputPins = (pdmPins || []).filter(p =>
        p.signal_type === 'high_current_output' || p.signal_type === 'standard_output');

      // Deduplicate 20A channels (only show _A pin, note the _B pin)
      const seenOutputs = new Set<string>();
      const outputChannels: typeof outputPins = [];
      for (const pin of outputPins) {
        const outName = pin.pin_function.replace(/_[AB]$/, '');
        if (!seenOutputs.has(outName)) {
          seenOutputs.add(outName);
          outputChannels.push(pin);
        }
      }
      // Sort by output number
      outputChannels.sort((a, b) => {
        const na = parseInt(a.pin_function.replace(/\D/g, '')) || 0;
        const nb = parseInt(b.pin_function.replace(/\D/g, '')) || 0;
        return na - nb;
      });

      // Assign high-current devices to 20A channels first, then standard to 8A
      const highCurrentDevs = pdmDevices.filter(d => (d.power_draw_amps || 0) > 8);
      const standardDevs = pdmDevices.filter(d => (d.power_draw_amps || 0) <= 8);
      const highChannels = outputChannels.filter(p => p.signal_type === 'high_current_output');
      const stdChannels = outputChannels.filter(p => p.signal_type === 'standard_output');

      let hiIdx = 0, stdIdx = 0;
      for (const pin of highChannels) {
        const outName = pin.pin_function.replace(/_[AB]$/, '');
        if (hiIdx < highCurrentDevs.length) {
          const dev = highCurrentDevs[hiIdx++];
          pdmAssignments.push({
            pin: pin.pin_number, function: `${outName} (20A)`,
            assignedTo: dev.device_name,
            wireColor: '—', wireGauge: 16,
            signalType: 'high_current_output', shielded: false,
            notes: `${dev.power_draw_amps || 0}A load. Dual-pin output.`,
          });
        } else if (stdIdx < standardDevs.length) {
          const dev = standardDevs[stdIdx++];
          pdmAssignments.push({
            pin: pin.pin_number, function: `${outName} (20A)`,
            assignedTo: dev.device_name,
            wireColor: '—', wireGauge: 20,
            signalType: 'high_current_output', shielded: false,
            notes: `${dev.power_draw_amps || 0}A load`,
          });
        } else {
          pdmUnused.push(`${outName} (${pin.pin_number})`);
        }
      }
      for (const pin of stdChannels) {
        if (stdIdx < standardDevs.length) {
          const dev = standardDevs[stdIdx++];
          pdmAssignments.push({
            pin: pin.pin_number, function: `${pin.pin_function} (8A)`,
            assignedTo: dev.device_name,
            wireColor: '—', wireGauge: 20,
            signalType: 'standard_output', shielded: false,
            notes: `${dev.power_draw_amps || 0}A load`,
          });
        } else {
          pdmUnused.push(`${pin.pin_function} (${pin.pin_number})`);
        }
      }

      // Infrastructure pins: switch inputs, power, ground, CAN
      const infraPins = (pdmPins || []).filter(p =>
        ['switch_input', 'power_ground', 'logic_ground', 'power_supply', 'can_bus'].includes(p.signal_type));
      for (const pin of infraPins) {
        pdmAssignments.push({
          pin: pin.pin_number, function: pin.pin_function,
          assignedTo: '—', wireColor: pin.default_wire_color || '—',
          wireGauge: pin.default_wire_gauge_awg || 20,
          signalType: pin.signal_type, shielded: false,
          notes: pin.notes?.slice(0, 60) || '',
        });
      }

      // Group by connector for display
      const connACount = (pdmPins || []).filter(p => p.connector_name === 'Connector_A').length;
      const connBCount = (pdmPins || []).filter(p => p.connector_name === 'Connector_B').length;

      connectors.push({
        name: 'PDM30',
        type: `Superseal 34+26+M6 (${connACount + connBCount + 1} pins)`,
        pinCount: connACount + connBCount + 1,
        assignments: pdmAssignments,
        unusedPins: pdmUnused,
      });
    }

    const result = {
      title: `CONNECTOR SCHEDULE — ${vehicleName}`,
      generatedAt: new Date().toISOString(),
      ecuModel: ecu_model,
      connectors,
    };

    if (format === 'text') {
      const lines: string[] = [];
      lines.push(result.title);
      lines.push(`Generated: ${new Date().toLocaleDateString()} | ECU: ${ecu_model}`);
      lines.push('='.repeat(90));

      for (const conn of connectors) {
        lines.push('');
        lines.push(`>> ${conn.name} (${conn.type})`);
        lines.push('-'.repeat(90));
        lines.push(`${'PIN'.padEnd(6)}${'FUNCTION'.padEnd(28)}${'ASSIGNED TO'.padEnd(28)}${'GAUGE'.padEnd(6)}${'NOTES'}`);

        for (const a of conn.assignments) {
          lines.push(`${a.pin.padEnd(6)}${a.function.slice(0, 26).padEnd(28)}${a.assignedTo.slice(0, 26).padEnd(28)}${(a.wireGauge + 'ga').padEnd(6)}${a.shielded ? 'SHIELDED ' : ''}${a.notes}`);
        }

        if (conn.unusedPins.length > 0) {
          lines.push(`  UNUSED (${conn.unusedPins.length}): ${conn.unusedPins.join(', ')}`);
        }
      }

      return new Response(lines.join('\n'), { headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

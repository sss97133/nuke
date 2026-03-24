// compute-wiring-overlay
// Given a vehicle_id, computes the complete wiring specification:
// - Resolves all devices from build manifest
// - Computes every wire connection from endpoint pairs
// - Selects wire gauge from amperage + length
// - Assigns wire colors from a deterministic scheme
// - Computes total I/O → minimum ECU model
// - Computes total current → minimum alternator
// - Computes PDM channel assignments
// - Returns: full wire list, connector schedules, BOM, warnings
//
// The core principle: add or remove a device from the manifest,
// call this function, get a complete updated harness spec.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Wire gauge selection (from harnessCalculations.ts) ──────────────
const AWG_TABLE = [
  { gauge: 22, ohmsPerFt: 0.01614, maxAmps: 5 },
  { gauge: 20, ohmsPerFt: 0.01015, maxAmps: 7.5 },
  { gauge: 18, ohmsPerFt: 0.00639, maxAmps: 10 },
  { gauge: 16, ohmsPerFt: 0.00402, maxAmps: 15 },
  { gauge: 14, ohmsPerFt: 0.00253, maxAmps: 20 },
  { gauge: 12, ohmsPerFt: 0.00159, maxAmps: 25 },
  { gauge: 10, ohmsPerFt: 0.001, maxAmps: 35 },
  { gauge: 8, ohmsPerFt: 0.000628, maxAmps: 50 },
  { gauge: 6, ohmsPerFt: 0.000395, maxAmps: 65 },
  { gauge: 4, ohmsPerFt: 0.000249, maxAmps: 85 },
  { gauge: 2, ohmsPerFt: 0.000156, maxAmps: 115 },
  { gauge: 0, ohmsPerFt: 0.0000983, maxAmps: 150 },
];

function selectWireGauge(amps: number, lengthFt: number, systemVoltage = 12, maxDropPct = 3): { gauge: number; voltageDrop: number; dropPct: number } {
  const effectiveAmps = amps * 1.25; // 25% safety margin
  const maxDropVolts = (maxDropPct / 100) * systemVoltage;

  for (const entry of AWG_TABLE) {
    const vDrop = effectiveAmps * entry.ohmsPerFt * lengthFt * 2; // round trip
    if (vDrop <= maxDropVolts && entry.maxAmps >= effectiveAmps) {
      return { gauge: entry.gauge, voltageDrop: vDrop, dropPct: (vDrop / systemVoltage) * 100 };
    }
  }
  return { gauge: 0, voltageDrop: 0, dropPct: 0 }; // fallback to 0 AWG
}

function suggestFuseRating(amps: number): number {
  const standardFuses = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
  const target = amps * 1.25;
  return standardFuses.find(f => f >= target) || 100;
}

// ── Deterministic color assignment ──────────────────────────────────
// Colors assigned by FUNCTION, not randomly. Same function = same color every time.
const COLOR_BY_FUNCTION: Record<string, string> = {
  // Power
  'battery_positive': 'RED',
  'ground': 'BLK',
  'ignition_switched': 'PNK',
  'accessory': 'ORN',
  // Engine management
  'injector': 'GRN',
  'ignition_coil': 'WHT',
  'crank_cam': 'BLU/WHT',
  'sensor_5v_ref': 'RED/BLK',
  'sensor_signal': 'VIO',
  'sensor_ground': 'BLK/WHT',
  'temp_sensor': 'TAN',
  'knock': 'GRY',
  'o2_wideband': 'VIO/BLU',
  // Throttle
  'throttle_motor': 'ORG',
  'tps_signal': 'DK BLU',
  // Communication
  'can_high': 'WHT/GRN',
  'can_low': 'GRN/WHT',
  // PDM outputs
  'pdm_high_current': 'RED/BLK',
  'pdm_medium': 'ORN/BLK',
  'pdm_low': 'YEL/BLK',
  // Lighting
  'headlight_high': 'LT GRN',
  'headlight_low': 'TAN',
  'tail_park': 'BRN',
  'turn_left': 'LT BLU',
  'turn_right': 'DK BLU',
  'backup': 'LT GRN',
  'brake': 'WHT',
  // Body
  'horn': 'DK GRN',
  'wiper': 'PPL',
  'door_trigger': 'GRY',
  'window_motor': 'DK BLU',
  'lock_motor': 'BLK',
};

// Stripe colors for disambiguation within a function group (injector 1 vs injector 2)
const STRIPE_SEQUENCE = ['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG', '/GRN', '/GRY', '/BRN', '/TAN'];

function assignWireColor(functionGroup: string, index: number): string {
  const base = COLOR_BY_FUNCTION[functionGroup] || 'WHT';
  if (index === 0) return base;
  const stripe = STRIPE_SEQUENCE[index % STRIPE_SEQUENCE.length];
  return base + stripe;
}

// ── ECU model computation ───────────────────────────────────────────
interface IORequirements {
  injectorOutputs: number;
  ignitionOutputs: number;
  halfBridgeOutputs: number;
  analogInputs: number;
  tempInputs: number;
  digitalInputs: number;
  knockInputs: number;
  canBuses: number;
}

// ECU specs: per-type I/O limits (verified from manufacturer datasheets)
const ECU_MODELS = [
  { model: 'M130', price: 3500, inj: 8, ign: 8, hb: 6, an: 8, tmp: 4, dig: 7, can: 1, knk: 2 },
  { model: 'M150', price: 5500, inj: 12, ign: 12, hb: 10, an: 17, tmp: 6, dig: 16, can: 3, knk: 2 },
  { model: 'M1',   price: 8000, inj: 16, ign: 16, hb: 16, an: 24, tmp: 8, dig: 24, can: 4, knk: 4 },
];

function computeMinimumECU(io: IORequirements): { model: string; reason: string; price: number } {
  for (const ecu of ECU_MODELS) {
    if (io.injectorOutputs <= ecu.inj && io.ignitionOutputs <= ecu.ign
      && io.halfBridgeOutputs <= ecu.hb && io.analogInputs <= ecu.an
      && io.tempInputs <= ecu.tmp && io.digitalInputs <= ecu.dig
      && io.canBuses <= ecu.can && io.knockInputs <= ecu.knk) {
      return { model: ecu.model, reason: `${ecu.model} fits: ${io.injectorOutputs}/${ecu.inj} inj, ${io.digitalInputs}/${ecu.dig} dig, ${io.halfBridgeOutputs}/${ecu.hb} hb`, price: ecu.price };
    }
  }
  const m1 = ECU_MODELS[2];
  const bottlenecks: string[] = [];
  if (io.injectorOutputs > m1.inj) bottlenecks.push(`inj ${io.injectorOutputs}>${m1.inj}`);
  if (io.digitalInputs > m1.dig) bottlenecks.push(`dig ${io.digitalInputs}>${m1.dig}`);
  return { model: 'M1+', reason: `Exceeds M1: ${bottlenecks.join(', ')}`, price: 10000 };
}

// ── ECU comparison: all viable options with headroom ─────────────
function computeECUOptions(io: IORequirements) {
  return ECU_MODELS.map(ecu => {
    const fits = io.injectorOutputs <= ecu.inj && io.ignitionOutputs <= ecu.ign
      && io.halfBridgeOutputs <= ecu.hb && io.analogInputs <= ecu.an
      && io.tempInputs <= ecu.tmp && io.digitalInputs <= ecu.dig
      && io.canBuses <= ecu.can && io.knockInputs <= ecu.knk;
    return {
      model: ecu.model,
      price: ecu.price,
      fits,
      headroom: {
        injectors: `${io.injectorOutputs}/${ecu.inj} (${ecu.inj - io.injectorOutputs} spare)`,
        ignition: `${io.ignitionOutputs}/${ecu.ign} (${ecu.ign - io.ignitionOutputs} spare)`,
        halfBridge: `${io.halfBridgeOutputs}/${ecu.hb} (${ecu.hb - io.halfBridgeOutputs} spare)`,
        analogInputs: `${io.analogInputs}/${ecu.an} (${ecu.an - io.analogInputs} spare)`,
        tempInputs: `${io.tempInputs}/${ecu.tmp} (${ecu.tmp - io.tempInputs} spare)`,
        digitalInputs: `${io.digitalInputs}/${ecu.dig} (${ecu.dig - io.digitalInputs} spare)`,
        canBuses: `${io.canBuses}/${ecu.can} (${ecu.can - io.canBuses} spare)`,
        knockInputs: `${io.knockInputs}/${ecu.knk} (${ecu.knk - io.knockInputs} spare)`,
      },
      connectors: ecu.model === 'M130' ? '2 (34+26 pin Superseal)' : ecu.model === 'M150' ? '4 (2×34+2×26 pin Superseal)' : '6 connectors',
      upgradeNote: ecu.model === 'M130'
        ? 'M130 harness (Conn A+B) plugs directly into M150 (as Conn C+D). Upgrade by adding Conn A+B only.'
        : ecu.model === 'M150'
        ? 'Full-featured. 3 CAN buses for display, dash logger, traction control.'
        : 'Maximum I/O. Needed for 12+ cylinder or multi-ECU configurations.',
    };
  });
}

// ── Alternator sizing ───────────────────────────────────────────────
function computeAlternatorSize(totalContinuousAmps: number): { amps: number; recommendation: string } {
  const required = totalContinuousAmps * 1.25; // 25% headroom
  if (required <= 80) return { amps: 80, recommendation: 'Stock 80A adequate' };
  if (required <= 105) return { amps: 105, recommendation: 'Stock high-output 105A' };
  if (required <= 145) return { amps: 145, recommendation: 'Upgraded 145A (CS130D)' };
  if (required <= 180) return { amps: 180, recommendation: 'High-output 180A (AD244)' };
  if (required <= 220) return { amps: 220, recommendation: 'High-output 220A (AD244)' };
  return { amps: 250, recommendation: 'Dual alternator or 250A+ custom' };
}

// ── PDM channel assignment ──────────────────────────────────────────
interface PDMChannel {
  channel: number;
  maxAmps: number;
  deviceName: string;
  actualAmps: number;
  pwmCapable: boolean;
}

function assignPDMChannels(devices: Array<{ name: string; amps: number; needsPWM?: boolean }>): { channels: PDMChannel[]; model: string; warnings: string[] } {
  // PDM30: Ch1-6 = 20A, Ch7-20 = 15A, Ch21-30 = 10A
  // PDM15: Ch1-8 = 20A, Ch9-15 = 8A
  const warnings: string[] = [];

  // Sort by amperage descending (heavy loads get high-current channels)
  const sorted = [...devices].sort((a, b) => b.amps - a.amps);

  const channels: PDMChannel[] = [];
  let chNum = 1;

  for (const dev of sorted) {
    const maxAmps = chNum <= 6 ? 20 : chNum <= 20 ? 15 : chNum <= 30 ? 10 : 0;
    if (chNum > 30) {
      warnings.push(`OVERFLOW: ${dev.name} (${dev.amps}A) exceeds PDM30 capacity (30 channels)`);
      continue;
    }
    if (dev.amps > maxAmps) {
      warnings.push(`OVERLOAD: ${dev.name} needs ${dev.amps}A but Ch${chNum} is rated ${maxAmps}A`);
    }
    channels.push({
      channel: chNum,
      maxAmps,
      deviceName: dev.name,
      actualAmps: dev.amps,
      pwmCapable: true, // all PDM30 channels are PWM capable
    });
    chNum++;
  }

  const model = chNum <= 16 ? 'PDM15' : 'PDM30';
  return { channels, model, warnings };
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

    // ── Load ECU pin maps for pin-level assignment ──
    // We load after I/O computation determines the ECU model
    async function loadPinMaps(ecuModel: string) {
      const { data: pins } = await supabase.from("device_pin_maps")
        .select("pin_number, pin_function, signal_type, connector_name, max_current_amps, default_wire_gauge_awg")
        .eq("device_model", ecuModel)
        .order("connector_name").order("pin_number");
      return pins || [];
    }

    // ── Compute I/O requirements ──
    const io: IORequirements = {
      injectorOutputs: devices.filter(d => d.device_name.startsWith('Fuel Injector')).length,
      ignitionOutputs: devices.filter(d => d.device_name.startsWith('Ignition Coil')).length,
      halfBridgeOutputs: devices.filter(d => d.signal_type === 'h_bridge_motor' || (d.signal_type === 'motor' && d.pdm_controlled === false)).length,
      analogInputs: devices.filter(d => d.signal_type === 'analog_5v').length,
      tempInputs: devices.filter(d => d.signal_type === 'analog_temp').length,
      digitalInputs: devices.filter(d => d.signal_type === 'ecu_digital_input' || d.signal_type === 'digital').length,
      knockInputs: devices.filter(d => d.signal_type === 'piezoelectric').length,
      canBuses: devices.some(d => d.signal_type === 'can_bus' || d.signal_type === 'can_display') ? 1 : 0,
    };

    const ecuRequirement = computeMinimumECU(io);

    // ── Compute total current draw ──
    const totalContinuousAmps = devices
      .filter(d => d.power_draw_amps && d.signal_type !== 'power_source')
      .reduce((sum, d) => sum + (d.power_draw_amps || 0), 0);

    const alternatorRequirement = computeAlternatorSize(totalContinuousAmps);

    // ── Assign PDM channels ──
    // Group devices that share PDM channels
    const channelGroupTotals = new Map<string, { totalAmps: number; devices: string[] }>();
    const individualPDMDevices: Array<{ name: string; amps: number; needsPWM?: boolean }> = [];

    const pdmCandidates = devices.filter(d =>
      d.pdm_controlled !== false &&
      d.power_draw_amps > 0 &&
      d.signal_type !== 'power_source' &&
      d.signal_type !== 'ground' &&
      d.signal_type !== 'can_bus' &&
      !d.device_name.startsWith('Fuel Injector') &&
      !d.device_name.startsWith('Ignition Coil') &&
      !d.device_name.startsWith('Throttle Position')
    );

    for (const d of pdmCandidates) {
      if (d.pdm_channel_group) {
        const group = channelGroupTotals.get(d.pdm_channel_group) || { totalAmps: 0, devices: [] };
        group.totalAmps += d.power_draw_amps || 0;
        group.devices.push(d.device_name);
        channelGroupTotals.set(d.pdm_channel_group, group);
      } else {
        individualPDMDevices.push({ name: d.device_name, amps: d.power_draw_amps || 5, needsPWM: d.signal_type === 'motor' });
      }
    }

    // Add grouped channels as single entries
    for (const [groupName, group] of channelGroupTotals) {
      individualPDMDevices.push({
        name: `[${groupName}] ${group.devices.length} devices`,
        amps: group.totalAmps,
      });
    }

    const pdmDevices = individualPDMDevices;

    const pdmAssignment = assignPDMChannels(pdmDevices);

    // ── Load ECU pin maps for precise pin references ──
    const ecuPins = await loadPinMaps(ecuRequirement.model);
    const ecuOptions = computeECUOptions(io);

    // Build pin assignment map: track which ECU pins are assigned to which devices
    const injectorPins = ecuPins.filter(p => p.signal_type === 'injector_output').sort((a,b) => {
      const na = parseInt(a.pin_function.replace(/\D/g,'')) || 0;
      const nb = parseInt(b.pin_function.replace(/\D/g,'')) || 0;
      return na - nb;
    });
    const ignitionPins = ecuPins.filter(p => p.signal_type === 'ignition_output').sort((a,b) => {
      const na = parseInt(a.pin_function.replace(/\D/g,'')) || 0;
      const nb = parseInt(b.pin_function.replace(/\D/g,'')) || 0;
      return na - nb;
    });
    const crankPin = ecuPins.find(p => p.pin_function === 'UDIG1');
    const camPin = ecuPins.find(p => p.pin_function === 'UDIG2');
    const knockPins = ecuPins.filter(p => p.signal_type === 'knock_input');
    const analogPins = ecuPins.filter(p => p.signal_type === 'analog_voltage_input');
    const tempPins = ecuPins.filter(p => p.signal_type === 'analog_temp_input');

    // Assignment counters
    let injIdx = 0, ignIdx = 0, knkIdx = 0, avIdx = 0, atIdx = 0;

    // Map device to ECU pin reference
    function getECUPinRef(device: any): string {
      const name = device.device_name || '';
      if (name.startsWith('Fuel Injector') && injIdx < injectorPins.length) {
        const pin = injectorPins[injIdx++];
        return `${ecuRequirement.model}:${pin.pin_number}`;
      }
      if (name.startsWith('Ignition Coil') && ignIdx < ignitionPins.length) {
        const pin = ignitionPins[ignIdx++];
        return `${ecuRequirement.model}:${pin.pin_number}`;
      }
      if (name.includes('Crank') && crankPin) return `${ecuRequirement.model}:${crankPin.pin_number}`;
      if (name.includes('Cam') && camPin) return `${ecuRequirement.model}:${camPin.pin_number}`;
      if (name.includes('Knock') && knkIdx < knockPins.length) {
        const pin = knockPins[knkIdx++];
        return `${ecuRequirement.model}:${pin.pin_number}`;
      }
      if (device.signal_type === 'analog_temp' && atIdx < tempPins.length) {
        const pin = tempPins[atIdx++];
        return `${ecuRequirement.model}:${pin.pin_number}`;
      }
      if (device.signal_type === 'analog_5v' && avIdx < analogPins.length) {
        const pin = analogPins[avIdx++];
        return `${ecuRequirement.model}:${pin.pin_number}`;
      }
      return 'ECU';
    }

    // ── Generate wire list ──
    interface WireSpec {
      wireNumber: number;
      label: string;
      fromDevice: string;
      fromLocation: string;
      toDevice: string;
      toLocation: string;
      gauge: number;
      color: string;
      lengthFt: number;
      fuseRating: number | null;
      isShielded: boolean;
      isTwistedPair: boolean;
      signalType: string;
      voltageDrop: number;
      voltageDropPct: number;
      pdmChannel: number | null;
    }

    const wires: WireSpec[] = [];
    let wireNum = 1;

    // Track function groups for color assignment
    const functionCounters: Record<string, number> = {};
    function nextColor(functionGroup: string): string {
      const idx = functionCounters[functionGroup] || 0;
      functionCounters[functionGroup] = idx + 1;
      return assignWireColor(functionGroup, idx);
    }

    for (const device of devices) {
      if (!device.pin_count || device.pin_count === 0) continue;
      if (device.signal_type === 'ground' || device.signal_type === 'power_source') continue;

      const amps = device.power_draw_amps || 1;
      // Estimate length based on zones (simplified — real data comes from measurements)
      const lengthEstimate = device.measured_length_ft || estimateLength(device.location_zone || 'dash');
      const gaugeResult = selectWireGauge(amps, lengthEstimate);

      // Determine function group for color
      let functionGroup = 'sensor_signal'; // default
      if (device.device_name.startsWith('Fuel Injector')) functionGroup = 'injector';
      else if (device.device_name.startsWith('Ignition Coil')) functionGroup = 'ignition_coil';
      else if (device.device_name.includes('Crank') || device.device_name.includes('Cam')) functionGroup = 'crank_cam';
      else if (device.signal_type === 'analog_temp') functionGroup = 'temp_sensor';
      else if (device.signal_type === 'analog_5v') functionGroup = 'sensor_signal';
      else if (device.signal_type === 'piezoelectric') functionGroup = 'knock';
      else if (device.signal_type === 'wideband_lambda') functionGroup = 'o2_wideband';
      else if (device.signal_type === 'h_bridge_motor') functionGroup = 'throttle_motor';
      else if (device.signal_type === 'can_bus') functionGroup = 'can_high';
      else if (device.signal_type === 'led_lighting') {
        if (device.device_name.includes('Headlight')) functionGroup = device.device_name.includes('High') ? 'headlight_high' : 'headlight_low';
        else if (device.device_name.includes('Tail')) functionGroup = 'tail_park';
        else if (device.device_name.includes('Turn')) functionGroup = device.device_name.includes('Left') ? 'turn_left' : 'turn_right';
        else if (device.device_name.includes('Backup')) functionGroup = 'backup';
        else functionGroup = 'tail_park';
      }
      else if (device.signal_type === 'motor') {
        if (device.device_name.includes('Window')) functionGroup = 'window_motor';
        else if (device.device_name.includes('Lock')) functionGroup = 'lock_motor';
        else if (device.device_name.includes('Wiper')) functionGroup = 'wiper';
        else functionGroup = 'pdm_medium';
      }
      else if (device.signal_type === 'high_current') functionGroup = 'pdm_high_current';
      else if (device.signal_type === 'audio' || device.signal_type === 'audio_amplifier') functionGroup = 'accessory';

      const color = nextColor(functionGroup);
      const fuse = amps > 1 ? suggestFuseRating(amps) : null;

      // Find PDM channel if assigned
      const pdmCh = pdmAssignment.channels.find(c => c.deviceName === device.device_name);
      // Get specific ECU pin reference
      const ecuPinRef = !pdmCh ? getECUPinRef(device) : undefined;

      wires.push({
        wireNumber: wireNum++,
        label: `${device.device_name}`,
        fromDevice: pdmCh ? `PDM30:OUT${pdmCh.channel}` : (ecuPinRef || 'ECU'),
        fromLocation: 'firewall',
        toDevice: device.device_name,
        toLocation: device.location_zone || 'unknown',
        gauge: device.wire_gauge_recommended || gaugeResult.gauge,
        color,
        lengthFt: lengthEstimate,
        fuseRating: pdmCh ? null : fuse, // PDM channels self-fuse
        isShielded: device.requires_shielding || false,
        isTwistedPair: device.signal_type === 'can_bus',
        signalType: device.signal_type || 'unknown',
        voltageDrop: gaugeResult.voltageDrop,
        voltageDropPct: gaugeResult.dropPct,
        pdmChannel: pdmCh?.channel || null,
      });
    }

    // ── Compute totals ──
    const totalWireLength = wires.reduce((sum, w) => sum + w.lengthFt, 0);
    const shieldedCount = wires.filter(w => w.isShielded).length;
    const twistedPairCount = wires.filter(w => w.isTwistedPair).length;
    const warnings = [...pdmAssignment.warnings];

    // Check PDM headroom
    const pdmCapacity = pdmAssignment.model === 'PDM30' ? 30 : 15;
    const pdmUsed = pdmAssignment.channels.length;
    const pdmHeadroom = pdmCapacity - pdmUsed;
    if (pdmHeadroom <= 2) {
      warnings.push(`PDM HEADROOM: Only ${pdmHeadroom} channels remaining on ${pdmAssignment.model}. Adding more devices will overflow.`);
    }

    // Check for voltage drop warnings
    wires.filter(w => w.voltageDropPct > 3).forEach(w => {
      warnings.push(`VOLTAGE DROP: ${w.label} has ${w.voltageDropPct.toFixed(1)}% drop (max 3%)`);
    });

    const result = {
      vehicle_id,
      computed_at: new Date().toISOString(),
      summary: {
        total_devices: devices.length,
        total_wires: wires.length,
        total_wire_length_ft: Math.round(totalWireLength),
        shielded_wires: shieldedCount,
        twisted_pairs: twistedPairCount,
        total_continuous_amps: Math.round(totalContinuousAmps),
      },
      ecu: ecuRequirement,
      ecu_options: ecuOptions,
      alternator: alternatorRequirement,
      pdm: {
        model: pdmAssignment.model,
        channels_used: pdmAssignment.channels.length,
        channels_available: pdmAssignment.model === 'PDM30' ? 30 : 15,
        assignments: pdmAssignment.channels,
      },
      io_requirements: io,
      wires: action === 'summary' ? undefined : wires,
      warnings,
    };

    // ── Update the overlay record ──
    await supabase.from("vehicle_wiring_overlays").upsert({
      vehicle_id,
      factory_generation: 'squarebody_1973_1987',
      total_circuits: wires.length,
      total_wire_length_ft: Math.round(totalWireLength),
      estimated_hours: Math.round(wires.length * 0.5), // ~30 min per wire avg
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

// ── Length estimation by zone ───────────────────────────────────────
function estimateLength(zone: string): number {
  const LENGTHS: Record<string, number> = {
    'engine_bay': 4,
    'firewall': 2,
    'dash': 3,
    'doors': 6,
    'rear': 16,
    'underbody': 10,
    'roof': 5,
  };
  const base = LENGTHS[zone] || 5;
  return base * 1.15; // 15% slack
}

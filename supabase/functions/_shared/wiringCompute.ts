// wiringCompute.ts — Pure computation engine for wiring overlay
// Extracted from compute-wiring-overlay/index.ts
// No DB access. Takes devices array, returns full harness specification.
// Used by: compute-wiring-overlay, generate-wiring-diagram

// ── Wire gauge selection ──────────────────────────────────────────────
export const AWG_TABLE = [
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

export function selectWireGauge(
  amps: number,
  lengthFt: number,
  systemVoltage = 12,
  maxDropPct = 3,
): { gauge: number; voltageDrop: number; dropPct: number } {
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

export function suggestFuseRating(amps: number): number {
  const standardFuses = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
  const target = amps * 1.25;
  return standardFuses.find(f => f >= target) || 100;
}

// ── Deterministic color assignment ──────────────────────────────────
export const COLOR_BY_FUNCTION: Record<string, string> = {
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

export const STRIPE_SEQUENCE = ['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG', '/GRN', '/GRY', '/BRN', '/TAN'];

export function assignWireColor(functionGroup: string, index: number): string {
  const base = COLOR_BY_FUNCTION[functionGroup] || 'WHT';
  if (index === 0) return base;
  const stripe = STRIPE_SEQUENCE[index % STRIPE_SEQUENCE.length];
  return base + stripe;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface IORequirements {
  injectorOutputs: number;
  ignitionOutputs: number;
  halfBridgeOutputs: number;
  analogInputs: number;
  tempInputs: number;
  digitalInputs: number;
  knockInputs: number;
  canBuses: number;
}

export interface WireSpec {
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
  bulkheadPin: number | null;
  routesThroughBulkhead: boolean;
}

export interface PDMChannelAssignment {
  channel: number;
  maxAmps: number;
  deviceName: string;
  actualAmps: number;
  pwmCapable: boolean;
}

export interface ECURequirement {
  model: string;
  reason: string;
  price: number;
}

export interface ECUOptionDetail {
  model: string;
  price: number;
  fits: boolean;
  headroom: Record<string, string>;
  connectors: string;
  upgradeNote: string;
}

export interface PDMAssignment {
  channels: PDMChannelAssignment[];
  model: string;
  warnings: string[];
}

export interface AlternatorRequirement {
  amps: number;
  recommendation: string;
}

export interface ComputeResult {
  vehicle_id: string;
  computed_at: string;
  summary: {
    total_devices: number;
    total_wires: number;
    total_wire_length_ft: number;
    shielded_wires: number;
    twisted_pairs: number;
    total_continuous_amps: number;
  };
  ecu: ECURequirement;
  ecu_options: ECUOptionDetail[];
  alternator: AlternatorRequirement;
  pdm: {
    model: string;
    channels_used: number;
    channels_available: number;
    assignments: PDMChannelAssignment[];
  };
  io_requirements: IORequirements;
  wires: WireSpec[];
  warnings: string[];
  // Zones present in the manifest
  available_zones: string[];
  // Bulkhead passthrough info
  bulkhead: {
    present: boolean;
    device_name: string | null;
    pins_used: number;
    pins_available: number;
  };
}

// ── ECU model computation ───────────────────────────────────────────

const ECU_MODELS = [
  { model: 'M130', price: 3500, inj: 8, ign: 8, hb: 6, an: 8, tmp: 4, dig: 7, can: 1, knk: 2 },
  { model: 'M150', price: 5500, inj: 12, ign: 12, hb: 10, an: 17, tmp: 6, dig: 16, can: 3, knk: 2 },
  { model: 'M1',   price: 8000, inj: 16, ign: 16, hb: 16, an: 24, tmp: 8, dig: 24, can: 4, knk: 4 },
];

export function computeMinimumECU(io: IORequirements): ECURequirement {
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

export function computeECUOptions(io: IORequirements): ECUOptionDetail[] {
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

export function computeAlternatorSize(totalContinuousAmps: number): AlternatorRequirement {
  const required = totalContinuousAmps * 1.25; // 25% headroom
  if (required <= 80) return { amps: 80, recommendation: 'Stock 80A adequate' };
  if (required <= 105) return { amps: 105, recommendation: 'Stock high-output 105A' };
  if (required <= 145) return { amps: 145, recommendation: 'Upgraded 145A (CS130D)' };
  if (required <= 180) return { amps: 180, recommendation: 'High-output 180A (AD244)' };
  if (required <= 220) return { amps: 220, recommendation: 'High-output 220A (AD244)' };
  return { amps: 250, recommendation: 'Dual alternator or 250A+ custom' };
}

// ── PDM channel assignment ──────────────────────────────────────────

export function assignPDMChannels(
  devices: Array<{ name: string; amps: number; needsPWM?: boolean }>,
): PDMAssignment {
  // PDM30: Ch1-6 = 20A, Ch7-20 = 15A, Ch21-30 = 10A
  const warnings: string[] = [];
  const sorted = [...devices].sort((a, b) => b.amps - a.amps);
  const channels: PDMChannelAssignment[] = [];
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
      pwmCapable: true,
    });
    chNum++;
  }

  const model = chNum <= 16 ? 'PDM15' : 'PDM30';
  return { channels, model, warnings };
}

// ── Length estimation by zone ───────────────────────────────────────

export function estimateLength(zone: string): number {
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

// ── Zone-aware route length estimation ────────────────────────────────
// Estimates wire length based on source and destination zones.
// If a bulkhead connector exists, engine↔interior wires route through it.

const ZONE_ROUTE_LENGTHS: Record<string, number> = {
  'engine_bay→engine_bay': 4,
  'engine_bay→firewall': 3,
  'engine_bay→dash': 9,       // 4ft engine + 2ft firewall + 3ft dash
  'engine_bay→doors': 11,     // engine→firewall→dash→doors
  'engine_bay→rear': 22,      // engine→firewall→dash→rear
  'engine_bay→underbody': 8,
  'dash→dash': 3,
  'dash→doors': 6,
  'dash→rear': 16,
  'dash→underbody': 6,
  'dash→firewall': 4,
  'firewall→firewall': 2,
  'firewall→dash': 4,
  'firewall→engine_bay': 3,
  'doors→doors': 8,
  'doors→rear': 14,
  'rear→rear': 8,
  'rear→underbody': 12,
  'underbody→underbody': 10,
  'roof→dash': 4,
  'roof→roof': 3,
};

// Direct (no-bulkhead) lengths for engine↔interior routes
const ZONE_ROUTE_DIRECT: Record<string, number> = {
  'engine_bay→dash': 6,
  'engine_bay→doors': 8,
  'engine_bay→rear': 18,
};

export function estimateRouteLength(fromZone: string, toZone: string, hasBulkhead: boolean): number {
  if (fromZone === toZone) {
    return (ZONE_ROUTE_LENGTHS[`${fromZone}→${fromZone}`] || estimateLength(fromZone)) * 1.15;
  }
  // Try both orderings
  const key1 = `${fromZone}→${toZone}`;
  const key2 = `${toZone}→${fromZone}`;

  // Check if this is an engine↔interior crossing
  const engineZones = new Set(['engine_bay']);
  const interiorZones = new Set(['dash', 'doors', 'rear', 'roof']);
  const crossesFirewall = (engineZones.has(fromZone) && interiorZones.has(toZone)) ||
                          (interiorZones.has(fromZone) && engineZones.has(toZone));

  if (crossesFirewall && !hasBulkhead) {
    const directLen = ZONE_ROUTE_DIRECT[key1] || ZONE_ROUTE_DIRECT[key2];
    if (directLen) return directLen * 1.15;
  }

  const routeLen = ZONE_ROUTE_LENGTHS[key1] || ZONE_ROUTE_LENGTHS[key2];
  if (routeLen) return routeLen * 1.15;

  // Fallback: sum of individual zone estimates
  return (estimateLength(fromZone) + estimateLength(toZone)) * 1.15;
}

// ── Bulkhead passthrough detection ────────────────────────────────────

export interface BulkheadDevice {
  device_name: string;
  location_zone: string;
  pin_count: number;
  connector_type?: string;
}

// deno-lint-ignore no-explicit-any
export function findBulkheadDevices(devices: any[]): BulkheadDevice[] {
  return devices.filter((d: any) => d.signal_type === 'bulkhead_passthrough');
}

// Determines if a wire crosses the firewall boundary (engine_bay ↔ interior zones)
export function wireNeedsBulkhead(fromZone: string, toZone: string): boolean {
  const engineSide = new Set(['engine_bay']);
  const interiorSide = new Set(['dash', 'doors', 'rear', 'roof']);
  return (engineSide.has(fromZone) && interiorSide.has(toZone)) ||
         (interiorSide.has(fromZone) && engineSide.has(toZone));
}

// ── Function group classification ──────────────────────────────────

function classifyFunctionGroup(device: { device_name: string; signal_type?: string }): string {
  const name = device.device_name;
  const sig = device.signal_type || '';

  if (name.startsWith('Fuel Injector')) return 'injector';
  if (name.startsWith('Ignition Coil')) return 'ignition_coil';
  if (name.includes('Crank') || name.includes('Cam')) return 'crank_cam';
  if (sig === 'analog_temp') return 'temp_sensor';
  if (sig === 'analog_5v') return 'sensor_signal';
  if (sig === 'piezoelectric') return 'knock';
  if (sig === 'wideband_lambda') return 'o2_wideband';
  if (sig === 'h_bridge_motor') return 'throttle_motor';
  if (sig === 'can_bus') return 'can_high';
  if (sig === 'led_lighting') {
    if (name.includes('Headlight')) return name.includes('High') ? 'headlight_high' : 'headlight_low';
    if (name.includes('Tail')) return 'tail_park';
    if (name.includes('Turn')) return name.includes('Left') ? 'turn_left' : 'turn_right';
    if (name.includes('Backup')) return 'backup';
    return 'tail_park';
  }
  if (sig === 'motor') {
    if (name.includes('Window')) return 'window_motor';
    if (name.includes('Lock')) return 'lock_motor';
    if (name.includes('Wiper')) return 'wiper';
    return 'pdm_medium';
  }
  if (sig === 'high_current') return 'pdm_high_current';
  if (sig === 'audio' || sig === 'audio_amplifier') return 'accessory';
  return 'sensor_signal';
}

// ── Main orchestrator ───────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
export function computeWiringOverlay(vehicleId: string, devices: any[]): ComputeResult {
  // Compute I/O requirements
  const io: IORequirements = {
    injectorOutputs: devices.filter((d: any) => d.device_name.startsWith('Fuel Injector')).length,
    ignitionOutputs: devices.filter((d: any) => d.device_name.startsWith('Ignition Coil')).length,
    halfBridgeOutputs: devices.filter((d: any) => d.signal_type === 'h_bridge_motor' || (d.signal_type === 'motor' && d.pdm_controlled === false)).length,
    analogInputs: devices.filter((d: any) => d.signal_type === 'analog_5v').length,
    tempInputs: devices.filter((d: any) => d.signal_type === 'analog_temp').length,
    digitalInputs: devices.filter((d: any) => d.signal_type === 'ecu_digital_input' || d.signal_type === 'digital').length,
    knockInputs: devices.filter((d: any) => d.signal_type === 'piezoelectric').length,
    canBuses: devices.some((d: any) => d.signal_type === 'can_bus' || d.signal_type === 'can_display') ? 1 : 0,
  };

  const ecuRequirement = computeMinimumECU(io);
  const ecuOptions = computeECUOptions(io);

  // Total current draw
  const totalContinuousAmps = devices
    .filter((d: any) => d.power_draw_amps && d.signal_type !== 'power_source')
    .reduce((sum: number, d: any) => sum + (d.power_draw_amps || 0), 0);

  const alternatorRequirement = computeAlternatorSize(totalContinuousAmps);

  // PDM channel assignment
  const channelGroupTotals = new Map<string, { totalAmps: number; devices: string[] }>();
  const individualPDMDevices: Array<{ name: string; amps: number; needsPWM?: boolean }> = [];

  const pdmCandidates = devices.filter((d: any) =>
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

  for (const [groupName, group] of channelGroupTotals) {
    individualPDMDevices.push({
      name: `[${groupName}] ${group.devices.length} devices`,
      amps: group.totalAmps,
    });
  }

  const pdmAssignment = assignPDMChannels(individualPDMDevices);

  // Detect bulkhead passthrough devices
  const bulkheadDevices = findBulkheadDevices(devices);
  const hasBulkhead = bulkheadDevices.length > 0;
  const bulkheadDevice = bulkheadDevices[0] || null;
  let bulkheadPinCounter = 1;

  // Determine ECU and PDM locations from manifest
  const ecuDevice = devices.find((d: any) => d.signal_type === 'ecu');
  const pdmDevice = devices.find((d: any) => d.device_name === 'Power Distribution Module');
  const ecuZone = ecuDevice?.location_zone || 'dash';
  const pdmZone = pdmDevice?.location_zone || 'dash';

  // Generate wire list
  const wires: WireSpec[] = [];
  let wireNum = 1;
  const functionCounters: Record<string, number> = {};

  function nextColor(functionGroup: string): string {
    const idx = functionCounters[functionGroup] || 0;
    functionCounters[functionGroup] = idx + 1;
    return assignWireColor(functionGroup, idx);
  }

  for (const device of devices) {
    if (!device.pin_count || device.pin_count === 0) continue;
    if (device.signal_type === 'ground' || device.signal_type === 'power_source') continue;
    if (device.signal_type === 'bulkhead_passthrough') continue; // Don't wire the bulkhead itself

    const amps = device.power_draw_amps || 1;
    const pdmCh = pdmAssignment.channels.find(c => c.deviceName === device.device_name);
    const sourceZone = pdmCh ? pdmZone : ecuZone;
    const destZone = device.location_zone || 'dash';

    // Use zone-aware routing for length estimation
    const lengthEst = device.measured_length_ft || estimateRouteLength(sourceZone, destZone, hasBulkhead);
    const gaugeResult = selectWireGauge(amps, lengthEst);
    const functionGroup = classifyFunctionGroup(device);
    const color = nextColor(functionGroup);
    const fuse = amps > 1 ? suggestFuseRating(amps) : null;

    // Does this wire cross the firewall boundary?
    const needsBulkhead = hasBulkhead && wireNeedsBulkhead(sourceZone, destZone);
    const assignedBulkheadPin = needsBulkhead ? bulkheadPinCounter++ : null;

    wires.push({
      wireNumber: wireNum++,
      label: device.device_name,
      fromDevice: pdmCh ? `PDM30:OUT${pdmCh.channel}` : 'ECU',
      fromLocation: sourceZone,
      toDevice: device.device_name,
      toLocation: destZone,
      gauge: device.wire_gauge_recommended || gaugeResult.gauge,
      color,
      lengthFt: lengthEst,
      fuseRating: pdmCh ? null : fuse,
      isShielded: device.requires_shielding || false,
      isTwistedPair: device.signal_type === 'can_bus',
      signalType: device.signal_type || 'unknown',
      voltageDrop: gaugeResult.voltageDrop,
      voltageDropPct: gaugeResult.dropPct,
      pdmChannel: pdmCh?.channel || null,
      bulkheadPin: assignedBulkheadPin,
      routesThroughBulkhead: needsBulkhead,
    });
  }

  // Compute totals + warnings
  const totalWireLength = wires.reduce((sum, w) => sum + w.lengthFt, 0);
  const warnings = [...pdmAssignment.warnings];

  const pdmCapacity = pdmAssignment.model === 'PDM30' ? 30 : 15;
  const pdmUsed = pdmAssignment.channels.length;
  if (pdmCapacity - pdmUsed <= 2) {
    warnings.push(`PDM HEADROOM: Only ${pdmCapacity - pdmUsed} channels remaining on ${pdmAssignment.model}. Adding more devices will overflow.`);
  }

  wires.filter(w => w.voltageDropPct > 3).forEach(w => {
    warnings.push(`VOLTAGE DROP: ${w.label} has ${w.voltageDropPct.toFixed(1)}% drop (max 3%)`);
  });

  // Bulkhead capacity warning
  if (hasBulkhead && bulkheadDevice) {
    const pinsUsed = bulkheadPinCounter - 1;
    const pinsAvail = bulkheadDevice.pin_count || 0;
    if (pinsUsed > pinsAvail) {
      warnings.push(`BULKHEAD OVERFLOW: ${pinsUsed} wires through bulkhead but connector only has ${pinsAvail} pins`);
    } else if (pinsAvail - pinsUsed <= 5) {
      warnings.push(`BULKHEAD HEADROOM: Only ${pinsAvail - pinsUsed} spare pins on ${bulkheadDevice.device_name}`);
    }
  }

  // Collect available zones
  const zoneSet = new Set<string>();
  for (const d of devices) {
    if (d.location_zone && d.pin_count && d.pin_count > 0) {
      zoneSet.add(d.location_zone);
    }
  }

  return {
    vehicle_id: vehicleId,
    computed_at: new Date().toISOString(),
    summary: {
      total_devices: devices.length,
      total_wires: wires.length,
      total_wire_length_ft: Math.round(totalWireLength),
      shielded_wires: wires.filter(w => w.isShielded).length,
      twisted_pairs: wires.filter(w => w.isTwistedPair).length,
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
    wires,
    warnings,
    available_zones: Array.from(zoneSet).sort(),
    bulkhead: {
      present: hasBulkhead,
      device_name: bulkheadDevice?.device_name || null,
      pins_used: bulkheadPinCounter - 1,
      pins_available: bulkheadDevice?.pin_count || 0,
    },
  };
}

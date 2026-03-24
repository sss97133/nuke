// overlayCompute.ts — Client-side harness computation engine
// Runs synchronously in browser on every manifest change (<5ms target)
// No network calls. No async. Pure functions. Instant feedback.

import { selectWireGauge, suggestFuseRating } from './harnessCalculations';

// ── Types ───────────────────────────────────────────────────────────

export interface ManifestDevice {
  id: string;
  device_name: string;
  device_category: string;
  manufacturer?: string;
  model_number?: string;
  part_number?: string;
  pin_count?: number;
  power_draw_amps?: number;
  signal_type?: string;
  requires_shielding?: boolean;
  connector_type?: string;
  wire_gauge_recommended?: number;
  location_zone?: string;
  layer?: string;
  pos_x_pct?: number;
  pos_y_pct?: number;
  price?: number;
  purchased?: boolean;
  pdm_controlled?: boolean;
  pdm_channel_group?: string;
  pct_complete?: number;
  status?: string;
  product_image_url?: string;
}

export interface WireSpec {
  wireNumber: number;
  label: string;
  from: string;
  to: string;
  gauge: number;
  color: string;
  lengthFt: number;
  isShielded: boolean;
  isTwistedPair: boolean;
  signalType: string;
  voltageDrop: number;
  voltageDropPct: number;
  pdmChannel?: number;
  fuseRating?: number;
}

export interface PDMChannel {
  channel: number;
  maxAmps: number;
  label: string;
  devices: string[];
  totalAmps: number;
}

export interface ECUOption {
  model: string;
  price: number;
  fits: boolean;
  headroom: string;
  reason: string;
  injectorOutputs: number;
  ignitionOutputs: number;
  halfBridgeOutputs: number;
  analogInputs: number;
  tempInputs: number;
  digitalInputs: number;
}

export interface PDMOption {
  config: string;
  totalChannels: number;
  channelsUsed: number;
  headroom: number;
  price: number;
  fits: boolean;
}

export interface HarnessConfig {
  ecu: ECUOption;
  pdm: PDMOption;
  label: string;
  totalCost: number;
}

export interface OverlayResult {
  // Counts
  deviceCount: number;
  wireCount: number;
  totalWireLengthFt: number;
  shieldedWires: number;
  twistedPairs: number;
  totalContinuousAmps: number;

  // IO requirements
  io: {
    injectorOutputs: number;
    ignitionOutputs: number;
    halfBridgeOutputs: number;
    analogInputs: number;
    tempInputs: number;
    digitalInputs: number;
    knockInputs: number;
    canBuses: number;
  };

  // Options (NOT a single answer)
  ecuOptions: ECUOption[];
  pdmOptions: PDMOption[];
  recommendedConfig: HarnessConfig;
  alternativeConfigs: HarnessConfig[];

  // PDM channels for current config
  pdmChannels: PDMChannel[];

  // Alternator
  alternatorAmps: number;
  alternatorRecommendation: string;

  // Wires
  wires: WireSpec[];

  // Warnings
  warnings: string[];

  // Cost
  partsCost: number;
  devicesPurchased: number;
  devicesUnpurchased: number;

  // Completeness
  avgCompletion: number;
  devicesAtZero: number;
}

// ── ECU Specs ───────────────────────────────────────────────────────

interface ECUSpec {
  model: string;
  price: number;
  injectorOutputs: number;
  ignitionOutputs: number;
  halfBridgeOutputs: number;
  analogInputs: number;
  tempInputs: number;
  digitalInputs: number;
  canBuses: number;
  knockInputs: number;
}

// ECU specs from manufacturer datasheets — NOT hallucinated
// M130: racespeconline.com product page (verified)
// M150: motec.com.au datasheet (scaffold — needs manual validation)
// M1: estimated from M1 platform documentation
const ECU_SPECS: ECUSpec[] = [
  {
    model: 'M130', price: 3500,
    // Source: racespeconline.com/products/motec-m130-ecu
    // 2 connectors: 34-pin + 26-pin Superseal. 107×127×39mm, 290g.
    injectorOutputs: 8,    // 8 Peak & Hold
    ignitionOutputs: 8,    // 8 Lowside
    halfBridgeOutputs: 6,  // 6 Half Bridge
    analogInputs: 8,       // 8 Analog Voltage
    tempInputs: 4,         // 4 Analog Temperature
    digitalInputs: 7,      // 7 Universal Digital (NOT 8 — corrected from verified source)
    canBuses: 1,           // 1 CAN
    knockInputs: 2,        // 2 Knock
  },
  {
    model: 'M150', price: 5500,
    // Source: motec.com.au (scaffold — 4 connectors: 2×34 + 2×26 Superseal. 162×127×40mm, 445g)
    injectorOutputs: 12,   // 12 Peak & Hold (A1-A12)
    ignitionOutputs: 12,   // 12 Lowside (A13-A20 + D5-D7 + A23)
    halfBridgeOutputs: 10, // 10 Half Bridge (A26-A31, A33-A34, C17-C18)
    analogInputs: 17,      // 17 Analog Voltage (B1-B12, C19-C23)
    tempInputs: 6,         // 6 Analog Temperature (B16-B22)
    digitalInputs: 16,     // 16 Digital (B23-B28, B33-B34, C13-C16, D8-D11)
    canBuses: 3,           // 3 CAN (C1/C2, C3/C4, D23/D24)
    knockInputs: 2,        // 2 Knock (B29-B30)
  },
  {
    model: 'M1', price: 8000,
    // Source: estimated from M1 platform specs — needs validation
    injectorOutputs: 16,
    ignitionOutputs: 16,
    halfBridgeOutputs: 16,
    analogInputs: 24,
    tempInputs: 8,
    digitalInputs: 24,
    canBuses: 4,
    knockInputs: 4,
  },
];

// ── PDM Specs ───────────────────────────────────────────────────────

interface PDMSpec {
  config: string;
  price: number;
  channels: { count: number; maxAmps: number }[];
}

// PDM specs from MoTeC PDM User Manual p39 — VALIDATED
// PDM30: 8×20A (dual-pin, 115A transient) + 22×8A (60A transient) = 30 outputs
// PDM15: 8×20A + 7×8A = 15 outputs (same pins, fewer populated)
// Connectors: 34-pin + 26-pin Superseal 1.0 (TE 4-1437290-0 / 3-1437290-7) + M6 stud
// 16 switch inputs, CAN bus, battery backup
const PDM_SPECS: PDMSpec[] = [
  {
    config: 'PDM15', price: 2200,
    channels: [
      { count: 8, maxAmps: 20 },   // OUT1-OUT8 (dual-pin paralleled)
      { count: 7, maxAmps: 8 },    // OUT9-OUT15
    ],
  },
  {
    config: 'PDM30', price: 3140,
    channels: [
      { count: 8, maxAmps: 20 },   // OUT1-OUT8 (dual-pin: A01+A10, A03+A12, A05+A14, A07+A16, A09+A17, B03+B09, B05+B11, B07+B13)
      { count: 22, maxAmps: 8 },   // OUT9-OUT30 (single pin each, 60A transient)
    ],
  },
  {
    config: '2× PDM15', price: 4400,
    channels: [
      { count: 16, maxAmps: 20 },
      { count: 14, maxAmps: 8 },
    ],
  },
  {
    config: 'PDM30 + PDM15', price: 5340,
    channels: [
      { count: 16, maxAmps: 20 },  // 8 from PDM30 + 8 from PDM15
      { count: 29, maxAmps: 8 },   // 22 from PDM30 + 7 from PDM15
    ],
  },
];

// ── Color Assignment ────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  injector: 'GRN', ignition_coil: 'WHT', crank_cam: 'BLU/WHT',
  sensor_5v_ref: 'RED/BLK', sensor_signal: 'VIO', sensor_ground: 'BLK/WHT',
  temp_sensor: 'TAN', knock: 'GRY', o2_wideband: 'VIO/BLU',
  throttle_motor: 'ORG', tps_signal: 'DK BLU',
  can_high: 'WHT/GRN', can_low: 'GRN/WHT',
  headlight_high: 'LT GRN', headlight_low: 'TAN',
  tail_park: 'BRN', turn_left: 'LT BLU', turn_right: 'DK BLU',
  backup: 'LT GRN', brake: 'WHT',
  horn: 'DK GRN', wiper: 'PPL', door_trigger: 'GRY',
  window_motor: 'DK BLU', lock_motor: 'BLK',
  battery_positive: 'RED', ground: 'BLK',
  ignition_switched: 'PNK', accessory: 'ORN',
  pdm_high: 'RED/BLK', pdm_medium: 'ORN/BLK', pdm_low: 'YEL/BLK',
};

const STRIPES = ['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG', '/GRN', '/GRY', '/BRN', '/TAN'];

function assignColor(group: string, index: number): string {
  const base = COLOR_MAP[group] || 'WHT';
  return index === 0 ? base : base + (STRIPES[index % STRIPES.length] || '');
}

function classifyFunction(d: ManifestDevice): string {
  if (d.device_name.startsWith('Fuel Injector')) return 'injector';
  if (d.device_name.startsWith('Ignition Coil')) return 'ignition_coil';
  if (d.device_name.includes('Crank') || d.device_name.includes('Cam')) return 'crank_cam';
  if (d.signal_type === 'analog_temp') return 'temp_sensor';
  if (d.signal_type === 'piezoelectric') return 'knock';
  if (d.signal_type === 'wideband_lambda') return 'o2_wideband';
  if (d.signal_type === 'h_bridge_motor') return 'throttle_motor';
  if (d.signal_type === 'can_bus') return 'can_high';
  if (d.signal_type === 'analog_5v') return 'sensor_signal';
  if (d.signal_type === 'led_lighting') {
    if (d.device_name.includes('Headlight')) return 'headlight_high';
    if (d.device_name.includes('Tail')) return 'tail_park';
    if (d.device_name.includes('Turn') && d.device_name.includes('Left')) return 'turn_left';
    if (d.device_name.includes('Turn')) return 'turn_right';
    if (d.device_name.includes('Backup')) return 'backup';
    return 'tail_park';
  }
  if (d.signal_type === 'motor') {
    if (d.device_name.includes('Window')) return 'window_motor';
    if (d.device_name.includes('Lock')) return 'lock_motor';
    if (d.device_name.includes('Wiper')) return 'wiper';
    return 'pdm_medium';
  }
  if (d.signal_type === 'high_current') return 'pdm_high';
  if (d.signal_type === 'switch') return 'door_trigger';
  return 'accessory';
}

// ── Length Estimation ────────────────────────────────────────────────

const ZONE_LENGTHS: Record<string, number> = {
  engine_bay: 4, firewall: 2, dash: 3, doors: 6, rear: 16, underbody: 10, roof: 5,
};

function estimateLength(zone?: string): number {
  return (ZONE_LENGTHS[zone || 'dash'] || 5) * 1.15;
}

// ── Main Compute Function ───────────────────────────────────────────

export function computeOverlay(devices: ManifestDevice[]): OverlayResult {
  const warnings: string[] = [];

  // ── I/O Requirements ──
  const io = {
    injectorOutputs: devices.filter(d => d.device_name.startsWith('Fuel Injector')).length,
    ignitionOutputs: devices.filter(d => d.device_name.startsWith('Ignition Coil')).length,
    halfBridgeOutputs: devices.filter(d => d.signal_type === 'h_bridge_motor' || (d.signal_type === 'motor' && d.pdm_controlled === false)).length,
    analogInputs: devices.filter(d => d.signal_type?.startsWith('analog') && d.signal_type !== 'analog_temp').length,
    tempInputs: devices.filter(d => d.signal_type === 'analog_temp').length,
    digitalInputs: devices.filter(d => ['ecu_digital_input', 'digital'].includes(d.signal_type || '')).length,
    knockInputs: devices.filter(d => d.signal_type === 'piezoelectric').length,
    canBuses: devices.some(d => d.signal_type === 'can_bus') ? 2 : 1,
  };

  // ── ECU Options ──
  const ecuOptions: ECUOption[] = ECU_SPECS.map(spec => {
    const fits = spec.injectorOutputs >= io.injectorOutputs
      && spec.ignitionOutputs >= io.ignitionOutputs
      && spec.halfBridgeOutputs >= io.halfBridgeOutputs
      && spec.analogInputs >= io.analogInputs
      && spec.tempInputs >= io.tempInputs
      && spec.digitalInputs >= io.digitalInputs
      && spec.canBuses >= io.canBuses;

    const totalNeeded = io.injectorOutputs + io.ignitionOutputs + io.halfBridgeOutputs + io.analogInputs + io.tempInputs + io.digitalInputs;
    const totalAvail = spec.injectorOutputs + spec.ignitionOutputs + spec.halfBridgeOutputs + spec.analogInputs + spec.tempInputs + spec.digitalInputs;
    const headroom = fits ? `${Math.round((1 - totalNeeded / totalAvail) * 100)}% headroom` : 'INSUFFICIENT';

    // Find the bottleneck
    let reason = fits ? 'Fits all requirements' : '';
    if (!fits) {
      const bottlenecks: string[] = [];
      if (spec.injectorOutputs < io.injectorOutputs) bottlenecks.push(`injectors (need ${io.injectorOutputs}, has ${spec.injectorOutputs})`);
      if (spec.ignitionOutputs < io.ignitionOutputs) bottlenecks.push(`ignition (need ${io.ignitionOutputs}, has ${spec.ignitionOutputs})`);
      if (spec.halfBridgeOutputs < io.halfBridgeOutputs) bottlenecks.push(`half-bridge (need ${io.halfBridgeOutputs}, has ${spec.halfBridgeOutputs})`);
      if (spec.analogInputs < io.analogInputs) bottlenecks.push(`analog in (need ${io.analogInputs}, has ${spec.analogInputs})`);
      if (spec.tempInputs < io.tempInputs) bottlenecks.push(`temp in (need ${io.tempInputs}, has ${spec.tempInputs})`);
      if (spec.digitalInputs < io.digitalInputs) bottlenecks.push(`digital in (need ${io.digitalInputs}, has ${spec.digitalInputs})`);
      if (spec.canBuses < io.canBuses) bottlenecks.push(`CAN buses (need ${io.canBuses}, has ${spec.canBuses})`);
      reason = `Insufficient: ${bottlenecks.join(', ')}`;
    }

    return { model: spec.model, price: spec.price, fits, headroom, reason, ...spec };
  });

  // ── PDM Channel Assignment ──
  // Group devices by pdm_channel_group
  const channelGroups = new Map<string, { totalAmps: number; devices: string[] }>();
  const individualDevices: { label: string; amps: number; devices: string[] }[] = [];

  const pdmCandidates = devices.filter(d =>
    d.pdm_controlled !== false && (d.power_draw_amps || 0) > 0
    && d.signal_type !== 'power_source' && d.signal_type !== 'ground' && d.signal_type !== 'can_bus'
    && !d.device_name.startsWith('Fuel Injector') && !d.device_name.startsWith('Ignition Coil')
    && !d.device_name.startsWith('Throttle Position')
  );

  for (const d of pdmCandidates) {
    if (d.pdm_channel_group) {
      const g = channelGroups.get(d.pdm_channel_group) || { totalAmps: 0, devices: [] };
      g.totalAmps += d.power_draw_amps || 0;
      g.devices.push(d.device_name);
      channelGroups.set(d.pdm_channel_group, g);
    } else {
      individualDevices.push({ label: d.device_name, amps: d.power_draw_amps || 1, devices: [d.device_name] });
    }
  }
  channelGroups.forEach((g, name) => {
    individualDevices.push({ label: `[${name}] ${g.devices.length} devices`, amps: g.totalAmps, devices: g.devices });
  });
  individualDevices.sort((a, b) => b.amps - a.amps);

  // Assign to PDM30 outputs (real specs: OUT1-OUT8 = 20A, OUT9-OUT30 = 8A)
  const pdmChannels: PDMChannel[] = individualDevices.map((d, i) => {
    const outNum = i + 1;
    const maxAmps = outNum <= 8 ? 20 : 8; // Real PDM30: 8×20A + 22×8A
    return { channel: outNum, maxAmps, label: d.label, devices: d.devices, totalAmps: d.amps };
  });

  const channelsUsed = individualDevices.length;

  // ── PDM Options ──
  const pdmOptions: PDMOption[] = PDM_SPECS.map(spec => {
    const totalChannels = spec.channels.reduce((s, c) => s + c.count, 0);
    return {
      config: spec.config,
      totalChannels,
      channelsUsed,
      headroom: totalChannels - channelsUsed,
      price: spec.price,
      fits: channelsUsed <= totalChannels,
    };
  });

  // ── Build Configurations ──
  const configs: HarnessConfig[] = [];
  for (const ecu of ecuOptions) {
    if (!ecu.fits) continue;
    for (const pdm of pdmOptions) {
      if (!pdm.fits) continue;
      configs.push({
        ecu, pdm,
        label: `${ecu.model} + ${pdm.config}`,
        totalCost: ecu.price + pdm.price,
      });
    }
  }
  configs.sort((a, b) => a.totalCost - b.totalCost);

  const recommendedConfig = configs[0] || {
    ecu: ecuOptions.find(e => e.fits) || ecuOptions[ecuOptions.length - 1],
    pdm: pdmOptions.find(p => p.fits) || pdmOptions[pdmOptions.length - 1],
    label: 'No valid config — expand I/O',
    totalCost: 0,
  };

  // ── Alternator ──
  const totalContinuousAmps = devices
    .filter(d => (d.power_draw_amps || 0) > 0 && d.signal_type !== 'power_source')
    .reduce((s, d) => s + (d.power_draw_amps || 0), 0);

  const altRequired = Math.ceil(totalContinuousAmps * 1.25);
  const altRecommendation = altRequired <= 80 ? '80A stock'
    : altRequired <= 105 ? '105A stock high-output'
    : altRequired <= 145 ? '145A CS130D'
    : altRequired <= 180 ? '180A AD244'
    : altRequired <= 220 ? '220A AD244'
    : `${altRequired}A+ (dual alternator)`;

  // ── Wires ──
  const wires: WireSpec[] = [];
  let wireNum = 1;
  const funcCounters: Record<string, number> = {};

  for (const d of devices) {
    if (!d.pin_count || d.pin_count === 0) continue;
    if (d.signal_type === 'ground' || d.signal_type === 'power_source') continue;

    const amps = d.power_draw_amps || 1;
    const len = estimateLength(d.location_zone);
    const gaugeResult = selectWireGauge({ amperage: amps, lengthFt: len });
    const funcGroup = classifyFunction(d);
    const idx = funcCounters[funcGroup] || 0;
    funcCounters[funcGroup] = idx + 1;
    const color = assignColor(funcGroup, idx);

    const pdmCh = pdmChannels.find(c => c.devices.includes(d.device_name));

    wires.push({
      wireNumber: wireNum++,
      label: d.device_name,
      from: pdmCh ? `PDM30:OUT${pdmCh.channel}` : 'ECU',
      to: d.device_name,
      gauge: d.wire_gauge_recommended || (typeof gaugeResult.gauge === 'string' ? parseInt(gaugeResult.gauge) : gaugeResult.gauge),
      color,
      lengthFt: len,
      isShielded: d.requires_shielding || false,
      isTwistedPair: d.signal_type === 'can_bus',
      signalType: d.signal_type || 'unknown',
      voltageDrop: gaugeResult.actualVoltageDrop,
      voltageDropPct: gaugeResult.voltageDropPercent,
      pdmChannel: pdmCh?.channel,
      fuseRating: !pdmCh && amps > 1 ? suggestFuseRating(amps) : undefined,
    });

    if (gaugeResult.voltageDropPercent > 3) {
      warnings.push(`${d.device_name}: ${gaugeResult.voltageDropPercent.toFixed(1)}% voltage drop`);
    }
  }

  // PDM headroom warning
  const bestPdm = pdmOptions.find(p => p.fits);
  if (bestPdm && bestPdm.headroom <= 2) {
    warnings.push(`PDM: ${bestPdm.headroom} channels remaining on ${bestPdm.config}`);
  }
  if (!bestPdm) {
    warnings.push('PDM: No single PDM configuration fits. Need dual PDM setup.');
  }

  // Channel overloads
  pdmChannels.forEach(ch => {
    if (ch.channel <= 30 && ch.totalAmps > ch.maxAmps) {
      warnings.push(`PDM30 OUT${ch.channel} (${ch.label}): ${ch.totalAmps}A exceeds ${ch.maxAmps}A continuous`);
    }
  });

  // Costs
  const partsCost = devices.reduce((s, d) => s + (d.price || 0), 0);
  const devicesPurchased = devices.filter(d => d.purchased).length;
  const devicesUnpurchased = devices.filter(d => !d.purchased).length;
  const avgCompletion = Math.round(devices.reduce((s, d) => s + (d.pct_complete || 0), 0) / devices.length);
  const devicesAtZero = devices.filter(d => (d.pct_complete || 0) === 0).length;

  return {
    deviceCount: devices.length,
    wireCount: wires.length,
    totalWireLengthFt: Math.round(wires.reduce((s, w) => s + w.lengthFt, 0)),
    shieldedWires: wires.filter(w => w.isShielded).length,
    twistedPairs: wires.filter(w => w.isTwistedPair).length,
    totalContinuousAmps: Math.round(totalContinuousAmps),
    io,
    ecuOptions,
    pdmOptions,
    recommendedConfig,
    alternativeConfigs: configs.slice(1),
    pdmChannels,
    alternatorAmps: altRequired,
    alternatorRecommendation: altRecommendation,
    wires,
    warnings,
    partsCost,
    devicesPurchased,
    devicesUnpurchased,
    avgCompletion,
    devicesAtZero,
  };
}

// ── Delta Computation ───────────────────────────────────────────────
// Compare two overlay results to show what changed

export interface OverlayDelta {
  devicesDelta: number;
  wiresDelta: number;
  wireLengthDelta: number;
  ampsDelta: number;
  ecuChanged: boolean;
  ecuBefore?: string;
  ecuAfter?: string;
  pdmChannelsDelta: number;
  costDelta: number;
  newWarnings: string[];
  resolvedWarnings: string[];
}

export function computeDelta(before: OverlayResult, after: OverlayResult): OverlayDelta {
  return {
    devicesDelta: after.deviceCount - before.deviceCount,
    wiresDelta: after.wireCount - before.wireCount,
    wireLengthDelta: after.totalWireLengthFt - before.totalWireLengthFt,
    ampsDelta: after.totalContinuousAmps - before.totalContinuousAmps,
    ecuChanged: before.recommendedConfig.ecu.model !== after.recommendedConfig.ecu.model,
    ecuBefore: before.recommendedConfig.ecu.model,
    ecuAfter: after.recommendedConfig.ecu.model,
    pdmChannelsDelta: after.pdmChannels.length - before.pdmChannels.length,
    costDelta: after.partsCost - before.partsCost,
    newWarnings: after.warnings.filter(w => !before.warnings.includes(w)),
    resolvedWarnings: before.warnings.filter(w => !after.warnings.includes(w)),
  };
}

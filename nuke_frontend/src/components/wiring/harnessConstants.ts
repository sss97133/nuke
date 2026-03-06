// harnessConstants.ts — Engineering reference data for wire gauge selection, colors, lengths

// AWG copper wire resistance and ampacity table
// Resistance in ohms per foot at 20°C
// Max amps for chassis wiring (enclosed bundle, not free air)
export const AWG_TABLE: { gauge: string; ohmPerFt: number; maxAmps: number }[] = [
  { gauge: '22 AWG', ohmPerFt: 0.01614, maxAmps: 5 },
  { gauge: '20 AWG', ohmPerFt: 0.01015, maxAmps: 7.5 },
  { gauge: '18 AWG', ohmPerFt: 0.00639, maxAmps: 10 },
  { gauge: '16 AWG', ohmPerFt: 0.00402, maxAmps: 15 },
  { gauge: '14 AWG', ohmPerFt: 0.00253, maxAmps: 20 },
  { gauge: '12 AWG', ohmPerFt: 0.00159, maxAmps: 25 },
  { gauge: '10 AWG', ohmPerFt: 0.00100, maxAmps: 35 },
  { gauge: '8 AWG',  ohmPerFt: 0.000628, maxAmps: 50 },
  { gauge: '6 AWG',  ohmPerFt: 0.000395, maxAmps: 65 },
  { gauge: '4 AWG',  ohmPerFt: 0.000249, maxAmps: 85 },
  { gauge: '2 AWG',  ohmPerFt: 0.000156, maxAmps: 115 },
  { gauge: '0 AWG',  ohmPerFt: 0.0000983, maxAmps: 150 },
];

// Default max voltage drop: 3% of system voltage
export const DEFAULT_MAX_VOLTAGE_DROP_PERCENT = 0.03;

// Wire color standards — maps function to recommended color
export const WIRE_COLOR_STANDARDS: Record<string, { primary: string; label: string }> = {
  battery_positive:   { primary: 'RED',       label: 'Red' },
  ground:             { primary: 'BLK',       label: 'Black' },
  ignition_switched:  { primary: 'YEL',       label: 'Yellow' },
  starter:            { primary: 'RED/WHT',   label: 'Red/White' },
  alternator_field:   { primary: 'BLU',       label: 'Blue' },
  alternator_output:  { primary: 'RED',       label: 'Red' },
  headlights:         { primary: 'GRN',       label: 'Green' },
  headlights_high:    { primary: 'GRN/WHT',   label: 'Green/White' },
  tail_lights:        { primary: 'BRN',       label: 'Brown' },
  brake_lights:       { primary: 'WHT/RED',   label: 'White/Red' },
  turn_signal_left:   { primary: 'LT GRN',    label: 'Light Green' },
  turn_signal_right:  { primary: 'DK GRN',    label: 'Dark Green' },
  reverse_lights:     { primary: 'WHT',       label: 'White' },
  horn:               { primary: 'LT BLU',    label: 'Light Blue' },
  fuel_pump:          { primary: 'PNK',       label: 'Pink' },
  injectors:          { primary: 'RED/BLK',   label: 'Red/Black' },
  coils:              { primary: 'WHT',       label: 'White' },
  sensors:            { primary: 'VIO',       label: 'Violet' },
  sensor_ground:      { primary: 'BLK',       label: 'Black' },
  sensor_5v:          { primary: 'RED/VIO',   label: 'Red/Violet' },
  can_high:           { primary: 'WHT/GRN',   label: 'White/Green' },
  can_low:            { primary: 'GRN/WHT',   label: 'Green/White' },
  wiper:              { primary: 'DK BLU',    label: 'Dark Blue' },
  washer:             { primary: 'DK BLU/WHT',label: 'Dark Blue/White' },
  radio:              { primary: 'ORG',       label: 'Orange' },
  interior_lights:    { primary: 'ORG',       label: 'Orange' },
  dash_illumination:  { primary: 'GRY',       label: 'Grey' },
  coolant_fan:        { primary: 'BLU',       label: 'Blue' },
  ac_compressor:      { primary: 'BLU/WHT',   label: 'Blue/White' },
  power_windows:      { primary: 'TAN',       label: 'Tan' },
  door_locks:         { primary: 'TAN/WHT',   label: 'Tan/White' },
};

// All available wire colors for dropdown
export const ALL_WIRE_COLORS = [
  'RED', 'BLK', 'WHT', 'GRN', 'BLU', 'YEL', 'ORG', 'BRN', 'VIO', 'PNK',
  'GRY', 'TAN', 'LT GRN', 'DK GRN', 'LT BLU', 'DK BLU',
  'RED/WHT', 'RED/BLK', 'RED/VIO', 'WHT/RED', 'WHT/GRN', 'WHT/BLK',
  'GRN/WHT', 'GRN/BLK', 'BLU/WHT', 'BLU/BLK', 'YEL/BLK',
  'BRN/WHT', 'ORG/WHT', 'VIO/WHT', 'PNK/BLK', 'GRY/BLK',
  'DK BLU/WHT', 'TAN/WHT',
];

// Map system_category to a wire color recommendation function
export function suggestWireColor(
  fromCategory: string | null,
  toCategory: string | null,
  fromType: string | null,
  toType: string | null
): string | null {
  // Ground wires
  if (fromType === 'ground' || toType === 'ground') return 'BLK';
  // Power source
  if (fromType === 'power_source' || toType === 'power_source') return 'RED';

  const cat = toCategory || fromCategory;
  if (!cat) return null;

  const mapping: Record<string, string> = {
    lighting: 'GRN',
    engine_management: 'VIO',
    starting: 'RED/WHT',
    charging: 'RED',
    fuel: 'PNK',
    cooling: 'BLU',
    body: 'DK BLU',
    audio: 'ORG',
    gauges: 'GRY',
    safety: 'WHT/RED',
    controls: 'GRY',
    power_distribution: 'RED',
    transmission: 'YEL',
  };

  return mapping[cat] || null;
}

// Typical wire lengths by vehicle type and route (in feet)
// These are generous — "you trim the ends"
export const TYPICAL_LENGTHS: Record<string, Record<string, number>> = {
  hot_rod: {
    engine_bay_to_engine_bay: 2,
    engine_bay_to_firewall: 3,
    firewall_to_dash: 2,
    dash_to_dash: 1.5,
    dash_to_rear: 10,
    dash_to_doors: 3,
    engine_bay_to_rear: 14,
    engine_bay_to_doors: 5,
    rear_to_rear: 2,
    underbody_to_underbody: 3,
    underbody_to_rear: 8,
    firewall_to_rear: 12,
    firewall_to_doors: 4,
  },
  car: {
    engine_bay_to_engine_bay: 2.5,
    engine_bay_to_firewall: 3,
    firewall_to_dash: 2.5,
    dash_to_dash: 2,
    dash_to_rear: 12,
    dash_to_doors: 4,
    engine_bay_to_rear: 16,
    engine_bay_to_doors: 6,
    rear_to_rear: 2.5,
    underbody_to_underbody: 3,
    underbody_to_rear: 10,
    firewall_to_rear: 14,
    firewall_to_doors: 5,
  },
  truck: {
    engine_bay_to_engine_bay: 3,
    engine_bay_to_firewall: 3.5,
    firewall_to_dash: 3,
    dash_to_dash: 2.5,
    dash_to_rear: 16,
    dash_to_doors: 4,
    engine_bay_to_rear: 20,
    engine_bay_to_doors: 6,
    rear_to_rear: 3,
    underbody_to_underbody: 4,
    underbody_to_rear: 12,
    firewall_to_rear: 18,
    firewall_to_doors: 5,
  },
  race_car: {
    engine_bay_to_engine_bay: 2,
    engine_bay_to_firewall: 2.5,
    firewall_to_dash: 2,
    dash_to_dash: 1.5,
    dash_to_rear: 8,
    dash_to_doors: 3,
    engine_bay_to_rear: 12,
    engine_bay_to_doors: 4,
    rear_to_rear: 2,
    underbody_to_underbody: 2.5,
    underbody_to_rear: 7,
    firewall_to_rear: 10,
    firewall_to_doors: 3.5,
  },
};

// Slack multiplier — add 15% for routing, bends, and service loops
export const SLACK_MULTIPLIER = 1.15;

// Estimate wire length between two location zones
export function estimateLength(
  vehicleType: string | null,
  fromZone: string | null,
  toZone: string | null
): number {
  if (!fromZone || !toZone) return 5; // default 5ft if unknown

  const type = vehicleType || 'car';
  const lengths = TYPICAL_LENGTHS[type] || TYPICAL_LENGTHS.car;

  // Normalize zone pair to a lookup key (alphabetical)
  const zones = [fromZone, toZone].sort();
  const key = `${zones[0]}_to_${zones[1]}`;

  // Try direct match
  if (lengths[key]) return Math.round(lengths[key] * SLACK_MULTIPLIER * 10) / 10;

  // Try reverse
  const reverseKey = `${zones[1]}_to_${zones[0]}`;
  if (lengths[reverseKey]) return Math.round(lengths[reverseKey] * SLACK_MULTIPLIER * 10) / 10;

  // Same zone
  if (fromZone === toZone) {
    const sameKey = `${fromZone}_to_${fromZone}`;
    if (lengths[sameKey]) return Math.round(lengths[sameKey] * SLACK_MULTIPLIER * 10) / 10;
    return 2; // short run in same zone
  }

  return 6; // fallback for unknown routes
}

// Connector types dropdown
export const CONNECTOR_TYPES = [
  { value: 'autosport', label: 'Deutsch Autosport (MIL-Spec)' },
  { value: 'deutsch_dt', label: 'Deutsch DT (Heavy Duty)' },
  { value: 'deutsch_dtm', label: 'Deutsch DTM (Motorsport)' },
  { value: 'deutsch_369', label: 'Deutsch 369 (High Temp)' },
  { value: 'superseal', label: 'Tyco Superseal 1.0 (MoTeC OEM)' },
  { value: 'weatherpack', label: 'Weatherpack (OEM Sealed)' },
  { value: 'packard', label: 'Packard / Metri-Pack' },
  { value: 'uscar_ev6', label: 'USCAR / EV6 (Injector)' },
  { value: 'iso', label: 'ISO (Radio/Audio)' },
  { value: 'ring_terminal', label: 'Ring Terminal' },
  { value: 'butt_splice', label: 'Butt Splice' },
  { value: 'custom', label: 'Custom' },
];

// Location zones
export const LOCATION_ZONES = [
  { value: 'engine_bay', label: 'Engine Bay' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'dash', label: 'Dashboard / Cockpit' },
  { value: 'doors', label: 'Doors' },
  { value: 'rear', label: 'Rear / Trunk / Bed' },
  { value: 'underbody', label: 'Underbody / Chassis' },
  { value: 'roof', label: 'Roof' },
];

// Section type colors (defaults)
export const SECTION_COLORS: Record<string, string> = {
  engine: '#d13438',
  transmission: '#b05a00',
  chassis: '#16825d',
  interior: '#0078d4',
  body: '#8764b8',
  lighting: '#e3a61c',
  fuel: '#c239b3',
  cooling: '#00b7c3',
  audio: '#7a7574',
  accessories: '#486860',
  custom: '#767676',
};

// Endpoint type labels
export const ENDPOINT_TYPE_LABELS: Record<string, string> = {
  power_source: 'POWER SOURCE',
  power_distribution: 'PDM / DISTRIBUTION',
  ecu: 'ECU / CONTROLLER',
  sensor: 'SENSOR',
  actuator: 'ACTUATOR / LOAD',
  switch: 'SWITCH / INPUT',
  ground: 'GROUND',
  connector: 'CONNECTOR / DISCONNECT',
  splice: 'SPLICE',
  relay: 'RELAY',
  fuse: 'FUSE / BREAKER',
  display: 'DISPLAY / GAUGE',
  custom: 'CUSTOM',
};

// System category labels
export const SYSTEM_CATEGORY_LABELS: Record<string, string> = {
  lighting: 'Lighting',
  starting: 'Starting',
  charging: 'Charging',
  engine_management: 'Engine Management',
  fuel: 'Fuel System',
  cooling: 'Cooling',
  body: 'Body / Comfort',
  audio: 'Audio',
  gauges: 'Gauges / Display',
  safety: 'Safety',
  controls: 'Controls',
  power_distribution: 'Power Distribution',
  transmission: 'Transmission',
};

// generateSpliceCAD.ts — Export harness design as Splice CAD-compatible JSON
// Splice CAD uses: Harness > Components (Connector/Wire) > Connections
// Ref: https://github.com/splice-cad/splice-py

import type { OverlayResult, ManifestDevice, WireSpec } from './overlayCompute';
import type { TerminationRecord } from './terminationCompute';

// ── Splice CAD JSON Types ────────────────────────────────────────────

interface SpliceWire {
  awg: number;
  color: string;
  stranding?: string;
  mpn?: string;
  manufacturer?: string;
}

interface SplicePin {
  index: number;
  label: string;
  signal_type?: string;
}

interface SpliceConnector {
  type: 'connector';
  name: string;
  mpn?: string;
  manufacturer?: string;
  pin_count: number;
  pins: SplicePin[];
  location?: string;
  notes?: string;
}

interface SpliceConnection {
  from: { component: string; pin: number };
  to: { component: string; pin: number };
  wire: SpliceWire;
  length_mm?: number;
  label?: string;
}

interface SpliceBundleLabel {
  text: string;
  width_mm?: number;
  font_size?: number;
}

interface SpliceHarness {
  name: string;
  description?: string;
  components: SpliceConnector[];
  connections: SpliceConnection[];
  labels?: SpliceBundleLabel[];
  metadata?: Record<string, string>;
}

// ── IEC 60757 wire color mapping ────────────────────────────────────
const COLOR_MAP: Record<string, string> = {
  'RED': 'red', 'BLK': 'black', 'WHT': 'white', 'GRN': 'green', 'BLU': 'blue',
  'YEL': 'yellow', 'ORG': 'orange', 'BRN': 'brown', 'VIO': 'violet', 'PNK': 'pink',
  'GRY': 'gray', 'TAN': 'tan', 'LT GRN': 'light_green', 'DK GRN': 'dark_green',
  'LT BLU': 'light_blue', 'DK BLU': 'dark_blue', 'PPL': 'purple',
};

function toSpliceColor(wireColor: string): string {
  return COLOR_MAP[wireColor] || wireColor.toLowerCase().replace(/\s+/g, '_');
}

// ── Generator ─────────────────────────────────────────────────────────

export function generateSpliceCAD(
  result: OverlayResult,
  devices: ManifestDevice[],
  vehicleName = '',
  terminations?: TerminationRecord[],
): SpliceHarness {
  const components: SpliceConnector[] = [];
  const connections: SpliceConnection[] = [];

  // ── ECU Connector ──
  const ecuWires = result.wires.filter(w => w.from === 'ECU');
  if (ecuWires.length > 0) {
    components.push({
      type: 'connector',
      name: 'ECU',
      mpn: result.recommendedConfig.ecu.model,
      manufacturer: 'MoTeC',
      pin_count: ecuWires.length,
      pins: ecuWires.map((w, i) => ({
        index: i + 1,
        label: w.label,
        signal_type: w.signalType,
      })),
      location: 'dash',
    });
  }

  // ── PDM Connector ──
  const pdmWires = result.wires.filter(w => w.from.startsWith('PDM'));
  if (pdmWires.length > 0) {
    components.push({
      type: 'connector',
      name: 'PDM',
      mpn: result.recommendedConfig.pdm.config,
      manufacturer: 'MoTeC',
      pin_count: pdmWires.length,
      pins: pdmWires.map((w, i) => ({
        index: i + 1,
        label: w.label,
        signal_type: 'pdm_output',
      })),
      location: 'dash',
    });
  }

  // ── Device Connectors ──
  const devicePinMap = new Map<string, number>(); // device_name -> next available pin
  for (const d of devices) {
    if (d.signal_type === 'ground' || d.signal_type === 'power_source') continue;
    if (!d.pin_count || d.pin_count === 0) continue;

    const pinCount = d.pin_count || 2;
    devicePinMap.set(d.device_name, 1);

    components.push({
      type: 'connector',
      name: d.device_name,
      mpn: d.part_number || undefined,
      manufacturer: d.manufacturer || undefined,
      pin_count: pinCount,
      pins: Array.from({ length: pinCount }, (_, i) => ({
        index: i + 1,
        label: i === 0 ? 'Signal/Power' : i === 1 ? 'Ground' : `Pin ${i + 1}`,
      })),
      location: d.location_zone || undefined,
      notes: d.connector_type || undefined,
    });
  }

  // ── Connections (wires) ──
  let ecuPin = 1;
  let pdmPin = 1;
  for (const w of result.wires) {
    const fromComponent = w.from === 'ECU' ? 'ECU' : 'PDM';
    const fromPin = w.from === 'ECU' ? ecuPin++ : pdmPin++;

    connections.push({
      from: { component: fromComponent, pin: fromPin },
      to: { component: w.to, pin: 1 },
      wire: {
        awg: w.gauge,
        color: toSpliceColor(w.color),
        stranding: w.isShielded ? 'shielded_2c' : w.isTwistedPair ? 'twisted_pair' : 'stranded',
      },
      length_mm: Math.round(w.lengthFt * 304.8),
      label: `W${w.wireNumber}`,
    });
  }

  return {
    name: vehicleName || 'Harness Design',
    description: `${result.deviceCount} devices, ${result.wireCount} wires, ${result.totalWireLengthFt}ft total`,
    components,
    connections,
    labels: [
      { text: vehicleName || 'Custom Harness' },
      { text: `Generated ${new Date().toLocaleDateString()}` },
    ],
    metadata: {
      generator: 'nuke-wiring',
      ecu_model: result.recommendedConfig.ecu.model,
      pdm_config: result.recommendedConfig.pdm.config,
      total_wire_ft: String(result.totalWireLengthFt),
    },
  };
}

export function spliceCADToJson(harness: SpliceHarness): string {
  return JSON.stringify(harness, null, 2);
}

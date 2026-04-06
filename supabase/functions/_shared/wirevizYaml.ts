// wirevizYaml.ts — Generate WireViz YAML from computed wiring overlay
// Ported from nuke_frontend/src/components/wiring/generateWireVizYaml.ts
// WireViz syntax: https://github.com/wireviz/WireViz/blob/master/docs/syntax.md
// Renders via Kroki.io: POST https://kroki.io/wireviz/svg

import type { WireSpec, ComputeResult } from './wiringCompute.ts';

// ── IEC 60757 color code mapping (WireViz uses these) ─────────────
const WIRE_COLOR_TO_IEC: Record<string, string> = {
  'RED': 'RD', 'BLK': 'BK', 'WHT': 'WH', 'GRN': 'GN', 'BLU': 'BU',
  'YEL': 'YE', 'ORG': 'OG', 'BRN': 'BN', 'VIO': 'VT', 'PNK': 'PK',
  'GRY': 'GY', 'TAN': 'BN', 'LT GRN': 'GNYE', 'DK GRN': 'GN',
  'LT BLU': 'BU', 'DK BLU': 'BU', 'PPL': 'VT',
};

export function toIecColor(wireColor: string): string {
  const parts = wireColor.split('/');
  return parts.map(p => WIRE_COLOR_TO_IEC[p.trim()] || p.substring(0, 2).toUpperCase()).join('');
}

// ── Safe YAML identifier ──────────────────────────────────────────
// Prefixed with D_ to avoid collisions with ECU/PDM connector names
export function safeId(name: string): string {
  const raw = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  // Prevent collision with our central connector names
  if (raw === 'ECU' || raw === 'PDM') return `D_${raw}`;
  return raw;
}

// ── Group devices by zone ─────────────────────────────────────────
// deno-lint-ignore no-explicit-any
export function groupByZone(devices: any[]): Map<string, any[]> {
  const zones = new Map<string, any[]>();
  for (const d of devices) {
    const zone = d.location_zone || 'other';
    const list = zones.get(zone) || [];
    list.push(d);
    zones.set(zone, list);
  }
  return zones;
}

// ── Get available zone names ──────────────────────────────────────
// deno-lint-ignore no-explicit-any
export function getAvailableZones(devices: any[]): string[] {
  const zones = new Set<string>();
  for (const d of devices) {
    if (d.location_zone && d.pin_count && d.pin_count > 0) {
      zones.add(d.location_zone);
    }
  }
  return Array.from(zones).sort();
}

// ── Generate YAML for a system-level overview ─────────────────────
// deno-lint-ignore no-explicit-any
export function generateSystemOverviewYaml(devices: any[], result: ComputeResult): string {
  const lines: string[] = [];

  lines.push('metadata:');
  lines.push(`  title: 'Harness Overview — ${result.summary.total_devices} Devices, ${result.summary.total_wires} Wires'`);
  lines.push('');
  lines.push('options:');
  lines.push('  fontname: Arial');
  lines.push('  bgcolor: WH');
  lines.push('');

  // Connectors: ECU
  lines.push('connectors:');
  const ecuModel = result.ecu.model;
  const ecuWires = result.wires.filter(w => w.fromDevice === 'ECU');
  const pdmWires = result.wires.filter(w => w.fromDevice.startsWith('PDM'));

  lines.push('  ECU:');
  lines.push(`    type: 'MoTeC ${ecuModel}'`);
  lines.push('    subtype: female');
  lines.push(`    pincount: ${ecuWires.length || 1}`);
  if (ecuWires.length > 0) {
    const labels = ecuWires.map(w => {
      const name = w.toDevice.length > 20 ? w.toDevice.substring(0, 18) + '..' : w.toDevice;
      return `'${name.replace(/'/g, "''")}'`;
    });
    lines.push(`    pinlabels: [${labels.join(', ')}]`);
  }

  // Connectors: PDM
  if (pdmWires.length > 0) {
    lines.push('  PDM:');
    lines.push(`    type: 'MoTeC ${result.pdm.model}'`);
    lines.push('    subtype: female');
    lines.push(`    pincount: ${pdmWires.length}`);
    const pdmLabels = pdmWires.map(w => `'${w.fromDevice.replace('PDM30:', '')}'`);
    lines.push(`    pinlabels: [${pdmLabels.join(', ')}]`);
  }

  // Connectors: each device endpoint (only those that have wires)
  const wiredDeviceNames = new Set(result.wires.map(w => w.toDevice));
  for (const d of devices) {
    if (!wiredDeviceNames.has(d.device_name)) continue;
    const id = safeId(d.device_name);
    lines.push(`  ${id}:`);
    lines.push(`    type: '${(d.connector_type || d.device_category || 'device').replace(/'/g, "''")}'`);
    if (d.manufacturer) lines.push(`    manufacturer: '${d.manufacturer.replace(/'/g, "''")}'`);
    if (d.part_number) lines.push(`    pn: '${d.part_number}'`);
    lines.push(`    pincount: 1`);
    if (d.location_zone) lines.push(`    notes: '${d.location_zone.replace(/_/g, ' ')}'`);
  }

  lines.push('');

  // Cables: one cable per wire
  lines.push('cables:');
  for (const w of result.wires) {
    const id = `W${w.wireNumber}`;
    lines.push(`  ${id}:`);
    lines.push('    wirecount: 1');
    lines.push(`    gauge: ${w.gauge} AWG`);
    lines.push('    show_equiv: true');
    lines.push(`    length: ${(w.lengthFt * 0.3048).toFixed(1)} m`);
    lines.push(`    colors: [${toIecColor(w.color)}]`);
    if (w.isShielded) lines.push('    shield: true');
    if (w.fuseRating) lines.push(`    notes: 'Fuse ${w.fuseRating}A'`);
  }

  lines.push('');

  // Connections
  lines.push('connections:');
  let ecuPin = 1;
  let pdmPin = 1;
  for (const w of result.wires) {
    const deviceId = safeId(w.toDevice);
    const cableId = `W${w.wireNumber}`;
    if (w.fromDevice === 'ECU') {
      lines.push(`  -`);
      lines.push(`    - ECU: ${ecuPin++}`);
      lines.push(`    - ${cableId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    } else {
      lines.push(`  -`);
      lines.push(`    - PDM: ${pdmPin++}`);
      lines.push(`    - ${cableId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    }
  }

  return lines.join('\n');
}

// ── Generate YAML for a single zone ───────────────────────────────
// deno-lint-ignore no-explicit-any
export function generateZoneYaml(zoneName: string, zoneDevices: any[], wires: WireSpec[]): string {
  const zoneWires = wires.filter(w =>
    zoneDevices.some((d: any) => d.device_name === w.toDevice)
  );

  if (zoneWires.length === 0) return '';

  const ecuWires = zoneWires.filter(w => w.fromDevice === 'ECU');
  const pdmWires = zoneWires.filter(w => w.fromDevice.startsWith('PDM'));

  const lines: string[] = [];

  // Metadata
  lines.push('metadata:');
  lines.push(`  title: '${zoneName.replace(/_/g, ' ').toUpperCase()} — ${zoneDevices.length} Devices'`);
  lines.push('');
  lines.push('options:');
  lines.push('  fontname: Arial');
  lines.push('');

  // Connectors
  lines.push('connectors:');
  if (ecuWires.length > 0) {
    lines.push('  ECU:');
    lines.push('    type: ECU');
    lines.push(`    pincount: ${ecuWires.length}`);
    lines.push(`    pinlabels: [${ecuWires.map(w => `'${w.toDevice.substring(0, 22).replace(/'/g, '')}'`).join(', ')}]`);
  }
  if (pdmWires.length > 0) {
    lines.push('  PDM:');
    lines.push('    type: PDM');
    lines.push(`    pincount: ${pdmWires.length}`);
    lines.push(`    pinlabels: [${pdmWires.map(w => `'${w.fromDevice.replace('PDM30:', '')}'`).join(', ')}]`);
  }

  for (const d of zoneDevices) {
    if (!zoneWires.some(w => w.toDevice === d.device_name)) continue;
    const id = safeId(d.device_name);
    lines.push(`  ${id}:`);
    lines.push(`    type: '${(d.connector_type || d.device_category || 'device').replace(/'/g, '')}'`);
    lines.push('    pincount: 1');
    if (d.part_number) lines.push(`    pn: '${d.part_number}'`);
  }

  // Cables
  lines.push('');
  lines.push('cables:');
  for (const w of zoneWires) {
    lines.push(`  W${w.wireNumber}:`);
    lines.push('    wirecount: 1');
    lines.push(`    gauge: ${w.gauge} AWG`);
    lines.push('    show_equiv: true');
    lines.push(`    colors: [${toIecColor(w.color)}]`);
    lines.push(`    length: ${(w.lengthFt * 0.3048).toFixed(1)} m`);
    if (w.isShielded) lines.push('    shield: true');
  }

  // Connections
  lines.push('');
  lines.push('connections:');
  let ecuIdx = 1;
  let pdmIdx = 1;
  for (const w of zoneWires) {
    const deviceId = safeId(w.toDevice);
    const wireId = `W${w.wireNumber}`;
    if (w.fromDevice === 'ECU') {
      lines.push('  -');
      lines.push(`    - ECU: ${ecuIdx++}`);
      lines.push(`    - ${wireId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    } else {
      lines.push('  -');
      lines.push(`    - PDM: ${pdmIdx++}`);
      lines.push(`    - ${wireId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    }
  }

  return lines.join('\n');
}

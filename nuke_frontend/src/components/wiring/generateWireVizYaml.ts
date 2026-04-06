// generateWireVizYaml.ts — Convert build manifest + computed wires into WireViz YAML
// WireViz syntax: https://github.com/wireviz/WireViz/blob/master/docs/syntax.md
// Renders via Kroki.io: POST https://kroki.io/wireviz/svg

import type { ManifestDevice, WireSpec, PDMChannel, OverlayResult } from './overlayCompute';

// ── IEC 60757 color code mapping (WireViz uses these) ─────────────
const WIRE_COLOR_TO_IEC: Record<string, string> = {
  'RED': 'RD', 'BLK': 'BK', 'WHT': 'WH', 'GRN': 'GN', 'BLU': 'BU',
  'YEL': 'YE', 'ORG': 'OG', 'BRN': 'BN', 'VIO': 'VT', 'PNK': 'PK',
  'GRY': 'GY', 'TAN': 'BN', 'LT GRN': 'GNYE', 'DK GRN': 'GN',
  'LT BLU': 'BU', 'DK BLU': 'BU', 'PPL': 'VT',
};

function toIecColor(wireColor: string): string {
  // Handle compound colors like RED/WHT
  const parts = wireColor.split('/');
  return parts.map(p => WIRE_COLOR_TO_IEC[p.trim()] || p.substring(0, 2).toUpperCase()).join('');
}

// ── Safe YAML identifier ──────────────────────────────────────────
function safeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ── Group devices by zone ─────────────────────────────────────────
export function groupByZone(devices: ManifestDevice[]): Map<string, ManifestDevice[]> {
  const zones = new Map<string, ManifestDevice[]>();
  for (const d of devices) {
    const zone = d.location_zone || 'other';
    const list = zones.get(zone) || [];
    list.push(d);
    zones.set(zone, list);
  }
  return zones;
}

// ── Generate YAML for a system-level overview ─────────────────────
// Shows ECU + PDM as central connectors, all devices as endpoints
export function generateSystemOverviewYaml(
  devices: ManifestDevice[],
  result: OverlayResult,
): string {
  const lines: string[] = [];

  // Metadata
  lines.push('metadata:');
  lines.push(`  title: Harness Overview — ${result.deviceCount} Devices`);
  lines.push('');
  lines.push('options:');
  lines.push('  fontname: Arial');
  lines.push('  bgcolor: WH');
  lines.push('');

  // Connectors: ECU
  lines.push('connectors:');
  const ecuModel = result.recommendedConfig.ecu.model;
  lines.push(`  ECU:`);
  lines.push(`    type: MoTeC ${ecuModel}`);
  lines.push(`    subtype: female`);
  lines.push(`    pincount: ${result.wires.filter(w => w.from === 'ECU').length || 1}`);
  const ecuPinLabels = result.wires
    .filter(w => w.from === 'ECU')
    .map(w => w.to.length > 20 ? w.to.substring(0, 18) + '..' : w.to);
  if (ecuPinLabels.length > 0) {
    lines.push(`    pinlabels: [${ecuPinLabels.map(l => `'${l.replace(/'/g, "''")}'`).join(', ')}]`);
  }

  // Connectors: PDM
  const pdmWires = result.wires.filter(w => w.from.startsWith('PDM'));
  if (pdmWires.length > 0) {
    lines.push(`  PDM:`);
    lines.push(`    type: MoTeC ${result.recommendedConfig.pdm.config}`);
    lines.push(`    subtype: female`);
    lines.push(`    pincount: ${pdmWires.length}`);
    const pdmLabels = pdmWires.map(w => {
      const ch = w.from.replace('PDM30:', '');
      return `${ch}`;
    });
    lines.push(`    pinlabels: [${pdmLabels.map(l => `'${l}'`).join(', ')}]`);
  }

  // Connectors: each device
  for (const d of devices) {
    if (d.signal_type === 'ground' || d.signal_type === 'power_source') continue;
    if (!d.pin_count || d.pin_count === 0) continue;
    const id = safeId(d.device_name);
    lines.push(`  ${id}:`);
    lines.push(`    type: ${d.connector_type || d.device_category}`);
    if (d.manufacturer) lines.push(`    manufacturer: '${d.manufacturer}'`);
    if (d.part_number) lines.push(`    pn: '${d.part_number}'`);
    lines.push(`    pincount: ${Math.min(d.pin_count, 4)}`);
    if (d.location_zone) lines.push(`    notes: '${d.location_zone.replace(/_/g, ' ')}'`);
  }

  lines.push('');

  // Cables: one cable per wire
  lines.push('cables:');
  for (const w of result.wires) {
    const id = `W${w.wireNumber}`;
    lines.push(`  ${id}:`);
    lines.push(`    wirecount: 1`);
    lines.push(`    gauge: ${w.gauge} AWG`);
    lines.push(`    show_equiv: true`);
    lines.push(`    length: ${(w.lengthFt * 0.3048).toFixed(1)} m`);
    lines.push(`    colors: [${toIecColor(w.color)}]`);
    if (w.isShielded) lines.push(`    shield: true`);
    if (w.fuseRating) lines.push(`    notes: 'Fuse ${w.fuseRating}A'`);
  }

  lines.push('');

  // Connections
  lines.push('connections:');
  let ecuPin = 1;
  let pdmPin = 1;
  for (const w of result.wires) {
    const deviceId = safeId(w.to);
    const cableId = `W${w.wireNumber}`;
    if (w.from === 'ECU') {
      lines.push(`  - - ECU: ${ecuPin++}`);
      lines.push(`    - ${cableId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    } else {
      lines.push(`  - - PDM: ${pdmPin++}`);
      lines.push(`    - ${cableId}: [1]`);
      lines.push(`    - ${deviceId}: 1`);
    }
  }

  return lines.join('\n');
}

// ── Generate YAML for a single zone ───────────────────────────────
export function generateZoneYaml(
  zoneName: string,
  zoneDevices: ManifestDevice[],
  wires: WireSpec[],
): string {
  const lines: string[] = [];
  const zoneWires = wires.filter(w =>
    zoneDevices.some(d => d.device_name === w.to)
  );

  if (zoneWires.length === 0) return '';

  lines.push('metadata:');
  lines.push(`  title: '${zoneName.replace(/_/g, ' ').toUpperCase()} — ${zoneDevices.length} Devices, ${zoneWires.length} Wires'`);
  lines.push('');
  lines.push('options:');
  lines.push('  fontname: Arial');
  lines.push('  bgcolor: WH');
  lines.push('');

  // Source connectors (ECU/PDM as aggregated)
  lines.push('connectors:');
  const ecuWires = zoneWires.filter(w => w.from === 'ECU');
  const pdmWires = zoneWires.filter(w => w.from.startsWith('PDM'));

  if (ecuWires.length > 0) {
    lines.push('  ECU:');
    lines.push(`    type: ECU`);
    lines.push(`    pincount: ${ecuWires.length}`);
    lines.push(`    pinlabels: [${ecuWires.map(w => `'${w.to.substring(0, 20)}'`).join(', ')}]`);
  }
  if (pdmWires.length > 0) {
    lines.push('  PDM:');
    lines.push(`    type: PDM`);
    lines.push(`    pincount: ${pdmWires.length}`);
    lines.push(`    pinlabels: [${pdmWires.map(w => w.from.replace('PDM30:', '')).join(', ')}]`);
  }

  // Device connectors
  for (const d of zoneDevices) {
    if (!zoneWires.some(w => w.to === d.device_name)) continue;
    const id = safeId(d.device_name);
    lines.push(`  ${id}:`);
    lines.push(`    type: ${d.connector_type || d.device_category}`);
    lines.push(`    pincount: ${Math.min(d.pin_count || 2, 4)}`);
    if (d.manufacturer) lines.push(`    manufacturer: '${d.manufacturer}'`);
    if (d.part_number) lines.push(`    pn: '${d.part_number}'`);
  }

  lines.push('');
  lines.push('cables:');

  // Bundle: group wires by source
  if (ecuWires.length > 0) {
    lines.push('  ECU_bundle:');
    lines.push('    category: bundle');
    lines.push(`    wirecount: ${ecuWires.length}`);
    lines.push(`    gauge: 20 AWG`);
    lines.push(`    colors: [${ecuWires.map(w => toIecColor(w.color)).join(', ')}]`);
    const avgLen = ecuWires.reduce((s, w) => s + w.lengthFt, 0) / ecuWires.length;
    lines.push(`    length: ${(avgLen * 0.3048).toFixed(1)} m`);
  }
  if (pdmWires.length > 0) {
    lines.push('  PDM_bundle:');
    lines.push('    category: bundle');
    lines.push(`    wirecount: ${pdmWires.length}`);
    lines.push(`    gauge: 16 AWG`);
    lines.push(`    colors: [${pdmWires.map(w => toIecColor(w.color)).join(', ')}]`);
    const avgLen = pdmWires.reduce((s, w) => s + w.lengthFt, 0) / pdmWires.length;
    lines.push(`    length: ${(avgLen * 0.3048).toFixed(1)} m`);
  }

  lines.push('');
  lines.push('connections:');

  if (ecuWires.length > 0) {
    lines.push(`  - - ECU: [${ecuWires.map((_, i) => i + 1).join(', ')}]`);
    lines.push(`    - ECU_bundle: [${ecuWires.map((_, i) => i + 1).join(', ')}]`);
    // Each wire fans out to its device
    // WireViz requires alternating connector-cable pattern, so we connect to first device
    // For a bundle, we need to break into individual connections
  }

  // Individual connections (simpler, always works)
  let ecuIdx = 1;
  let pdmIdx = 1;
  // Clear the bundle approach — use individual wires for reliability
  lines.length = lines.indexOf('connections:') + 1;

  for (const w of zoneWires) {
    const deviceId = safeId(w.to);
    const wireId = `W${w.wireNumber}`;
    // Define the wire inline if not already in cables
    if (!lines.some(l => l.startsWith(`  ${wireId}:`))) {
      // Insert before connections
      const connIdx = lines.indexOf('connections:');
      lines.splice(connIdx, 0,
        `  ${wireId}:`,
        `    wirecount: 1`,
        `    gauge: ${w.gauge} AWG`,
        `    colors: [${toIecColor(w.color)}]`,
        `    length: ${(w.lengthFt * 0.3048).toFixed(1)} m`,
        w.isShielded ? `    shield: true` : '',
      );
    }
  }

  // Rebuild cables section cleanly
  const metaEnd = lines.indexOf('') + 1;
  const cleanLines: string[] = [];

  // Metadata + options
  cleanLines.push('metadata:');
  cleanLines.push(`  title: '${zoneName.replace(/_/g, ' ').toUpperCase()} — ${zoneDevices.length} Devices'`);
  cleanLines.push('');
  cleanLines.push('options:');
  cleanLines.push('  fontname: Arial');
  cleanLines.push('');

  // Connectors
  cleanLines.push('connectors:');
  if (ecuWires.length > 0) {
    cleanLines.push('  ECU:');
    cleanLines.push('    type: ECU');
    cleanLines.push(`    pincount: ${ecuWires.length}`);
    cleanLines.push(`    pinlabels: [${ecuWires.map(w => `'${w.to.substring(0, 22).replace(/'/g, '')}'`).join(', ')}]`);
  }
  if (pdmWires.length > 0) {
    cleanLines.push('  PDM:');
    cleanLines.push('    type: PDM');
    cleanLines.push(`    pincount: ${pdmWires.length}`);
    cleanLines.push(`    pinlabels: [${pdmWires.map(w => `'${w.from.replace('PDM30:', '')}'`).join(', ')}]`);
  }
  for (const d of zoneDevices) {
    if (!zoneWires.some(w => w.to === d.device_name)) continue;
    const id = safeId(d.device_name);
    cleanLines.push(`  ${id}:`);
    cleanLines.push(`    type: '${(d.connector_type || d.device_category).replace(/'/g, '')}'`);
    cleanLines.push(`    pincount: 1`);
    if (d.part_number) cleanLines.push(`    pn: '${d.part_number}'`);
  }

  // Cables
  cleanLines.push('');
  cleanLines.push('cables:');
  for (const w of zoneWires) {
    cleanLines.push(`  W${w.wireNumber}:`);
    cleanLines.push(`    wirecount: 1`);
    cleanLines.push(`    gauge: ${w.gauge} AWG`);
    cleanLines.push(`    show_equiv: true`);
    cleanLines.push(`    colors: [${toIecColor(w.color)}]`);
    cleanLines.push(`    length: ${(w.lengthFt * 0.3048).toFixed(1)} m`);
    if (w.isShielded) cleanLines.push(`    shield: true`);
  }

  // Connections
  cleanLines.push('');
  cleanLines.push('connections:');
  ecuIdx = 1;
  pdmIdx = 1;
  for (const w of zoneWires) {
    const deviceId = safeId(w.to);
    const wireId = `W${w.wireNumber}`;
    if (w.from === 'ECU') {
      cleanLines.push(`  -`);
      cleanLines.push(`    - ECU: ${ecuIdx++}`);
      cleanLines.push(`    - ${wireId}: [1]`);
      cleanLines.push(`    - ${deviceId}: 1`);
    } else {
      cleanLines.push(`  -`);
      cleanLines.push(`    - PDM: ${pdmIdx++}`);
      cleanLines.push(`    - ${wireId}: [1]`);
      cleanLines.push(`    - ${deviceId}: 1`);
    }
  }

  return cleanLines.join('\n');
}

// ── Render via Kroki.io ───────────────────────────────────────────
export async function renderWireVizSvg(yaml: string): Promise<string> {
  const response = await fetch('https://kroki.io/wireviz/svg', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: yaml,
  });
  if (!response.ok) {
    throw new Error(`Kroki render failed: ${response.status} ${await response.text()}`);
  }
  return response.text();
}

// ── Get available zone diagrams ───────────────────────────────────
export function getAvailableZones(devices: ManifestDevice[]): string[] {
  const zones = new Set<string>();
  for (const d of devices) {
    if (d.location_zone && d.pin_count && d.pin_count > 0) {
      zones.add(d.location_zone);
    }
  }
  return Array.from(zones).sort();
}

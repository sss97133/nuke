// generateConnectorSchedule.ts — Pin-by-pin assignment for every connector
// This is the document Desert Performance uses to pin out each connector on the harness board.

import type { WireSpec, OverlayResult } from './overlayCompute';

export interface PinAssignment {
  pin: string;
  function: string;
  wireNumber?: number;
  wireColor: string;
  wireGauge: number;
  connectsTo: string;
  signalType: string;
  notes?: string;
}

export interface ConnectorScheduleEntry {
  connectorName: string;
  connectorType: string;
  pinCount: number;
  assignments: PinAssignment[];
  unusedPins: string[];
}

export interface ConnectorScheduleDocument {
  title: string;
  generatedAt: string;
  connectors: ConnectorScheduleEntry[];
}

// For now, generate from the wire list.
// When device_pin_maps are validated, this will use actual pin assignments.
export function generateConnectorSchedule(result: OverlayResult): ConnectorScheduleDocument {
  const connectors: ConnectorScheduleEntry[] = [];

  // ── ECU Connector (grouped by "from ECU" wires) ──
  const ecuWires = result.wires.filter(w => w.from === 'ECU');
  if (ecuWires.length > 0) {
    // Group into connector A (injectors + ignitions + aux), B (analog + temp + digital), C (CAN + comm), D (extra)
    const connA: PinAssignment[] = [];
    const connB: PinAssignment[] = [];
    const connC: PinAssignment[] = [];

    for (const w of ecuWires) {
      const pin: PinAssignment = {
        pin: '—', // Will be filled when device_pin_maps are validated
        function: w.label,
        wireNumber: w.wireNumber,
        wireColor: w.color,
        wireGauge: w.gauge,
        connectsTo: w.to,
        signalType: w.signalType,
      };

      if (w.signalType === 'low_side_drive' || w.signalType === 'logic_coil_drive' || w.signalType === 'h_bridge_motor') {
        connA.push(pin);
      } else if (w.signalType === 'can_h' || w.signalType === 'can_l' || w.signalType === 'can_bus') {
        connC.push(pin);
      } else {
        connB.push(pin);
      }
    }

    if (connA.length > 0) {
      connectors.push({
        connectorName: 'ECU Connector A (Outputs)',
        connectorType: 'Superseal 34-pin',
        pinCount: 34,
        assignments: connA,
        unusedPins: [], // Can't compute without validated pin map
      });
    }
    if (connB.length > 0) {
      connectors.push({
        connectorName: 'ECU Connector B (Inputs)',
        connectorType: 'Superseal 34-pin',
        pinCount: 34,
        assignments: connB,
        unusedPins: [],
      });
    }
    if (connC.length > 0) {
      connectors.push({
        connectorName: 'ECU Connector C (Communication)',
        connectorType: 'Superseal 26-pin',
        pinCount: 26,
        assignments: connC,
        unusedPins: [],
      });
    }
  }

  // ── PDM Channels (each channel IS a pin assignment) ──
  if (result.pdmChannels.length > 0) {
    const pdmPins: PinAssignment[] = result.pdmChannels.map(ch => ({
      pin: `Ch${ch.channel}`,
      function: ch.label,
      wireColor: '—',
      wireGauge: ch.totalAmps > 15 ? 14 : ch.totalAmps > 8 ? 16 : 18,
      connectsTo: ch.devices.join(', '),
      signalType: 'pdm_output',
      notes: `${ch.maxAmps}A max, ${ch.totalAmps.toFixed(1)}A load${ch.totalAmps > ch.maxAmps ? ' ⚠ OVERLOAD' : ''}`,
    }));

    connectors.push({
      connectorName: `PDM (${result.recommendedConfig.pdm.config})`,
      connectorType: 'Superseal 67-pin',
      pinCount: result.recommendedConfig.pdm.totalChannels,
      assignments: pdmPins,
      unusedPins: Array.from(
        { length: Math.max(0, result.recommendedConfig.pdm.totalChannels - pdmPins.length) },
        (_, i) => `Ch${pdmPins.length + i + 1}`
      ),
    });
  }

  // ── Bulkhead Connectors (group wires passing through firewall) ──
  // Wires that go from engine_bay/underbody to dash/interior pass through the firewall
  const firewallWires = result.wires.filter(w => {
    // Simplified: anything from ECU to a rear/underbody device, or PDM to engine_bay
    return true; // TODO: proper zone-based filtering when measurement data exists
  });

  // For now, note that bulkhead connector sizing depends on wire count through firewall
  // This will be computed properly when device locations are validated

  return {
    title: 'CONNECTOR SCHEDULE',
    generatedAt: new Date().toISOString(),
    connectors,
  };
}

// ── Plain text export ───────────────────────────────────────────────
export function connectorScheduleToText(doc: ConnectorScheduleDocument, vehicleName = ''): string {
  const lines: string[] = [];
  lines.push(`${doc.title}${vehicleName ? ` — ${vehicleName}` : ''}`);
  lines.push(`Generated: ${new Date(doc.generatedAt).toLocaleDateString()}`);
  lines.push('═'.repeat(80));

  for (const conn of doc.connectors) {
    lines.push('');
    lines.push(`▸ ${conn.connectorName} (${conn.connectorType}, ${conn.pinCount} pins)`);
    lines.push('─'.repeat(80));
    lines.push(`${'PIN'.padEnd(6)} ${'FUNCTION'.padEnd(28)} ${'WIRE#'.padEnd(6)} ${'COLOR'.padEnd(10)} ${'GAUGE'.padEnd(6)} ${'TO'.padEnd(20)}`);

    for (const p of conn.assignments) {
      lines.push(
        `${p.pin.padEnd(6)} ${p.function.padEnd(28).slice(0, 28)} ${(p.wireNumber ? '#' + p.wireNumber : '—').padEnd(6)} ${p.wireColor.padEnd(10)} ${(p.wireGauge + 'ga').padEnd(6)} ${p.connectsTo.slice(0, 20)}`
      );
    }

    if (conn.unusedPins.length > 0) {
      lines.push(`  UNUSED: ${conn.unusedPins.join(', ')}`);
    }
  }

  return lines.join('\n');
}

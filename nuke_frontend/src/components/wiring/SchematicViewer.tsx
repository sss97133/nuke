// SchematicViewer.tsx — Interactive schematic viewer with clickable devices/pins/wires
// Renders IEEE-style electrical schematics from DB data
// Click M130 → pin popup, click connector → face view, click wire → specs tooltip
// 5 sheets: Power, Engine, Lighting, Body, Audio — all from DB data

import React, { useCallback, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ConnectorFaceView } from './ConnectorFaceView';
import type { ManifestDevice, WireSpec } from './overlayCompute';
import { useOverlayCompute } from './useOverlayCompute';
import type { DRCDeviceResult } from './useDRC';

// ── Types ────────────────────────────────────────────────────────────
interface PinMap {
  pin_number: string;
  pin_function: string;
  signal_type: string;
  max_current_amps: number | null;
  default_wire_color: string | null;
  default_wire_gauge_awg: number | null;
  requires_shielding: boolean;
  notes: string | null;
  connected_to_device: string | null;
  connected_to_pin: string | null;
}

interface DeviceBox {
  id: string;
  manifestId?: string; // links to ManifestDevice.id for cross-view
  label: string;
  deviceModel: string;
  connectorName?: string;
  category?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  pins?: PinMap[];
}

interface WireLine {
  id: string;
  label: string;
  gauge: number;
  color: string;
  colorHex: string;
  from: string;
  to: string;
  fromPin: string;
  toPin: string;
  x1: number; y1: number;
  x2: number; y2: number;
  midX?: number; // H-V-H Manhattan routing jog point
  strokeClass: string;
}

type SchematicSheet = 'power' | 'engine' | 'lighting' | 'body' | 'audio';

// ── Color helpers ───────────────────────────────────────────────────
const WIRE_HEX: Record<string, string> = {
  RED: '#dc2626', BLK: '#333', WHT: '#e0e0e0', GRN: '#22c55e', BLU: '#3b82f6',
  YEL: '#eab308', ORG: '#f97316', BRN: '#92400e', VIO: '#8b5cf6', PNK: '#ec4899',
  GRY: '#9ca3af', TAN: '#d4a574',
  'LT GRN': '#86efac', 'DK GRN': '#166534', 'LT BLU': '#93c5fd', 'DK BLU': '#1e3a5f',
  'RED/WHT': '#dc2626', 'GRN/WHT': '#4ade80', 'BLU/WHT': '#60a5fa',
  'YEL/BLK': '#ca8a04', 'WHT/RED': '#fca5a5', 'WHT/GRN': '#86efac',
  'ORG/WHT': '#ea580c', 'VIO/WHT': '#a78bfa', 'BRN/WHT': '#a16207',
  'RED/BLK': '#b91c1c', 'BLK/WHT': '#555', 'PNK/BLK': '#be185d',
};
function wireHex(c: string): string { return WIRE_HEX[c] || '#888'; }

const CATEGORY_FILLS: Record<string, string> = {
  engine_management: '#1a3320',
  lighting: '#2a2a10',
  audio: '#1a1a30',
  body: '#1a2030',
  actuators: '#2e2a1a',
  instrumentation: '#1a1a2e',
  power: '#2e1a1a',
  charging: '#2e1a1a',
  starting: '#2e1a1a',
  cooling: '#1a2e2e',
  fuel: '#1a2e1a',
  sensors: '#1a1a2e',
};

function categoryFill(cat: string): string {
  return CATEGORY_FILLS[cat] || '#F5F5F5';
}

function signalColor(type: string): string {
  if (!type) return '#888';
  if (type.includes('power')) return '#dc2626';
  if (type.includes('ground')) return '#999';
  if (type.includes('can')) return '#3b82f6';
  if (type.includes('analog')) return '#22c55e';
  if (type.includes('injector')) return '#f97316';
  if (type.includes('ignition')) return '#ef4444';
  if (type.includes('h_bridge')) return '#eab308';
  return '#bbb';
}

// ── Pin popup with VIEW CONNECTOR button ────────────────────────────
function PinPopup({ device, pins, position, onClose, onViewConnector, onShowOnFormboard }: {
  device: DeviceBox;
  pins: PinMap[];
  position: { x: number; y: number };
  onClose: () => void;
  onViewConnector: () => void;
  onShowOnFormboard?: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        background: '#1a1a2e',
        border: '2px solid #444',
        padding: 0,
        maxWidth: 460,
        maxHeight: 520,
        overflow: 'auto',
        zIndex: 100,
        fontFamily: "'Courier New', monospace",
        fontSize: '10px',
        color: '#e0e0e8',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ padding: '6px 8px', background: '#2a2a4e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {device.label} — {device.connectorName || device.deviceModel}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '11px' }}>✕</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#222244' }}>
            <th style={thStyle}>PIN</th>
            <th style={thStyle}>FUNCTION</th>
            <th style={thStyle}>TYPE</th>
            <th style={thStyle}>AWG</th>
            <th style={thStyle}>COLOR</th>
            <th style={thStyle}>TO</th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pin, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #333' }}>
              <td style={tdStyle}>{pin.pin_number}</td>
              <td style={{ ...tdStyle, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.pin_function}</td>
              <td style={tdStyle}>
                <span style={{ color: signalColor(pin.signal_type) }}>{pin.signal_type}</span>
              </td>
              <td style={tdStyle}>{pin.default_wire_gauge_awg || '\u2014'}</td>
              <td style={tdStyle}>{pin.default_wire_color || '\u2014'}</td>
              <td style={{ ...tdStyle, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.connected_to_device || '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '4px 8px', color: '#888', borderTop: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{pins.length} PINS — {pins.filter(p => p.pin_function && p.pin_function !== '\u2014').length} ASSIGNED</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onViewConnector}
            style={{
              padding: '3px 8px', background: '#334', border: '1px solid #556',
              color: '#8af', cursor: 'pointer', fontFamily: 'Arial', fontSize: '10px',
              fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}
          >
            VIEW CONNECTOR
          </button>
          {onShowOnFormboard && (
            <button
              onClick={onShowOnFormboard}
              style={{
                padding: '3px 8px', background: '#334', border: '1px solid #556',
                color: '#8fa', cursor: 'pointer', fontFamily: 'Arial', fontSize: '10px',
                fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px',
              }}
            >
              SHOW ON FORMBOARD
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '3px 6px', textAlign: 'left', fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const tdStyle: React.CSSProperties = { padding: '2px 6px', whiteSpace: 'nowrap', fontSize: '11px' };

// ── Wire tooltip ─────────────────────────────────────────────────────
function WireTooltip({ wire, position }: { wire: WireLine; position: { x: number; y: number } }) {
  return (
    <div style={{
      position: 'absolute', left: position.x + 10, top: position.y - 30,
      background: '#1a1a2e', border: '1px solid #444', padding: '4px 8px',
      fontFamily: "'Courier New', monospace", fontSize: '10px', color: '#e0e0e8',
      zIndex: 90, whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>
      <span style={{ fontWeight: 'bold' }}>{wire.label}</span>
      {' \u2014 '}{wire.gauge} AWG {wire.color}
      <br/>
      {wire.from}:{wire.fromPin} \u2192 {wire.to}:{wire.toPin}
    </div>
  );
}

// ── Wire detail panel (shown when wire is clicked) ──────────────────
function WireDetailPanel({ wire, onClose }: { wire: WireLine; onClose: () => void }) {
  return (
    <div style={{
      position: 'absolute', right: 12, top: 12, width: 280,
      background: '#1a1a2e', border: '2px solid #444', padding: 0,
      fontFamily: "'Courier New', monospace", fontSize: '10px', color: '#e0e0e8',
      zIndex: 95,
    }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '6px 8px', background: '#2a2a4e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          WIRE DETAIL
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '11px' }}>✕</button>
      </div>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div><span style={{ color: '#888' }}>LABEL:</span> <span style={{ fontWeight: 'bold' }}>{wire.label}</span></div>
        <div><span style={{ color: '#888' }}>FROM:</span> {wire.from}:{wire.fromPin}</div>
        <div><span style={{ color: '#888' }}>TO:</span> {wire.to}:{wire.toPin}</div>
        <div><span style={{ color: '#888' }}>GAUGE:</span> {wire.gauge} AWG</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#888' }}>COLOR:</span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: wire.colorHex, border: '1px solid #555' }} />
          {wire.color}
        </div>
        <div><span style={{ color: '#888' }}>TYPE:</span> {wire.strokeClass.replace('-', ' ').toUpperCase()}</div>
      </div>
    </div>
  );
}

// ── Connector Face View Modal ────────────────────────────────────────
function ConnectorModal({ device, pins, wires, onClose }: {
  device: DeviceBox;
  pins: PinMap[];
  wires: WireSpec[];
  onClose: () => void;
}) {
  // Build a ComponentConnector from PinMap data for ConnectorFaceView
  const connector = useMemo(() => ({
    id: device.id,
    component_id: device.id,
    connector_label: device.connectorName || device.label,
    connector_type: device.deviceModel,
    pin_count: pins.length,
    pins: pins.map(p => ({
      number: p.pin_number,
      designation: p.pin_function || '',
      full_name: p.pin_function || '',
      function: p.signal_type || '',
      direction: p.signal_type?.includes('output') || p.signal_type?.includes('injector') || p.signal_type?.includes('ignition') ? 'output' : 'input',
      wire_gauge_awg: p.default_wire_gauge_awg,
    })),
    sealed: false,
    keying: null,
    harness_side_pn: null,
  }), [device, pins]);

  // Build wire specs from pin maps for ConnectorFaceView matching
  const connectorWires = useMemo(() => {
    return pins
      .filter(p => p.connected_to_device)
      .map((p, i) => ({
        wireNumber: i,
        label: `${device.label}:${p.pin_number} \u2192 ${p.connected_to_device}:${p.connected_to_pin || '?'}`,
        from: `${device.deviceModel}:${p.pin_number}`,
        to: `${p.connected_to_device}:${p.connected_to_pin || '1'}`,
        gauge: p.default_wire_gauge_awg || 18,
        color: p.default_wire_color || 'WHT',
        lengthFt: 5,
        isShielded: p.requires_shielding,
        isTwistedPair: false,
        signalType: p.signal_type || 'unknown',
        voltageDrop: 0,
        voltageDropPct: 0,
      } as WireSpec));
  }, [device, pins]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', border: '2px solid #000', padding: 16,
          maxWidth: 600, maxHeight: '80vh', overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: 'Arial', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            CONNECTOR FACE VIEW — {device.label}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#333' }}>✕</button>
        </div>
        <ConnectorFaceView
          connector={connector as any}
          wires={connectorWires}
          ecuModel={device.deviceModel}
        />
      </div>
    </div>
  );
}

// ── Dynamic Sheet Builder ────────────────────────────────────────────
// Groups devices by sub-function, left-to-right signal flow layout,
// Manhattan wire routing with jog offsets.

function buildDynamicSheet(
  filteredDevices: ManifestDevice[],
  overlayWires: WireSpec[],
  sheetConfig: {
    centralDevice?: { id: string; label: string; model: string; w: number; h: number };
    columns?: number;
  } = {},
): { devices: DeviceBox[]; wires: WireLine[] } {
  const devices: DeviceBox[] = [];
  const wires: WireLine[] = [];

  const devH = 45;
  const devW = 180;
  const gapY = 12;
  const startY = 70;
  const sourceX = 80; // PDM/source column
  const loadX = 500; // load devices column

  // Add central device (PDM) on the left
  let pdmBottom = 120;
  if (sheetConfig.centralDevice) {
    const cd = sheetConfig.centralDevice;
    const h = Math.max(cd.h, filteredDevices.length * (devH + gapY));
    devices.push({
      id: cd.id, label: cd.label, deviceModel: cd.model,
      x: sourceX, y: 100, w: 140, h, fill: '#E8F0E8',
    });
    pdmBottom = 100 + h;
  }

  // Group devices by name pattern for visual grouping
  const groups: { label: string; items: ManifestDevice[] }[] = [];
  const grouped = new Set<string>();

  const groupPatterns = [
    { label: 'HEADLIGHTS', match: (n: string) => n.toLowerCase().includes('headlight') },
    { label: 'TURN SIGNALS', match: (n: string) => n.toLowerCase().includes('turn signal') },
    { label: 'TAIL / BRAKE', match: (n: string) => /tail|brake|backup|reverse|license/i.test(n) },
    { label: 'MARKERS', match: (n: string) => /marker|clearance|puddle/i.test(n) },
    { label: 'SPEAKERS', match: (n: string) => /speaker|subwoof/i.test(n) },
    { label: 'MOTORS', match: (n: string) => /motor|pump|fan|wiper|window/i.test(n) },
    { label: 'SENSORS', match: (n: string) => /sensor|temp|pressure|position|speed|knock|o2|wideband/i.test(n) },
    { label: 'SWITCHES', match: (n: string) => /switch|dimmer|flasher|relay/i.test(n) },
  ];

  for (const pat of groupPatterns) {
    const items = filteredDevices.filter(d => !grouped.has(d.id) && pat.match(d.device_name));
    if (items.length > 0) {
      groups.push({ label: pat.label, items });
      items.forEach(d => grouped.add(d.id));
    }
  }
  // Remaining ungrouped
  const remaining = filteredDevices.filter(d => !grouped.has(d.id));
  if (remaining.length > 0) groups.push({ label: 'OTHER', items: remaining });

  // Layout groups vertically with group headers
  let currentY = startY;
  let wireJogIndex = 0;

  for (const group of groups) {
    // Group label
    devices.push({
      id: `grp_${group.label}`, label: group.label, deviceModel: '',
      x: loadX - 10, y: currentY - 2, w: devW + 20, h: 14, fill: '#E8E8F0',
    });
    currentY += 20;

    for (const d of group.items) {
      devices.push({
        id: d.id,
        manifestId: d.id,
        label: d.device_name,
        deviceModel: d.model_number || d.device_name,
        x: loadX, y: currentY, w: devW, h: devH,
        fill: categoryFill(d.device_category),
      });

      // Manhattan-routed wire from source to device
      const wire = overlayWires.find(w => w.to === d.device_name || w.label === d.device_name);
      if (wire) {
        const fromX = sheetConfig.centralDevice ? sourceX + 140 : sourceX;
        const toX = loadX;
        const fromY = sheetConfig.centralDevice
          ? 100 + (wireJogIndex / Math.max(1, groups.reduce((n, g) => n + g.items.length, 0))) * (pdmBottom - 100)
          : currentY + devH / 2;
        const wireY = currentY + devH / 2;
        // Jog the midpoint X to avoid overlapping vertical segments
        const midX = fromX + 60 + (wireJogIndex % 12) * 8;
        wireJogIndex++;

        wires.push({
          id: `w_${d.id}`,
          label: wire.label,
          gauge: wire.gauge,
          color: wire.color,
          colorHex: wireHex(wire.color),
          from: wire.from,
          to: wire.to,
          fromPin: wire.from.includes(':') ? wire.from.split(':')[1] : '',
          toPin: '1',
          x1: fromX, y1: fromY,
          x2: toX, y2: wireY,
          midX,
          strokeClass: wire.isShielded ? 'shielded-line' : wire.isTwistedPair ? 'can-line' : 'signal-line',
        });
      }

      currentY += devH + gapY;
    }
    currentY += 10; // gap between groups
  }

  // Power rails
  const sheetBottom = Math.max(currentY + 40, pdmBottom + 20);
  wires.push({
    id: 'w_batt_pos', label: 'B+ RAIL (12V)', gauge: 6, color: 'RED',
    colorHex: '#dc2626', from: 'Battery', to: 'Distribution',
    fromPin: '+', toPin: 'VBATT',
    x1: 30, y1: 40, x2: 1650, y2: 40, strokeClass: 'power-line',
  });
  wires.push({
    id: 'w_gnd', label: 'GROUND RAIL', gauge: 6, color: 'BLK',
    colorHex: '#333', from: 'Battery', to: 'Star Ground',
    fromPin: '-', toPin: 'GND',
    x1: 30, y1: Math.min(sheetBottom, 1080), x2: 1650, y2: Math.min(sheetBottom, 1080), strokeClass: 'ground-line',
  });

  return { devices, wires };
}

// ── Hardcoded Engine Sheet ──────────────────────────────────────────
function buildEngineSheet(): { devices: DeviceBox[]; wires: WireLine[] } {
  const devices: DeviceBox[] = [];
  const wires: WireLine[] = [];

  devices.push({ id: 'M130', label: 'M130 ECU', deviceModel: 'M130', x: 80, y: 120, w: 180, h: 700, fill: '#E8F0E8' });
  devices.push({ id: 'M130_A', label: 'CONNECTOR A (34-PIN)', deviceModel: 'M130', connectorName: 'Connector_A', x: 85, y: 130, w: 80, h: 340, fill: '#D8E8D8' });
  devices.push({ id: 'M130_B', label: 'CONNECTOR B (26-PIN)', deviceModel: 'M130', connectorName: 'Connector_B', x: 85, y: 480, w: 80, h: 330, fill: '#D8E8D8' });

  for (let i = 1; i <= 8; i++) {
    const y = 100 + (i - 1) * 80;
    devices.push({ id: `INJ${i}`, label: `INJECTOR ${i}`, deviceModel: `Fuel Injector ${i}`, x: 900, y, w: 120, h: 55, fill: '#E0FFE0' });
    wires.push({ id: `w_inj${i}`, label: `INJ${i}_DRIVE`, gauge: 18, color: 'GRN', colorHex: '#22c55e', from: 'M130', to: `Injector ${i}`, fromPin: i <= 4 ? `A${18 + i}` : `A${23 + i}`, toPin: '1', x1: 260, y1: y + 27, x2: 900, y2: y + 27, strokeClass: 'signal-line' });
  }

  for (let i = 1; i <= 8; i++) {
    const y = 100 + (i - 1) * 80;
    devices.push({ id: `COIL${i}`, label: `COIL ${i}`, deviceModel: `Ignition Coil ${i}`, x: 1200, y, w: 120, h: 55, fill: '#FFE8E0' });
    wires.push({ id: `w_coil${i}`, label: `IGN${i}_CMD`, gauge: 20, color: 'WHT', colorHex: '#e0e0e0', from: 'M130', to: `Coil ${i}`, fromPin: i <= 6 ? `A${2 + i}` : `A${5 + i}`, toPin: '1', x1: 260, y1: y + 27, x2: 1200, y2: y + 27, strokeClass: 'signal-line' });
  }

  const sensors = [
    { id: 'CKP', label: 'CRANK POSITION', y: 780, pin: 'B01', fill: '#E0E8FF', shielded: true },
    { id: 'CMP', label: 'CAM POSITION', y: 830, pin: 'B02', fill: '#E0E8FF', shielded: true },
    { id: 'MAP', label: 'MAP SENSOR', y: 880, pin: 'A15', fill: '#E0E8FF', shielded: false },
    { id: 'IAT', label: 'INTAKE AIR TEMP', y: 930, pin: 'B03', fill: '#E0E8FF', shielded: false },
    { id: 'CLT', label: 'COOLANT TEMP', y: 980, pin: 'B04', fill: '#E0E8FF', shielded: false },
    { id: 'OPS', label: 'OIL PRESSURE', y: 1030, pin: 'A14', fill: '#E0E8FF', shielded: false },
  ];
  for (const s of sensors) {
    devices.push({ id: s.id, label: s.label, deviceModel: s.label, x: 900, y: s.y, w: 160, h: 40, fill: s.fill });
    wires.push({ id: `w_${s.id}`, label: `${s.id}_SIG`, gauge: s.shielded ? 22 : 20, color: s.shielded ? 'BLU' : 'GRN', colorHex: s.shielded ? '#3b82f6' : '#22c55e', from: 'M130', to: s.label, fromPin: s.pin, toPin: '1', x1: 260, y1: s.y + 20, x2: 900, y2: s.y + 20, strokeClass: s.shielded ? 'shielded-line' : 'signal-line' });
  }

  devices.push({ id: 'ETB', label: 'ELECTRONIC THROTTLE BODY', deviceModel: 'Electronic Throttle Body', x: 600, y: 780, w: 200, h: 80, fill: '#FFF0E0' });
  devices.push({ id: 'CAN', label: 'CAN BUS \u2192 PDM30', deviceModel: 'CAN Bus Network', x: 600, y: 880, w: 200, h: 50, fill: '#E0E0FF' });
  wires.push({ id: 'w_can_h', label: 'CAN_H', gauge: 22, color: 'BLU/WHT', colorHex: '#3b82f6', from: 'M130', to: 'PDM30', fromPin: 'B08', toPin: 'B08', x1: 260, y1: 900, x2: 600, y2: 900, strokeClass: 'can-line' });
  wires.push({ id: 'w_can_l', label: 'CAN_L', gauge: 22, color: 'BLU/BLK', colorHex: '#1e40af', from: 'M130', to: 'PDM30', fromPin: 'B09', toPin: 'B09', x1: 260, y1: 910, x2: 600, y2: 910, strokeClass: 'can-line' });

  wires.push({ id: 'w_batt_pos', label: 'B+ RAIL (12V)', gauge: 6, color: 'RED', colorHex: '#dc2626', from: 'Battery', to: 'PDM30', fromPin: '+', toPin: 'VBATT', x1: 30, y1: 40, x2: 1650, y2: 40, strokeClass: 'power-line' });
  wires.push({ id: 'w_gnd', label: 'GROUND RAIL', gauge: 6, color: 'BLK', colorHex: '#333', from: 'Battery', to: 'Star Ground', fromPin: '-', toPin: 'GND', x1: 30, y1: 1080, x2: 1650, y2: 1080, strokeClass: 'ground-line' });

  return { devices, wires };
}

// ── Category filters for each sheet ─────────────────────────────────
const SHEET_CATEGORIES: Record<SchematicSheet, string[]> = {
  power: ['power', 'charging', 'starting', 'battery_management'],
  engine: ['engine_management'],
  lighting: ['lighting'],
  body: ['actuators', 'body', 'instrumentation', 'hvac', 'cooling'],
  audio: ['audio'],
};

// ── Main Component ───────────────────────────────────────────────────
interface SchematicViewerProps {
  vehicleId?: string;
  devices: ManifestDevice[];
  selectedDeviceId?: string | null;
  selectedWireId?: string | null;
  onSelectDevice?: (id: string | null) => void;
  onSelectWire?: (id: string | null) => void;
  onNavigateTo?: (view: string, deviceId?: string, wireId?: string) => void;
  darkMode?: boolean;
  drcMap?: Map<string, DRCDeviceResult>;
}

export function SchematicViewer({
  vehicleId, devices,
  selectedDeviceId, selectedWireId,
  onSelectDevice, onSelectWire, onNavigateTo,
  darkMode = false, drcMap,
}: SchematicViewerProps) {
  const [activeSheet, setActiveSheet] = useState<SchematicSheet>('engine');
  const [pinCache, setPinCache] = useState<Record<string, PinMap[]>>({});
  const [selectedDevice, setSelectedDevice] = useState<DeviceBox | null>(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [hoveredWire, setHoveredWire] = useState<WireLine | null>(null);
  const [wireHoverPos, setWireHoverPos] = useState({ x: 0, y: 0 });
  const [clickedWire, setClickedWire] = useState<WireLine | null>(null);
  const [connectorModal, setConnectorModal] = useState<{ device: DeviceBox; pins: PinMap[] } | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 1684, h: 1190 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });

  const { result: overlay } = useOverlayCompute(devices);

  // Fetch pin maps for a device on click
  const fetchPins = useCallback(async (deviceModel: string, connectorName?: string) => {
    const key = connectorName ? `${deviceModel}__${connectorName}` : deviceModel;
    if (pinCache[key]) return pinCache[key];

    let query = supabase
      .from('device_pin_maps')
      .select('pin_number, pin_function, signal_type, max_current_amps, default_wire_color, default_wire_gauge_awg, requires_shielding, notes, connected_to_device, connected_to_pin')
      .eq('device_model', deviceModel)
      .order('pin_number');

    if (connectorName) {
      query = query.eq('connector_name', connectorName);
    }

    const { data } = await query;
    if (data) {
      setPinCache(prev => ({ ...prev, [key]: data as PinMap[] }));
      return data as PinMap[];
    }
    return [];
  }, [pinCache]);

  // Handle device click
  const handleDeviceClick = useCallback(async (device: DeviceBox, event: React.MouseEvent) => {
    event.stopPropagation();
    const pins = await fetchPins(device.deviceModel, device.connectorName);
    device.pins = pins;
    setSelectedDevice(device);
    setClickedWire(null);
    setPopupPos({ x: Math.min(event.clientX, window.innerWidth - 480), y: Math.min(event.clientY, window.innerHeight - 540) });
    onSelectDevice?.(device.manifestId || null);
  }, [fetchPins, onSelectDevice]);

  // Handle wire click
  const handleWireClick = useCallback((wire: WireLine, event: React.MouseEvent) => {
    event.stopPropagation();
    setClickedWire(wire);
    setSelectedDevice(null);
    onSelectWire?.(wire.id);
  }, [onSelectWire]);

  // Build current sheet
  const sheet = useMemo(() => {
    if (activeSheet === 'engine') {
      return buildEngineSheet();
    }

    // Dynamic sheets from DB data
    const categories = SHEET_CATEGORIES[activeSheet] || [];
    const filtered = devices.filter(d => {
      const cat = (d.device_category || '').toLowerCase();
      return categories.some(c => cat.includes(c));
    });

    // Special central device for power sheet
    const centralDevice = activeSheet === 'power'
      ? { id: 'PDM30', label: 'PDM30', model: 'PDM30', w: 160, h: 500 }
      : undefined;

    return buildDynamicSheet(filtered, overlay.wires, { centralDevice, columns: activeSheet === 'audio' ? 2 : 3 });
  }, [activeSheet, devices, overlay.wires]);

  const sheets: { key: SchematicSheet; label: string }[] = [
    { key: 'power', label: 'POWER DISTRIBUTION' },
    { key: 'engine', label: 'ENGINE MANAGEMENT' },
    { key: 'lighting', label: 'LIGHTING' },
    { key: 'body', label: 'BODY ELECTRONICS' },
    { key: 'audio', label: 'AUDIO' },
  ];

  // Pan/zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.05 : 1 / 1.05;
    setViewBox(prev => {
      const nw = Math.min(Math.max(prev.w * factor, 400), 3000);
      const nh = nw * (1190 / 1684);
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  }, []);

  // Drag-to-pan handlers
  const handlePanDown = useCallback((e: React.MouseEvent) => {
    // Only start pan on SVG background — skip device rects (they have a <g> parent with cursor:pointer)
    const target = e.target as SVGElement;
    if (target.tagName === 'svg' || (target.tagName === 'rect' && !target.closest('g[style*="cursor"]'))) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y });
    }
  }, [viewBox.x, viewBox.y]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    // Convert pixel delta to SVG viewBox units
    const svg = (e.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (e.clientX - panStart.x) * scaleX;
    const dy = (e.clientY - panStart.y) * scaleY;
    setViewBox(prev => ({ ...prev, x: panStart.vx - dx, y: panStart.vy - dy }));
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const handlePanUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    background: active ? '#2C2C2C' : 'transparent',
    color: active ? '#FFF' : '#666',
    border: '2px solid ' + (active ? '#555' : '#333'),
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  });

  const sheetIdx = sheets.findIndex(s => s.key === activeSheet);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#1e1e2e' }} onClick={() => { setSelectedDevice(null); setClickedWire(null); }}>
      {/* Sheet tabs */}
      <div style={{ display: 'flex', gap: 0, padding: '4px 12px', borderBottom: '1px solid #333' }}>
        {sheets.map(s => (
          <button key={s.key} style={tabStyle(activeSheet === s.key)} onClick={() => { setActiveSheet(s.key); setSelectedDevice(null); setClickedWire(null); }}>
            {s.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: "'Courier New'", fontSize: '10px', color: '#555', alignSelf: 'center' }}>
          SHEET {sheetIdx + 1} OF {sheets.length} — {sheet.devices.length} DEVICES, {sheet.wires.filter(w => !['power-line', 'ground-line'].includes(w.strokeClass)).length} WIRES
        </span>
      </div>

      {/* SVG Schematic */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <svg
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          style={{ width: '100%', height: '100%', background: darkMode ? '#1a1a2e' : '#FFFFFF', cursor: isPanning ? 'grabbing' : 'default' }}
          onWheel={handleWheel}
          onMouseDown={handlePanDown}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanUp}
          onMouseLeave={handlePanUp}
        >
          {/* SVG glow filter for selected wire */}
          <defs>
            <filter id="wire-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Border */}
          <rect x={10} y={10} width={1664} height={1170} fill="none" stroke={darkMode ? '#333' : '#000'} strokeWidth={2} />
          <rect x={15} y={15} width={1654} height={1160} fill="none" stroke={darkMode ? '#2a2a3e' : '#000'} strokeWidth={0.5} />

          {/* Power rails */}
          {sheet.wires.filter(w => w.strokeClass === 'power-line').map(w => (
            <g key={w.id}>
              <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={w.colorHex} strokeWidth={3} />
              <text x={w.x1 + 5} y={w.y1 - 5} fontSize={8} fontFamily="Courier New" fill="#CC0000">{w.label}</text>
            </g>
          ))}
          {sheet.wires.filter(w => w.strokeClass === 'ground-line').map(w => (
            <g key={w.id}>
              <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={darkMode ? '#888' : '#000'} strokeWidth={3} />
              <text x={w.x1 + 5} y={w.y1 + 12} fontSize={8} fontFamily="Courier New" fill={darkMode ? '#888' : '#333'}>{w.label}</text>
            </g>
          ))}

          {/* Signal wires — Manhattan H-V-H routing when midX is set */}
          {sheet.wires.filter(w => !['power-line', 'ground-line'].includes(w.strokeClass)).map(w => {
            const isSelected = clickedWire?.id === w.id || selectedWireId === w.id;
            const strokeColor = isSelected ? '#FFD700' : (darkMode ? w.colorHex : w.colorHex);
            const sw = isSelected ? 3 : w.strokeClass === 'can-line' ? 2.5 : w.strokeClass === 'shielded-line' ? 1.5 : 1;
            const dash = w.strokeClass === 'shielded-line' ? '6,3' : undefined;
            // H-V-H path if midX is set and endpoints differ in Y
            const useManhattan = w.midX != null && Math.abs(w.y1 - w.y2) > 1;
            const pathD = useManhattan
              ? `M${w.x1},${w.y1} H${w.midX} V${w.y2} H${w.x2}`
              : `M${w.x1},${w.y1} L${w.x2},${w.y2}`;
            // Label sits on the horizontal segment from source
            const labelX = useManhattan ? (w.x1 + w.midX!) / 2 : (w.x1 + w.x2) / 2;
            const labelY = w.y1 - 4;
            return (
              <g key={w.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={sw}
                  strokeDasharray={dash}
                  filter={isSelected ? 'url(#wire-glow)' : undefined}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => { setHoveredWire(w); setWireHoverPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={() => setHoveredWire(null)}
                  onClick={e => handleWireClick(w, e)}
                />
                {/* Wire label on horizontal segment */}
                <text
                  x={labelX} y={labelY}
                  fontSize={6} fontFamily="Courier New"
                  fill={isSelected ? '#B8860B' : (darkMode ? '#777' : '#555')}
                  textAnchor="middle"
                  fontWeight={isSelected ? 'bold' : 'normal'}
                >
                  {w.label} {w.gauge}AWG
                </text>
              </g>
            );
          })}

          {/* Device boxes */}
          {sheet.devices.map(d => {
            const isHighlighted = selectedDeviceId === d.manifestId || selectedDeviceId === d.id;
            return (
              <g
                key={d.id}
                style={{ cursor: 'pointer' }}
                onClick={e => handleDeviceClick(d, e)}
              >
                <rect
                  x={d.x} y={d.y} width={d.w} height={d.h}
                  fill={isHighlighted ? '#FFFDE0' : d.fill}
                  stroke={isHighlighted ? '#FFD700' : darkMode ? '#555' : '#000'}
                  strokeWidth={isHighlighted ? 2.5 : d.id === 'M130' ? 2 : 1.5}
                  rx={0}
                />
                <text
                  x={d.x + d.w / 2} y={d.y + (d.h < 60 ? d.h / 2 + 3 : 16)}
                  fontSize={d.h < 60 ? 8 : 10} fontFamily="Courier New" fontWeight="bold"
                  fill="#e0e0e0" textAnchor="middle"
                >
                  {d.label}
                </text>
                {d.connectorName && (
                  <text
                    x={d.x + d.w / 2} y={d.y + 28}
                    fontSize={7} fontFamily="Courier New" fill="#555" textAnchor="middle"
                  >
                    CLICK FOR PIN MAP
                  </text>
                )}
                {/* Pin count indicator for non-header boxes */}
                {d.manifestId && (
                  <text
                    x={d.x + d.w - 4} y={d.y + d.h - 4}
                    fontSize={6} fontFamily="Courier New" fill="#999" textAnchor="end"
                  >
                    {devices.find(fd => fd.id === d.manifestId)?.pin_count || ''}p
                  </text>
                )}
                {/* DRC severity dot */}
                {d.manifestId && drcMap?.get(d.manifestId) && (() => {
                  const drc = drcMap.get(d.manifestId)!;
                  const dotColor = drc.severity === 'fail' ? '#ef4444' : drc.severity === 'warn' ? '#eab308' : '#22c55e';
                  return (
                    <circle
                      cx={d.x + d.w - 2} cy={d.y + 5}
                      r={3} fill={dotColor} stroke={darkMode ? '#1a1a2e' : '#fff'} strokeWidth={1}
                    >
                      <title>{drc.rules.filter(r => r.severity !== 'pass').map(r => r.message).join('\n') || 'All checks pass'}</title>
                    </circle>
                  );
                })()}
              </g>
            );
          })}

          {/* Title block */}
          <rect x={1200} y={1100} width={470} height={70} fill={darkMode ? '#252540' : '#F5F5F5'} stroke={darkMode ? '#444' : '#000'} strokeWidth={1.5} />
          <text x={1210} y={1115} fontSize={12} fontFamily="Courier New" fontWeight="bold" fill={darkMode ? '#e0e0e8' : '#000'}>NUKE VEHICLE PLATFORM</text>
          <text x={1210} y={1130} fontSize={9} fontFamily="Courier New">1977 Chevrolet K5 Blazer — LS3/Motec M130</text>
          <text x={1210} y={1145} fontSize={9} fontFamily="Courier New">
            {sheets.find(s => s.key === activeSheet)?.label} — SHEET {sheetIdx + 1}/{sheets.length}
          </text>
          <text x={1210} y={1160} fontSize={8} fontFamily="Courier New" fill="#888">DWG: NKW-K5-00{sheetIdx + 1} REV A — {new Date().toISOString().slice(0, 10)}</text>
        </svg>

        {/* Pin popup */}
        {selectedDevice?.pins && selectedDevice.pins.length > 0 && (
          <PinPopup
            device={selectedDevice}
            pins={selectedDevice.pins}
            position={popupPos}
            onClose={() => setSelectedDevice(null)}
            onViewConnector={() => {
              if (selectedDevice?.pins) {
                setConnectorModal({ device: selectedDevice, pins: selectedDevice.pins });
              }
            }}
            onShowOnFormboard={onNavigateTo ? () => {
              onNavigateTo('formboard', selectedDevice?.manifestId || selectedDevice?.id);
              setSelectedDevice(null);
            } : undefined}
          />
        )}

        {/* Wire tooltip */}
        {hoveredWire && !clickedWire && (
          <WireTooltip wire={hoveredWire} position={wireHoverPos} />
        )}

        {/* Wire detail panel */}
        {clickedWire && (
          <WireDetailPanel wire={clickedWire} onClose={() => setClickedWire(null)} />
        )}
      </div>

      {/* Connector face view modal */}
      {connectorModal && (
        <ConnectorModal
          device={connectorModal.device}
          pins={connectorModal.pins}
          wires={overlay.wires}
          onClose={() => setConnectorModal(null)}
        />
      )}
    </div>
  );
}

// WiringOverlaySandbox.tsx — Interactive harness computation sandbox
// Add/remove devices, watch everything recompute in real time.
// No network calls. Pure client-side computation.

import React, { useState, useEffect } from 'react';
import { useOverlayCompute } from './useOverlayCompute';
import type { ManifestDevice, WireSpec } from './overlayCompute';

// ── Quick-add device templates ──────────────────────────────────────
const DEVICE_TEMPLATES: Record<string, Partial<ManifestDevice> & { device_name: string; device_category: string }> = {
  // Sensors
  'Oil Pressure Sender': { device_name: 'Oil Pressure Sender', device_category: 'sensors', signal_type: 'analog_5v', pin_count: 3, power_draw_amps: 0, pdm_controlled: false, location_zone: 'engine_bay', price: 55 },
  'Coolant Temp Sender': { device_name: 'Coolant Temp Sender', device_category: 'sensors', signal_type: 'analog_temp', pin_count: 2, power_draw_amps: 0, pdm_controlled: false, location_zone: 'engine_bay', price: 13 },
  'Fuel Pressure Sensor': { device_name: 'Fuel Pressure Sensor', device_category: 'sensors', signal_type: 'analog_5v', pin_count: 3, power_draw_amps: 0, pdm_controlled: false, location_zone: 'engine_bay', price: 45 },
  'Wheel Speed Sensor': { device_name: 'Wheel Speed Sensor', device_category: 'sensors', signal_type: 'hall_effect', pin_count: 3, power_draw_amps: 0, pdm_controlled: false, location_zone: 'underbody', price: 80 },
  'EGT Probe': { device_name: 'EGT Probe', device_category: 'sensors', signal_type: 'analog_5v', pin_count: 2, power_draw_amps: 0, pdm_controlled: false, location_zone: 'underbody', price: 60 },
  'Wideband O2 Sensor': { device_name: 'Wideband O2 Sensor', device_category: 'sensors', signal_type: 'wideband_lambda', pin_count: 5, power_draw_amps: 0, pdm_controlled: false, location_zone: 'underbody', price: 120 },

  // Actuators
  'Radiator Fan': { device_name: 'Radiator Fan', device_category: 'actuators', signal_type: 'motor', pin_count: 2, power_draw_amps: 18, pdm_controlled: true, location_zone: 'engine_bay', price: 120 },
  'Electric Water Pump': { device_name: 'Electric Water Pump', device_category: 'actuators', signal_type: 'motor', pin_count: 2, power_draw_amps: 12, pdm_controlled: true, location_zone: 'engine_bay', price: 200 },
  'Nitrous Solenoid': { device_name: 'Nitrous Solenoid', device_category: 'actuators', signal_type: 'low_side_drive', pin_count: 2, power_draw_amps: 3, pdm_controlled: true, location_zone: 'engine_bay', price: 80 },

  // Lighting
  'LED Light Bar': { device_name: 'LED Light Bar', device_category: 'lighting', signal_type: 'led_lighting', pin_count: 2, power_draw_amps: 15, pdm_controlled: true, location_zone: 'roof', price: 150 },
  'Rock Lights (set)': { device_name: 'Rock Lights', device_category: 'lighting', signal_type: 'led_lighting', pin_count: 2, power_draw_amps: 4, pdm_controlled: true, location_zone: 'underbody', price: 80 },
  'Side Exhaust Cutout Light': { device_name: 'Exhaust Cutout Light', device_category: 'lighting', signal_type: 'led_lighting', pin_count: 2, power_draw_amps: 1, pdm_controlled: true, location_zone: 'underbody', price: 25 },
  'Extra Tail Light': { device_name: 'Extra Tail Light', device_category: 'lighting', signal_type: 'led_lighting', pin_count: 4, power_draw_amps: 2, pdm_controlled: true, location_zone: 'rear', price: 45 },

  // Body
  'Power Window Motor': { device_name: 'Power Window Motor', device_category: 'body', signal_type: 'motor', pin_count: 2, power_draw_amps: 15, pdm_controlled: true, location_zone: 'doors', price: 40 },
  'Exhaust Cutout Valve': { device_name: 'Exhaust Cutout Valve', device_category: 'body', signal_type: 'motor', pin_count: 2, power_draw_amps: 8, pdm_controlled: true, location_zone: 'underbody', price: 200 },
  'Electric Antenna': { device_name: 'Electric Antenna', device_category: 'body', signal_type: 'motor', pin_count: 3, power_draw_amps: 3, pdm_controlled: true, location_zone: 'rear', price: 35 },
  'Winch': { device_name: 'Winch', device_category: 'accessories', signal_type: 'high_current', pin_count: 4, power_draw_amps: 100, pdm_controlled: false, location_zone: 'engine_bay', price: 500 },
  'Air Compressor': { device_name: 'Air Compressor', device_category: 'accessories', signal_type: 'motor', pin_count: 2, power_draw_amps: 25, pdm_controlled: true, location_zone: 'underbody', price: 180 },
};

// ── Compact Status Bar ──────────────────────────────────────────────
function StatusBar({ result, delta }: { result: ReturnType<typeof useOverlayCompute>['result']; delta: ReturnType<typeof useOverlayCompute>['delta'] }) {
  const s = {
    fontSize: 'var(--fs-10, 10px)',
    fontFamily: 'Courier New, monospace',
    padding: '8px 12px',
    background: 'var(--surface, #ebebeb)',
    border: '2px solid var(--border, #bdbdbd)',
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  };
  const label = { fontSize: 'var(--fs-8, 8px)', textTransform: 'uppercase' as const, color: 'var(--text-secondary, #666)', letterSpacing: '0.5px' };
  const val = { fontWeight: 700, fontSize: 'var(--fs-11, 11px)' };
  const warn = result.warnings.length > 0 ? { color: 'var(--warning, #b05a00)' } : {};

  return (
    <div style={s}>
      <div><span style={label}>DEVICES </span><span style={val}>{result.deviceCount}</span></div>
      <div><span style={label}>WIRES </span><span style={val}>{result.wireCount}</span></div>
      <div><span style={label}>LENGTH </span><span style={val}>{result.totalWireLengthFt} ft</span></div>
      <div><span style={label}>ECU </span><span style={{ ...val, color: delta?.ecuChanged ? 'var(--error, #d13438)' : undefined }}>{result.recommendedConfig.ecu.model}</span></div>
      <div><span style={label}>PDM </span><span style={val}>{result.recommendedConfig.pdm.config} ({result.pdmChannels.length}ch)</span></div>
      <div><span style={label}>ALT </span><span style={val}>{result.alternatorAmps}A</span></div>
      <div><span style={label}>COST </span><span style={val}>${Math.round(result.partsCost + result.recommendedConfig.totalCost).toLocaleString()}</span></div>
      <div style={warn}><span style={label}>WARNINGS </span><span style={val}>{result.warnings.length}</span></div>
    </div>
  );
}

// ── Delta Flash ─────────────────────────────────────────────────────
function DeltaFlash({ delta }: { delta: ReturnType<typeof useOverlayCompute>['delta'] }) {
  if (!delta) return null;
  const items: string[] = [];
  if (delta.devicesDelta !== 0) items.push(`${delta.devicesDelta > 0 ? '+' : ''}${delta.devicesDelta} devices`);
  if (delta.wiresDelta !== 0) items.push(`${delta.wiresDelta > 0 ? '+' : ''}${delta.wiresDelta} wires`);
  if (delta.ecuChanged) items.push(`ECU: ${delta.ecuBefore} → ${delta.ecuAfter}`);
  if (delta.pdmChannelsDelta !== 0) items.push(`${delta.pdmChannelsDelta > 0 ? '+' : ''}${delta.pdmChannelsDelta} PDM ch`);
  if (delta.costDelta !== 0) items.push(`${delta.costDelta > 0 ? '+' : ''}$${Math.round(delta.costDelta)}`);
  if (items.length === 0) return null;

  return (
    <div style={{
      fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace',
      padding: '4px 12px', background: delta.ecuChanged ? 'var(--error-dim, #fde7e9)' : 'var(--accent-dim, rgba(42,42,42,0.08))',
      border: '1px solid var(--border)', transition: 'all 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      CHANGED: {items.join(' | ')}
      {delta.newWarnings.map((w, i) => <span key={i} style={{ color: 'var(--warning)', display: 'block' }}>+ {w}</span>)}
      {delta.resolvedWarnings.map((w, i) => <span key={i} style={{ color: 'var(--success, #16825d)', display: 'block' }}>- {w}</span>)}
    </div>
  );
}

// ── ECU Options Panel ───────────────────────────────────────────────
function ECUOptionsPanel({ options }: { options: ReturnType<typeof useOverlayCompute>['result']['ecuOptions'] }) {
  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 4 }}>ECU OPTIONS</div>
      {options.map(o => (
        <div key={o.model} style={{
          display: 'flex', gap: 8, padding: '3px 0',
          opacity: o.fits ? 1 : 0.4,
          borderLeft: o.fits ? '3px solid var(--success, #16825d)' : '3px solid var(--error, #d13438)',
          paddingLeft: 6,
        }}>
          <span style={{ fontWeight: 700, width: 40 }}>{o.model}</span>
          <span style={{ fontFamily: 'Courier New', width: 50 }}>${o.price.toLocaleString()}</span>
          <span style={{ color: o.fits ? 'var(--success)' : 'var(--error)', width: 80 }}>{o.headroom}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{o.reason}</span>
        </div>
      ))}
    </div>
  );
}

// ── PDM30 real pin assignments for 20A outputs (dual-pin paralleled) ──
const PDM30_20A_PINS: Record<number, string> = {
  1: 'A01+A10', 2: 'A03+A12', 3: 'A05+A14', 4: 'A07+A16',
  5: 'A09+A17', 6: 'B03+B09', 7: 'B05+B11', 8: 'B07+B13',
};

// ── PDM Channels Panel ──────────────────────────────────────────────
function PDMChannelsPanel({ channels, config }: { channels: ReturnType<typeof useOverlayCompute>['result']['pdmChannels']; config: string }) {
  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace' }}>
      <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', fontFamily: 'Arial', marginBottom: 4 }}>
        PDM30 OUTPUTS ({config}) — {channels.length} ASSIGNED
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '2px 0', borderBottom: '1px solid var(--border)', marginBottom: 2, fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'Arial' }}>
        <span style={{ width: 45 }}>OUTPUT</span>
        <span style={{ width: 50 }}>RATING</span>
        <span style={{ width: 58 }}>PINS</span>
        <span style={{ width: 42 }}>GAUGE</span>
        <span style={{ width: 170 }}>ASSIGNED LOAD</span>
        <span style={{ width: 45, textAlign: 'right' }}>DRAW</span>
        <span style={{ width: 40, textAlign: 'right' }}>UTIL</span>
      </div>
      {channels.slice(0, 30).map(ch => {
        const is20A = ch.channel <= 8;
        const pins = is20A ? (PDM30_20A_PINS[ch.channel] || '—') : `—`;
        const gauge = is20A ? '16AWG' : '20AWG';
        const util = Math.round((ch.totalAmps / ch.maxAmps) * 100);
        const overloaded = ch.totalAmps > ch.maxAmps;
        return (
          <div key={ch.channel} style={{
            display: 'flex', gap: 4, padding: '1px 0',
            color: overloaded ? 'var(--error)' : undefined,
            background: overloaded ? 'rgba(209,52,56,0.06)' : undefined,
          }}>
            <span style={{ width: 45, fontWeight: 700 }}>OUT{ch.channel.toString().padStart(2, ' ')}</span>
            <span style={{ width: 50, color: is20A ? 'var(--text)' : 'var(--text-secondary)' }}>{ch.maxAmps}A{is20A ? ' HC' : ''}</span>
            <span style={{ width: 58, fontSize: '8px', color: 'var(--text-secondary)' }}>{pins}</span>
            <span style={{ width: 42, color: 'var(--text-secondary)' }}>{gauge}</span>
            <span style={{ width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.label}</span>
            <span style={{ width: 45, textAlign: 'right' }}>{ch.totalAmps.toFixed(1)}A</span>
            <span style={{ width: 40, textAlign: 'right', color: util > 90 ? 'var(--warning, #b05a00)' : 'var(--text-secondary)' }}>{util}%</span>
          </div>
        );
      })}
      <div style={{ fontSize: '7px', color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'Arial', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        HC = HIGH CURRENT (DUAL-PIN, 115A TRANSIENT) | SUPERSEAL 1.0 (TE 4-1437290-0 / 3-1437290-7) | SOURCE: MOTEC PDM USER MANUAL P39
      </div>
    </div>
  );
}

// ── Device Quick-Add Panel ──────────────────────────────────────────
function QuickAddPanel({ onAdd }: { onAdd: (template: string) => void }) {
  const categories = {
    'SENSORS': ['Oil Pressure Sender', 'Coolant Temp Sender', 'Fuel Pressure Sensor', 'Wheel Speed Sensor', 'EGT Probe', 'Wideband O2 Sensor'],
    'ACTUATORS': ['Radiator Fan', 'Electric Water Pump', 'Nitrous Solenoid'],
    'LIGHTING': ['LED Light Bar', 'Rock Lights (set)', 'Side Exhaust Cutout Light', 'Extra Tail Light'],
    'BODY/ACC': ['Power Window Motor', 'Exhaust Cutout Valve', 'Electric Antenna', 'Winch', 'Air Compressor'],
  };

  const btn = {
    fontSize: 'var(--fs-9, 9px)', fontFamily: 'Arial, sans-serif', fontWeight: 600,
    padding: '4px 8px', border: '2px solid var(--border)', background: 'var(--surface)',
    cursor: 'pointer', transition: 'all 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)' }}>
      <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 4 }}>ADD DEVICE</div>
      {Object.entries(categories).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: '7px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>{cat}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {items.map(name => (
              <button key={name} style={btn} onClick={() => onAdd(name)}
                onMouseOver={e => { (e.target as HTMLElement).style.background = 'var(--text, #2a2a2a)'; (e.target as HTMLElement).style.color = 'var(--surface, #ebebeb)'; }}
                onMouseOut={e => { (e.target as HTMLElement).style.background = 'var(--surface, #ebebeb)'; (e.target as HTMLElement).style.color = 'var(--text, #2a2a2a)'; }}
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Warnings Panel ──────────────────────────────────────────────────
function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return (
    <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--success, #16825d)', padding: '4px 0' }}>
      NO WARNINGS — ALL SYSTEMS NOMINAL
    </div>
  );
  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)' }}>
      <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--warning, #b05a00)', marginBottom: 4 }}>
        WARNINGS ({warnings.length})
      </div>
      {warnings.map((w, i) => (
        <div key={i} style={{ padding: '2px 0', color: 'var(--warning)' }}>⚠ {w}</div>
      ))}
    </div>
  );
}

// ── Device List (removable) ─────────────────────────────────────────
function DeviceList({ devices, onRemove }: { devices: ManifestDevice[]; onRemove: (id: string) => void }) {
  const categories = Array.from(new Set(devices.map(d => d.device_category))).sort();
  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace', maxHeight: 400, overflow: 'auto' }}>
      {categories.map(cat => {
        const catDevices = devices.filter(d => d.device_category === cat);
        return (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontFamily: 'Arial', marginBottom: 2 }}>
              {cat} ({catDevices.length})
            </div>
            {catDevices.map(d => (
              <div key={d.id} style={{ display: 'flex', gap: 4, padding: '1px 0', alignItems: 'center' }}>
                <button onClick={() => onRemove(d.id)} style={{
                  width: 16, height: 16, border: '1px solid var(--border)', background: 'transparent',
                  cursor: 'pointer', fontSize: 9, lineHeight: '14px', textAlign: 'center', padding: 0,
                  color: 'var(--text-secondary)',
                }}
                  onMouseOver={e => { (e.target as HTMLElement).style.color = 'var(--error)'; (e.target as HTMLElement).style.borderColor = 'var(--error)'; }}
                  onMouseOut={e => { (e.target as HTMLElement).style.color = 'var(--text-secondary)'; (e.target as HTMLElement).style.borderColor = 'var(--border)'; }}
                >×</button>
                <span style={{ width: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.device_name}</span>
                <span style={{ width: 30, textAlign: 'right' }}>{d.pin_count || '-'}p</span>
                <span style={{ width: 40, textAlign: 'right' }}>{d.power_draw_amps || 0}A</span>
                <span style={{ width: 50, textAlign: 'right', color: 'var(--text-secondary)' }}>{d.price ? `$${d.price}` : '-'}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── ECU Connector View ──────────────────────────────────────────────
// Shows pin-by-pin assignment for ECU connectors, organized by connector
function ECUConnectorView({ ecuModel, wires }: { ecuModel: string; wires: WireSpec[] }) {
  // M130: 2 connectors (A=34pin, B=26pin). M150: 4 connectors (A-D).
  const connectors = ecuModel === 'M130'
    ? [
        { name: 'Connector A', type: 'Superseal 34-pin (Keying 1)', pins: 34, prefix: 'A', te: '4-1437290-0 / MoTeC #65044' },
        { name: 'Connector B', type: 'Superseal 26-pin (Keying 1)', pins: 26, prefix: 'B', te: '3-1437290-7 / MoTeC #65045' },
      ]
    : ecuModel === 'M150'
    ? [
        { name: 'Connector A', type: 'Superseal 34-pin (Keying 2)', pins: 34, prefix: 'A', te: 'MoTeC #65067' },
        { name: 'Connector B', type: 'Superseal 26-pin (Keying 3)', pins: 26, prefix: 'B', te: 'MoTeC #65068' },
        { name: 'Connector C', type: 'Superseal 34-pin (Keying 1)', pins: 34, prefix: 'C', te: 'MoTeC #65044' },
        { name: 'Connector D', type: 'Superseal 26-pin (Keying 1)', pins: 26, prefix: 'D', te: 'MoTeC #65045' },
      ]
    : [];

  // Build pin assignment map from wires
  const pinMap = new Map<string, WireSpec>();
  for (const w of wires) {
    if (w.from.startsWith(ecuModel + ':')) {
      const pin = w.from.split(':')[1];
      pinMap.set(pin, w);
    }
  }

  // M130 real pin functions (from validated device_pin_maps)
  const M130_PINS: Record<string, { fn: string; type: string }> = {
    A01:'OUT_HB2|hb', A02:'SEN_5V0_A|pwr', A03:'IGN_LS1|ign', A04:'IGN_LS2|ign', A05:'IGN_LS3|ign',
    A06:'IGN_LS4|ign', A07:'IGN_LS5|ign', A08:'IGN_LS6|ign', A09:'SEN_5V0_B|pwr', A10:'BAT_NEG1|gnd',
    A11:'BAT_NEG2|gnd', A12:'IGN_LS7|ign', A13:'IGN_LS8|ign', A14:'AV1|ain', A15:'AV2|ain',
    A16:'AV3|ain', A17:'AV4|ain', A18:'OUT_HB1|hb', A19:'INJ_PH1|inj', A20:'INJ_PH2|inj',
    A21:'INJ_PH3|inj', A22:'INJ_PH4|inj', A23:'INJ_LS1|inj', A24:'INJ_LS2|inj', A25:'AV5|ain',
    A26:'BAT_POS|pwr', A27:'INJ_PH5|inj', A28:'INJ_PH6|inj', A29:'INJ_PH7|inj', A30:'INJ_PH8|inj',
    A31:'OUT_HB3|hb', A32:'OUT_HB4|hb', A33:'OUT_HB5|hb', A34:'OUT_HB6|hb',
    B01:'UDIG1|dig', B02:'UDIG2|dig', B03:'AT1|tmp', B04:'AT2|tmp', B05:'AT3|tmp',
    B06:'AT4|tmp', B07:'KNOCK1|knk', B08:'UDIG3|dig', B09:'UDIG4|dig', B10:'UDIG5|dig',
    B11:'UDIG6|dig', B12:'BAT_BAK|pwr', B13:'KNOCK2|knk', B14:'UDIG7|dig', B15:'SEN_0V_A|gnd',
    B16:'SEN_0V_B|gnd', B17:'CAN_HI|can', B18:'CAN_LO|can', B19:'SEN_6V3|pwr', B20:'AV6|ain',
    B21:'AV7|ain', B22:'AV8|ain', B23:'ETH_TX+|eth', B24:'ETH_TX-|eth', B25:'ETH_RX+|eth', B26:'ETH_RX-|eth',
  };

  const TYPE_COLORS: Record<string, string> = {
    inj: '#2d7d2d', ign: '#1a5276', hb: '#7d3c98', ain: '#b7950b',
    tmp: '#a04000', dig: '#1a5276', knk: '#666', pwr: '#c0392b',
    gnd: '#333', can: '#117a65', eth: '#5b2c6f',
  };

  return (
    <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace' }}>
      {connectors.map(conn => {
        const pins = Array.from({ length: conn.pins }, (_, i) => {
          const pinId = `${conn.prefix}${String(i + 1).padStart(2, '0')}`;
          const pinData = M130_PINS[pinId];
          const [fn, type] = pinData ? pinData.split('|') : ['—', ''];
          const assigned = pinMap.get(pinId);
          return { pinId, fn, type, assigned };
        });

        const assignedCount = pins.filter(p => p.assigned).length;
        const infraCount = pins.filter(p => ['pwr', 'gnd', 'can', 'eth'].includes(p.type)).length;
        const unusedCount = conn.pins - assignedCount - infraCount;

        return (
          <div key={conn.name} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'Arial', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
              <span>{ecuModel} {conn.name} ({conn.type})</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{assignedCount} assigned | {infraCount} infrastructure | {unusedCount} available</span>
            </div>
            <div style={{ fontSize: '7px', color: 'var(--text-secondary)', fontFamily: 'Arial', marginBottom: 4 }}>
              MATING: {conn.te}
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '2px 0', borderBottom: '1px solid var(--border)', marginBottom: 2, fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'Arial' }}>
              <span style={{ width: 30 }}>PIN</span>
              <span style={{ width: 70 }}>FUNCTION</span>
              <span style={{ width: 45 }}>TYPE</span>
              <span style={{ width: 170 }}>ASSIGNED TO</span>
              <span style={{ width: 35 }}>GAUGE</span>
              <span style={{ width: 55 }}>COLOR</span>
            </div>
            {pins.map(p => (
              <div key={p.pinId} style={{
                display: 'flex', gap: 4, padding: '1px 0',
                color: p.assigned ? 'var(--text)' : ['pwr','gnd','can','eth'].includes(p.type) ? 'var(--text-secondary)' : 'rgba(0,0,0,0.25)',
              }}>
                <span style={{ width: 30, fontWeight: 700 }}>{p.pinId}</span>
                <span style={{ width: 70, color: TYPE_COLORS[p.type] || '#999' }}>{p.fn}</span>
                <span style={{ width: 45, fontSize: '8px' }}>
                  {p.type === 'inj' ? 'INJ' : p.type === 'ign' ? 'IGN' : p.type === 'hb' ? 'H-BRG' :
                   p.type === 'ain' ? 'AN-V' : p.type === 'tmp' ? 'AN-T' : p.type === 'dig' ? 'DIG' :
                   p.type === 'knk' ? 'KNOCK' : p.type === 'pwr' ? 'PWR' : p.type === 'gnd' ? 'GND' :
                   p.type === 'can' ? 'CAN' : p.type === 'eth' ? 'ETH' : '—'}
                </span>
                <span style={{ width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.assigned ? p.assigned.label : ['pwr','gnd','can','eth'].includes(p.type) ? '(infrastructure)' : '—'}
                </span>
                <span style={{ width: 35 }}>{p.assigned ? `${p.assigned.gauge}ga` : ''}</span>
                <span style={{ width: 55 }}>{p.assigned ? p.assigned.color : ''}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ fontSize: '7px', color: 'var(--text-secondary)', fontFamily: 'Arial', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4 }}>
        SOURCE: MOTEC M1 ECU HARDWARE TECH NOTE P16 (M130) / P24 (M150) | PIN MAPS VALIDATED 2026-03-23
      </div>
    </div>
  );
}

// ── Main Sandbox Component ──────────────────────────────────────────

interface Props {
  initialDevices?: ManifestDevice[];
  vehicleId?: string;
}

export function WiringOverlaySandbox({ initialDevices = [], vehicleId }: Props) {
  const { devices, result, delta, addDevice, removeDevice } = useOverlayCompute(initialDevices);
  const [activeTab, setActiveTab] = useState<'channels' | 'wires' | 'connectors' | 'devices'>('channels');
  const [generating, setGenerating] = useState(false);

  const handleQuickAdd = (templateName: string) => {
    const template = DEVICE_TEMPLATES[templateName];
    if (template) {
      // Append a number if duplicate name exists
      const existing = devices.filter(d => d.device_name.startsWith(template.device_name)).length;
      const name = existing > 0 ? `${template.device_name} ${existing + 1}` : template.device_name;
      addDevice({ ...template, device_name: name });
    }
  };

  const tabStyle = (active: boolean) => ({
    fontSize: 'var(--fs-9, 9px)', fontFamily: 'Arial, sans-serif', fontWeight: active ? 700 : 400,
    padding: '4px 12px', border: '2px solid var(--border)', borderBottom: active ? 'none' : undefined,
    background: active ? 'var(--bg, #f5f5f5)' : 'var(--surface)',
    cursor: 'pointer', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  });

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: 'var(--text, #2a2a2a)', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{
        fontSize: 'var(--fs-10, 10px)', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '1px', padding: '8px 12px',
        borderBottom: '2px solid var(--text, #2a2a2a)',
      }}>
        WIRING OVERLAY SANDBOX {vehicleId ? `— ${vehicleId.slice(0, 8)}` : ''}
      </div>

      {/* Status Bar */}
      <StatusBar result={result} delta={delta} />

      {/* Delta Flash */}
      <DeltaFlash delta={delta} />

      {/* Main Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, marginTop: 8 }}>
        {/* Left: Quick Add + Device List */}
        <div style={{ borderRight: '2px solid var(--border)', padding: '8px 12px' }}>
          <QuickAddPanel onAdd={handleQuickAdd} />
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 8 }}>
            <DeviceList devices={devices} onRemove={removeDevice} />
          </div>
        </div>

        {/* Right: Results */}
        <div style={{ padding: '8px 12px' }}>
          {/* ECU Options */}
          <ECUOptionsPanel options={result.ecuOptions} />

          <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            <button style={tabStyle(activeTab === 'channels')} onClick={() => setActiveTab('channels')}>PDM30 OUTPUTS</button>
            <button style={tabStyle(activeTab === 'wires')} onClick={() => setActiveTab('wires')}>WIRES ({result.wireCount})</button>
            <button style={tabStyle(activeTab === 'connectors')} onClick={() => setActiveTab('connectors')}>ECU CONNECTORS</button>
            <button style={tabStyle(activeTab === 'devices')} onClick={() => setActiveTab('devices')}>SUMMARY</button>
          </div>

          <div style={{ border: '2px solid var(--border)', borderTop: 'none', padding: 8 }}>
            {activeTab === 'channels' && (
              <PDMChannelsPanel channels={result.pdmChannels} config={result.recommendedConfig.pdm.config} />
            )}
            {activeTab === 'wires' && (
              <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace', maxHeight: 400, overflow: 'auto' }}>
                <div style={{ display: 'flex', gap: 4, padding: '2px 0', borderBottom: '1px solid var(--border)', marginBottom: 2, fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'Arial' }}>
                  <span style={{ width: 25 }}>#</span>
                  <span style={{ width: 170 }}>CIRCUIT</span>
                  <span style={{ width: 90 }}>FROM</span>
                  <span style={{ width: 35 }}>GAUGE</span>
                  <span style={{ width: 65 }}>COLOR</span>
                  <span style={{ width: 40, textAlign: 'right' }}>LENGTH</span>
                  <span style={{ width: 45 }}>NOTES</span>
                </div>
                {result.wires.map(w => (
                  <div key={w.wireNumber} style={{ display: 'flex', gap: 4, padding: '1px 0' }}>
                    <span style={{ width: 25, color: 'var(--text-secondary)' }}>{w.wireNumber}</span>
                    <span style={{ width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.label}</span>
                    <span style={{ width: 90, color: 'var(--text-secondary)', fontSize: '8px' }}>{w.from}</span>
                    <span style={{ width: 35 }}>{w.gauge}ga</span>
                    <span style={{ width: 65 }}>{w.color}</span>
                    <span style={{ width: 40, textAlign: 'right' }}>{w.lengthFt.toFixed(1)}ft</span>
                    <span style={{ width: 45, fontSize: '8px', color: 'var(--text-secondary)' }}>
                      {w.isShielded ? 'SHLD' : ''}{w.isTwistedPair ? 'TWST' : ''}
                      {w.voltageDropPct > 2 ? ` ${w.voltageDropPct.toFixed(1)}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'connectors' && (
              <ECUConnectorView ecuModel={result.recommendedConfig.ecu.model} wires={result.wires} />
            )}
            {activeTab === 'devices' && (
              <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: 'Courier New, monospace' }}>
                <div>Devices: {result.deviceCount} | Purchased: {result.devicesPurchased} | Unpurchased: {result.devicesUnpurchased}</div>
                <div>Parts cost: ${result.partsCost.toLocaleString()} | ECU+PDM: ${result.recommendedConfig.totalCost.toLocaleString()}</div>
                <div>Total: ${(result.partsCost + result.recommendedConfig.totalCost).toLocaleString()}</div>
                <div>Avg completion: {result.avgCompletion}% | At zero: {result.devicesAtZero}</div>
                <div>Alternator: {result.alternatorAmps}A ({result.alternatorRecommendation})</div>
                <div>Continuous draw: {result.totalContinuousAmps}A</div>
                <div>I/O: {result.io.injectorOutputs}inj {result.io.ignitionOutputs}ign {result.io.halfBridgeOutputs}hb {result.io.analogInputs}an {result.io.tempInputs}tmp {result.io.digitalInputs}dig</div>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <WarningsPanel warnings={result.warnings} />
          </div>

          {/* Generate Documents */}
          {vehicleId && (
            <div style={{ borderTop: '2px solid var(--border)', marginTop: 12, paddingTop: 8 }}>
              <div style={{ fontSize: 'var(--fs-8, 8px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 6 }}>
                GENERATE PROFESSIONAL DOCUMENTS
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['cut-list', 'connector-schedule', 'bom'] as const).map(doc => (
                  <button key={doc} disabled={generating} onClick={async () => {
                    setGenerating(true);
                    try {
                      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-wiring-${doc === 'bom' ? 'bom' : doc}`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vehicle_id: vehicleId, format: 'text' }),
                      });
                      const text = await resp.text();
                      const blob = new Blob([text], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `K5_${doc.replace('-', '_')}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) { console.error(e); }
                    setGenerating(false);
                  }} style={{
                    fontSize: 'var(--fs-9, 9px)', fontFamily: 'Arial', fontWeight: 700,
                    padding: '6px 14px', border: '2px solid var(--text)', background: 'var(--text)',
                    color: 'var(--bg, #f5f5f5)', cursor: generating ? 'wait' : 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.5px', opacity: generating ? 0.5 : 1,
                  }}>
                    {doc === 'cut-list' ? 'CUT LIST' : doc === 'connector-schedule' ? 'CONNECTOR SCHEDULE' : 'BILL OF MATERIALS'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '7px', color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'Arial', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                GENERATES PRINTABLE DOCUMENTS FROM VALIDATED PIN MAPS AND LIVE MANIFEST DATA
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WiringOverlaySandbox;

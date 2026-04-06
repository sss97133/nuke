// ConnectorFaceView.tsx — Renders mating-face pin layout for any connector
// Shows populated pins (filled) vs empty (outline). Click pin → wire detail.

import React from 'react';
import type { ComponentConnector, ComponentPin } from './useComponentLibrary';
import type { WireSpec } from './overlayCompute';

// ── Pin type colors (matches ECUConnectorView palette) ────────────────
const PIN_TYPE_COLORS: Record<string, string> = {
  injector: '#2d7d2d', ignition: '#1a5276', half_bridge: '#7d3c98',
  analog: '#b7950b', temperature: '#a04000', digital: '#1a5276',
  knock: '#666', power: '#c0392b', ground: '#333', can: '#117a65',
  ethernet: '#5b2c6f', output: '#7d3c98', input: '#b7950b',
  sensor: '#b7950b',
};

function pinColor(pin: ComponentPin): string {
  const fn = (pin.function || pin.direction || '').toLowerCase();
  for (const [key, color] of Object.entries(PIN_TYPE_COLORS)) {
    if (fn.includes(key)) return color;
  }
  return '#999';
}

// ── Shared styles ─────────────────────────────────────────────────────
const label: React.CSSProperties = {
  fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
  color: 'var(--text-secondary, #666)', fontWeight: 700, fontFamily: 'Arial, sans-serif',
};
const sectionTitle: React.CSSProperties = {
  ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4,
  paddingBottom: 3, borderBottom: '2px solid var(--text, #2a2a2a)',
};

// ── Props ─────────────────────────────────────────────────────────────
interface Props {
  connector: ComponentConnector;
  wires?: WireSpec[];
  ecuModel?: string;
  onPinClick?: (pin: ComponentPin, wire?: WireSpec) => void;
}

export function ConnectorFaceView({ connector, wires = [], ecuModel, onPinClick }: Props) {
  if (!connector.pins || connector.pins.length === 0) return null;

  const pins = connector.pins;
  const pinCount = pins.length;

  // Build wire assignment map: pin number → wire
  const wireMap = new Map<string, WireSpec>();
  for (const w of wires) {
    // Match ECU pin assignments like "M130:A01" or "PDM30:OUT1"
    const fromPin = w.from.includes(':') ? w.from.split(':')[1] : null;
    if (fromPin) wireMap.set(fromPin, w);
  }

  // Layout: determine grid dimensions
  // For Superseal connectors: use standard oval/rectangular layout
  const cols = pinCount <= 8 ? pinCount : pinCount <= 18 ? Math.ceil(pinCount / 2) : Math.ceil(pinCount / 3);
  const rows = Math.ceil(pinCount / cols);
  const pinSize = 14;
  const pinGap = 3;
  const gridW = cols * (pinSize + pinGap) - pinGap;
  const gridH = rows * (pinSize + pinGap) - pinGap;

  const assignedCount = pins.filter(p => wireMap.has(p.number)).length;
  const infraCount = pins.filter(p => {
    const fn = (p.function || '').toLowerCase();
    return fn.includes('power') || fn.includes('ground') || fn.includes('can') || fn.includes('ethernet');
  }).length;

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{
        ...sectionTitle,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>
          {ecuModel ? `${ecuModel} ` : ''}CONNECTOR {connector.connector_label}
          {connector.connector_type ? ` (${connector.connector_type})` : ''}
        </span>
        <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
          {assignedCount}/{pinCount} ASSIGNED
        </span>
      </div>

      {/* Connector housing info */}
      <div style={{
        fontSize: '7px', color: 'var(--text-secondary)', fontFamily: 'Arial',
        marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap',
      }}>
        {connector.harness_side_pn && (
          <span>MATING: {connector.harness_side_pn}</span>
        )}
        {connector.keying && (
          <span>KEYING: {connector.keying}</span>
        )}
        {connector.sealed && (
          <span>SEALED: YES</span>
        )}
      </div>

      {/* Pin grid — mating face view */}
      <div style={{
        display: 'flex', justifyContent: 'center', padding: '8px 0',
        marginBottom: 8,
      }}>
        <div style={{
          position: 'relative',
          border: '2px solid var(--text, #2a2a2a)',
          borderRadius: 0,
          padding: 8,
          background: 'var(--surface, #ebebeb)',
        }}>
          <svg
            width={gridW + 16}
            height={gridH + 16}
            viewBox={`-8 -8 ${gridW + 16} ${gridH + 16}`}
          >
            {pins.map((pin, i) => {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const cx = col * (pinSize + pinGap) + pinSize / 2;
              const cy = row * (pinSize + pinGap) + pinSize / 2;
              const wire = wireMap.get(pin.number);
              const isAssigned = !!wire;
              const color = pinColor(pin);

              return (
                <g
                  key={pin.number}
                  style={{ cursor: onPinClick ? 'pointer' : 'default' }}
                  onClick={() => onPinClick?.(pin, wire)}
                >
                  {/* Pin circle */}
                  <circle
                    cx={cx} cy={cy} r={pinSize / 2 - 1}
                    fill={isAssigned ? color : 'none'}
                    stroke={color}
                    strokeWidth={1.5}
                    opacity={isAssigned ? 1 : 0.4}
                  />
                  {/* Pin number */}
                  <text
                    x={cx} y={cy + 0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                      fontSize: pinCount > 20 ? '5px' : '6px',
                      fontFamily: '"Courier New", monospace',
                      fontWeight: 700,
                      fill: isAssigned ? '#fff' : color,
                      userSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  >
                    {pin.number.replace(/^[A-Z]/, '')}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Pin table */}
      <div style={{ fontSize: '9px', fontFamily: '"Courier New", monospace', maxHeight: 300, overflow: 'auto' }}>
        <div style={{
          display: 'flex', gap: 4, padding: '2px 0',
          borderBottom: '1px solid var(--border)', marginBottom: 2,
          fontWeight: 700, fontSize: '7px', textTransform: 'uppercase',
          letterSpacing: '0.5px', fontFamily: 'Arial',
        }}>
          <span style={{ width: 30 }}>PIN</span>
          <span style={{ width: 80 }}>FUNCTION</span>
          <span style={{ width: 45 }}>DIR</span>
          <span style={{ width: 130 }}>ASSIGNED TO</span>
          <span style={{ width: 35 }}>GAUGE</span>
          <span style={{ width: 50 }}>COLOR</span>
        </div>
        {pins.map(pin => {
          const wire = wireMap.get(pin.number);
          const fn = pin.function || '';
          const isInfra = fn.includes('power') || fn.includes('ground') || fn.includes('can') || fn.includes('ethernet');
          return (
            <div
              key={pin.number}
              style={{
                display: 'flex', gap: 4, padding: '1px 0',
                cursor: onPinClick ? 'pointer' : 'default',
                color: wire ? 'var(--text)' : isInfra ? 'var(--text-secondary)' : 'rgba(0,0,0,0.25)',
              }}
              onClick={() => onPinClick?.(pin, wire)}
            >
              <span style={{ width: 30, fontWeight: 700, color: pinColor(pin) }}>{pin.number}</span>
              <span style={{ width: 80, fontSize: '8px' }}>{pin.designation || '—'}</span>
              <span style={{ width: 45, fontSize: '8px', color: 'var(--text-secondary)' }}>
                {(pin.direction || '').toUpperCase().slice(0, 3) || '—'}
              </span>
              <span style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wire ? wire.label : isInfra ? `(${pin.full_name || fn})` : '—'}
              </span>
              <span style={{ width: 35 }}>{wire ? `${wire.gauge}ga` : pin.wire_gauge_awg ? `${pin.wire_gauge_awg}ga` : ''}</span>
              <span style={{ width: 50 }}>{wire ? wire.color : ''}</span>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div style={{
        fontSize: '7px', color: 'var(--text-secondary)', marginTop: 6,
        fontFamily: 'Arial', textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        {assignedCount} ASSIGNED | {infraCount} INFRASTRUCTURE | {pinCount - assignedCount - infraCount} AVAILABLE
      </div>
    </div>
  );
}

// SchematicViewer.tsx — SVG schematics with 5 sub-sheets
// Power, Engine, Lighting, Body, Audio. Click device → detail. DRC dots. Dark/light toggle.

import React, { useCallback, useMemo, useState } from 'react';
import type { ManifestDevice, WireSpec, PDMChannel } from './overlayCompute';
import type { DRCDeviceResult } from './useDRC';

// ── Sheet Definitions ────────────────────────────────────────────────
const SHEETS = [
  { id: 'power', label: 'POWER', categories: ['power_distribution', 'starting', 'charging'] },
  { id: 'engine', label: 'ENGINE', categories: ['engine_management', 'engine_mgmt', 'fuel', 'cooling'] },
  { id: 'lighting', label: 'LIGHTING', categories: ['lighting'] },
  { id: 'body', label: 'BODY', categories: ['body', 'safety', 'controls', 'gauges', 'comfort'] },
  { id: 'audio', label: 'AUDIO', categories: ['audio', 'entertainment'] },
] as const;

type SheetId = typeof SHEETS[number]['id'];

// ── Color Maps ──────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  power_distribution: '#cc4444', starting: '#cc6644', charging: '#cc8844',
  engine_management: '#44aa44', engine_mgmt: '#44aa44', fuel: '#cc44aa', cooling: '#4488cc',
  lighting: '#ccaa33', sensors: '#9966cc', safety: '#cc4444',
  body: '#6688cc', controls: '#6688cc', gauges: '#888888',
  audio: '#cc8833', entertainment: '#cc8833', comfort: '#6688cc',
};

const DRC_COLORS: Record<string, string> = {
  pass: '#22aa44', warn: '#ccaa00', fail: '#cc2222',
};

interface LightTheme {
  bg: string; deviceFill: string; deviceStroke: string; wireColor: string;
  gridColor: string; textColor: string; textDim: string; groundColor: string;
}

const DARK_THEME: LightTheme = {
  bg: '#1a1a2e', deviceFill: '#252540', deviceStroke: '#e0e0e8',
  wireColor: '#e0e0e8', gridColor: '#2a2a3e', textColor: '#e0e0e8',
  textDim: '#8888aa', groundColor: '#888888',
};

const LIGHT_THEME: LightTheme = {
  bg: '#ffffff', deviceFill: '#f5f5f5', deviceStroke: '#333333',
  wireColor: '#333333', gridColor: '#e8e8e8', textColor: '#333333',
  textDim: '#888888', groundColor: '#666666',
};

// ── Props ────────────────────────────────────────────────────────────
interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  pdmChannels: PDMChannel[];
  drcMap: Map<string, DRCDeviceResult>;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, e: React.MouseEvent) => void;
  onWireClick: (wireNumber: number) => void;
}

export function SchematicViewer({
  devices, wires, pdmChannels, drcMap,
  selectedDeviceId, selectedDeviceIds, selectedWireId,
  onDeviceClick, onWireClick,
}: Props) {
  const [activeSheet, setActiveSheet] = useState<SheetId>('engine');
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('schematic-dark') !== 'false'; } catch { return true; }
  });
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);
  const [drcPopover, setDrcPopover] = useState<{ deviceId: string; x: number; y: number } | null>(null);

  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  const toggleDark = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem('schematic-dark', String(next)); } catch {}
      return next;
    });
  }, []);

  // Filter devices for current sheet
  const sheetDef = SHEETS.find(s => s.id === activeSheet)!;
  const sheetDevices = useMemo(() => {
    const cats = new Set(sheetDef.categories);
    // Also include sensors on the engine sheet
    return devices.filter(d => {
      const cat = d.device_category || '';
      if (cats.has(cat)) return true;
      if (activeSheet === 'engine' && cat === 'sensors') return true;
      // Catch-all: unmatched devices go to body sheet
      if (activeSheet === 'body') {
        return !SHEETS.some(s => s.id !== 'body' && s.categories.some(c => c === cat));
      }
      return false;
    });
  }, [devices, sheetDef, activeSheet]);

  // Sheet wire connections
  const sheetWires = useMemo(() => {
    const deviceNames = new Set(sheetDevices.map(d => d.device_name));
    return wires.filter(w => deviceNames.has(w.to));
  }, [wires, sheetDevices]);

  // Layout devices in a schematic grid
  const deviceLayout = useMemo(() => {
    const layout = new Map<string, { x: number; y: number; w: number; h: number }>();
    const cols = Math.ceil(Math.sqrt(sheetDevices.length * 1.5));
    const cellW = 160;
    const cellH = 80;
    const padding = 40;

    sheetDevices.forEach((d, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      layout.set(d.id, {
        x: padding + col * (cellW + 30),
        y: padding + 50 + row * (cellH + 40),
        w: cellW,
        h: cellH,
      });
    });
    return layout;
  }, [sheetDevices]);

  const svgW = useMemo(() => {
    let maxX = 800;
    deviceLayout.forEach(v => { maxX = Math.max(maxX, v.x + v.w + 60); });
    return maxX;
  }, [deviceLayout]);
  const svgH = useMemo(() => {
    let maxY = 600;
    deviceLayout.forEach(v => { maxY = Math.max(maxY, v.y + v.h + 60); });
    return maxY;
  }, [deviceLayout]);

  // Wire color mapper
  const wireDisplayColor = useCallback((wire: WireSpec) => {
    if (isDark && wire.color.includes('BLK')) return theme.groundColor;
    const c = wire.color;
    if (c.includes('RED')) return '#cc4444';
    if (c.includes('GRN')) return '#44aa44';
    if (c.includes('BLU')) return '#4488cc';
    if (c.includes('WHT')) return isDark ? '#aaaaaa' : '#999999';
    if (c.includes('VIO')) return '#9966cc';
    if (c.includes('ORG')) return '#cc8833';
    if (c.includes('YEL')) return '#ccaa33';
    if (c.includes('TAN')) return '#aa8866';
    if (c.includes('PNK')) return '#cc6688';
    if (c.includes('BRN')) return '#886644';
    return isDark ? '#aaaaaa' : '#666666';
  }, [isDark, theme.groundColor]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg }}>
      {/* Tab Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px',
        borderBottom: `2px solid ${isDark ? '#2a2a5e' : '#cccccc'}`,
        background: isDark ? '#1e1e32' : '#f0f0f0', flexShrink: 0,
      }}>
        {SHEETS.map(sheet => {
          const count = devices.filter(d => {
            const cats = new Set(sheet.categories);
            if (cats.has(d.device_category || '')) return true;
            if (sheet.id === 'engine' && d.device_category === 'sensors') return true;
            return false;
          }).length;
          return (
            <button
              key={sheet.id}
              onClick={() => setActiveSheet(sheet.id)}
              style={{
                fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', textTransform: 'uppercase',
                letterSpacing: '0.5px', padding: '3px 10px', border: `2px solid ${isDark ? '#2a2a5e' : '#cccccc'}`,
                background: activeSheet === sheet.id ? (isDark ? '#00ddff' : '#333333') : 'transparent',
                color: activeSheet === sheet.id ? (isDark ? '#1a1a2e' : '#ffffff') : theme.textDim,
                cursor: 'pointer',
              }}
            >
              {sheet.label} ({count})
            </button>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={toggleDark}
            style={{
              fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', padding: '3px 10px',
              border: `2px solid ${isDark ? '#2a2a5e' : '#cccccc'}`,
              background: isDark ? '#252540' : '#ffffff',
              color: theme.textDim, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            {isDark ? 'LIGHT' : 'DARK'}
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ display: 'block' }}
        >
          {/* Grid */}
          {Array.from({ length: Math.ceil(svgW / 40) + 1 }).map((_, i) => (
            <line key={`gx${i}`} x1={i * 40} y1={0} x2={i * 40} y2={svgH}
              stroke={theme.gridColor} strokeWidth={0.5} />
          ))}
          {Array.from({ length: Math.ceil(svgH / 40) + 1 }).map((_, i) => (
            <line key={`gy${i}`} x1={0} y1={i * 40} x2={svgW} y2={i * 40}
              stroke={theme.gridColor} strokeWidth={0.5} />
          ))}

          {/* Sheet title */}
          <text x={20} y={30} fill={theme.textDim}
            style={{ fontSize: '10px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '1px' }}>
            {sheetDef.label} SCHEMATIC — {sheetDevices.length} DEVICES — {sheetWires.length} WIRES
          </text>

          {/* Wire paths */}
          {sheetWires.map(wire => {
            const toDevice = sheetDevices.find(d => d.device_name === wire.to);
            if (!toDevice) return null;
            const toLayout = deviceLayout.get(toDevice.id);
            if (!toLayout) return null;

            // Source from top-center as bus bar
            const srcX = svgW / 2;
            const srcY = 20;
            const dstX = toLayout.x + toLayout.w / 2;
            const dstY = toLayout.y;

            const isHighlighted = selectedWireId === wire.wireNumber;
            const isDimmed = selectedWireId != null && !isHighlighted;
            const color = wireDisplayColor(wire);

            return (
              <g key={wire.wireNumber} onClick={(e) => { e.stopPropagation(); onWireClick(wire.wireNumber); }}
                style={{ cursor: 'pointer' }}>
                <path
                  d={`M ${srcX} ${srcY} C ${srcX} ${(srcY + dstY) / 2}, ${dstX} ${(srcY + dstY) / 2}, ${dstX} ${dstY}`}
                  fill="none"
                  stroke={isHighlighted ? '#00ddff' : color}
                  strokeWidth={isHighlighted ? 3 : 1.5}
                  opacity={isDimmed ? 0.15 : 1}
                  filter={isHighlighted ? 'url(#glowFilter)' : undefined}
                  style={{ transition: 'opacity 200ms' }}
                />
                {/* Wire label on hover area */}
                <path
                  d={`M ${srcX} ${srcY} C ${srcX} ${(srcY + dstY) / 2}, ${dstX} ${(srcY + dstY) / 2}, ${dstX} ${dstY}`}
                  fill="none" stroke="transparent" strokeWidth={8}
                />
              </g>
            );
          })}

          {/* Device boxes */}
          {sheetDevices.map(device => {
            const layout = deviceLayout.get(device.id);
            if (!layout) return null;

            const isSelected = device.id === selectedDeviceId || selectedDeviceIds.has(device.id);
            const isDimmed = (selectedDeviceId != null || selectedDeviceIds.size > 0 || selectedWireId != null)
              && !isSelected
              && !wires.some(w => w.wireNumber === selectedWireId && w.to === device.device_name);
            const isHovered = hoveredDevice === device.id;
            const drc = drcMap.get(device.id);
            const catColor = CATEGORY_COLORS[device.device_category || ''] || theme.textDim;

            return (
              <g
                key={device.id}
                onClick={(e) => onDeviceClick(device.id, e)}
                onMouseEnter={() => setHoveredDevice(device.id)}
                onMouseLeave={() => setHoveredDevice(null)}
                style={{
                  cursor: 'pointer',
                  opacity: isDimmed ? 0.25 : 1,
                  transition: 'opacity 200ms',
                }}
              >
                {/* Device rect */}
                <rect
                  x={layout.x} y={layout.y} width={layout.w} height={layout.h}
                  fill={theme.deviceFill}
                  stroke={isSelected ? '#00ddff' : isHovered ? catColor : theme.deviceStroke}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={selectedDeviceIds.has(device.id) ? '4,2' : undefined}
                />
                {/* Category color accent bar */}
                <rect x={layout.x} y={layout.y} width={4} height={layout.h} fill={catColor} />

                {/* Device name */}
                <text x={layout.x + 10} y={layout.y + 16} fill={theme.textColor}
                  style={{ fontSize: '9px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '0.5px' }}>
                  {device.device_name.length > 22 ? device.device_name.slice(0, 21) + '...' : device.device_name}
                </text>

                {/* Details line */}
                <text x={layout.x + 10} y={layout.y + 28} fill={theme.textDim}
                  style={{ fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700 }}>
                  {device.connector_type || '—'} | {device.pin_count || 0}P | {device.power_draw_amps != null ? `${device.power_draw_amps}A` : '—'}
                </text>

                {/* Wire info */}
                {(() => {
                  const wire = wires.find(w => w.to === device.device_name);
                  if (!wire) return null;
                  return (
                    <text x={layout.x + 10} y={layout.y + 40} fill={theme.textDim}
                      style={{ fontSize: '7px', fontFamily: '"Courier New"' }}>
                      W{wire.wireNumber} | {wire.gauge}AWG {wire.color} | {wire.from}
                    </text>
                  );
                })()}

                {/* Zone badge */}
                {device.location_zone && (
                  <g>
                    <rect
                      x={layout.x + 10} y={layout.y + layout.h - 20}
                      width={60} height={14}
                      fill={CATEGORY_COLORS[device.device_category || ''] || '#555577'}
                      opacity={0.3}
                    />
                    <text
                      x={layout.x + 14} y={layout.y + layout.h - 10}
                      fill={theme.textColor}
                      style={{ fontSize: '7px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '0.3px' }}
                    >
                      {device.location_zone.replace(/_/g, ' ').toUpperCase()}
                    </text>
                  </g>
                )}

                {/* Part number */}
                {device.part_number && (
                  <text
                    x={layout.x + layout.w - 6} y={layout.y + layout.h - 10}
                    fill={theme.textDim} textAnchor="end"
                    style={{ fontSize: '6px', fontFamily: '"Courier New"' }}
                  >
                    {device.part_number}
                  </text>
                )}

                {/* DRC indicator dot */}
                {drc && (
                  <circle
                    cx={layout.x + layout.w - 8}
                    cy={layout.y + 8}
                    r={4}
                    fill={DRC_COLORS[drc.severity]}
                    stroke={theme.deviceFill}
                    strokeWidth={1}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const svgRect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
                      if (svgRect) {
                        setDrcPopover({ deviceId: device.id, x: e.clientX - svgRect.left, y: e.clientY - svgRect.top });
                      }
                    }}
                  />
                )}
              </g>
            );
          })}

          {/* Glow filter for highlighted wires */}
          <defs>
            <filter id="glowFilter" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor="#00ddff" floodOpacity="0.6" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Net badge */}
          {selectedWireId != null && (() => {
            const wire = wires.find(w => w.wireNumber === selectedWireId);
            if (!wire) return null;
            const netWires = wires.filter(w =>
              (wire.pdmChannel && w.pdmChannel === wire.pdmChannel) ||
              (wire.signalType === 'can_bus' && w.signalType === 'can_bus') ||
              w.wireNumber === wire.wireNumber
            );
            const netLabel = wire.pdmChannel ? `PDM CH${wire.pdmChannel}` : wire.to;
            return (
              <g>
                <rect x={20} y={svgH - 30} width={220} height={22} fill="rgba(0,221,255,0.9)" />
                <text x={30} y={svgH - 14} fill="#1a1a2e"
                  style={{ fontSize: '9px', fontFamily: 'Arial', fontWeight: 700 }}>
                  NET: {netLabel} — {netWires.length} WIRE{netWires.length !== 1 ? 'S' : ''}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* DRC Popover */}
        {drcPopover && (() => {
          const drc = drcMap.get(drcPopover.deviceId);
          const device = devices.find(d => d.id === drcPopover.deviceId);
          if (!drc || !device) return null;
          return (
            <div
              style={{
                position: 'absolute', left: drcPopover.x + 10, top: drcPopover.y - 10,
                background: '#1e1e32', border: '2px solid #2a2a5e', padding: '8px 10px',
                zIndex: 20, minWidth: 200, fontFamily: 'Arial',
              }}
              onClick={() => setDrcPopover(null)}
            >
              <div style={{ fontSize: '8px', fontWeight: 700, color: '#e0e0e8', marginBottom: 6, letterSpacing: '0.5px' }}>
                DRC: {device.device_name}
              </div>
              {drc.rules.map(rule => (
                <div key={rule.ruleId} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0',
                  borderBottom: '1px solid #2a2a5e',
                }}>
                  <span style={{
                    width: 6, height: 6, display: 'inline-block', flexShrink: 0,
                    background: DRC_COLORS[rule.severity],
                  }} />
                  <span style={{ fontSize: '7px', fontWeight: 700, color: '#8888aa', width: 80, letterSpacing: '0.3px' }}>
                    {rule.label}
                  </span>
                  <span style={{ fontSize: '7px', color: '#e0e0e8', fontFamily: '"Courier New"' }}>
                    {rule.message}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

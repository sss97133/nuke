// WiringDeviceNode.tsx — Electrical schematic symbols for wiring canvas
// Uses standard IEEE/IEC schematic symbols that any electrician recognizes.
// Motor = ⊕, Relay = ▭, Switch = /, Sensor = ◇, Light = ☀, Ground = ⏚, etc.

import React, { useCallback, useRef } from 'react';
import type { ManifestDevice, WireSpec } from './overlayCompute';

// ── Standard symbol size (in SVG canvas units) ──
export const SYMBOL_SIZE = 16;

// ── Symbol Classification ──────────────────────────────────────────────
type SymbolType = 'motor' | 'relay' | 'switch' | 'fuse' | 'sensor' | 'temp_sensor' |
  'pressure_sensor' | 'light' | 'ground' | 'battery' | 'ecu' | 'pdm' | 'speaker' |
  'solenoid' | 'resistor' | 'connector' | 'camera' | 'display' | 'generic';

function classifySymbol(d: ManifestDevice): SymbolType {
  const n = d.device_name.toLowerCase();
  const s = (d.signal_type || '').toLowerCase();
  const c = (d.device_category || '').toLowerCase();

  // Ground points
  if (n.includes('ground')) return 'ground';
  // Battery
  if (n.includes('battery') && !n.includes('disconnect')) return 'battery';
  // ECU / Controllers
  if (c === 'ecu' || n === 'ecu' || n.includes('transmission controller')) return 'ecu';
  if (n.includes('power distribution') || n.includes('pdm')) return 'pdm';
  // Display
  if (n.includes('display') || n.includes('gauge') || n.includes('dakota digital')) return 'display';
  // Motors (fans, pumps, window motors, wiper, starter, etc.)
  if (s === 'motor' || s === 'high_current' || n.includes('fan') || n.includes('pump') ||
      n.includes('motor') || n.includes('starter') || n.includes('blower') ||
      n.includes('compressor') || n.includes('antenna')) return 'motor';
  // Relays
  if (c === 'relay' || n.includes('relay')) return 'relay';
  // Switches
  if (n.includes('switch') || s === 'standalone_switch' || s === 'pdm_input') return 'switch';
  // Fuses (if we ever add them)
  if (n.includes('fuse') || n.includes('flasher')) return 'fuse';
  // Temp sensors
  if (s === 'analog_temp' || n.includes('temp')) return 'temp_sensor';
  // Pressure sensors
  if (n.includes('pressure') || n.includes('map sensor')) return 'pressure_sensor';
  // Other sensors
  if (c === 'sensors' || s.includes('analog') || s === 'piezoelectric' ||
      s === 'wideband_lambda' || s === 'hall_effect' || s === 'ecu_digital_input' ||
      n.includes('sensor') || n.includes('knock') || n.includes('position') ||
      n.includes('speed')) return 'sensor';
  // Lights / LEDs
  if (c === 'lighting' || s === 'led_lighting' || n.includes('light') ||
      n.includes('headlight') || n.includes('marker') || n.includes('lamp')) return 'light';
  // Speakers / Audio
  if (c === 'audio' || n.includes('speaker') || n.includes('subwoofer') ||
      n.includes('amplifier') || n.includes('radio')) return 'speaker';
  // Camera
  if (n.includes('camera')) return 'camera';
  // Solenoids (injectors, coils)
  if (n.includes('injector')) return 'solenoid';
  if (n.includes('ignition coil') || n.includes('coil')) return 'solenoid';
  // Resistor (blower resistor, etc.)
  if (n.includes('resistor')) return 'resistor';
  // Connectors (CAN, USB, outlets)
  if (n.includes('can bus') || n.includes('usb') || n.includes('outlet') ||
      n.includes('cigarette') || s === 'power_outlet') return 'connector';
  // Battery disconnect
  if (n.includes('disconnect')) return 'switch';
  // AMP steps, parking brake, etc.
  if (n.includes('amp research') || n.includes('parking brake') || n.includes('e-stopp')) return 'ecu';

  return 'generic';
}

// ── Symbol Renderers (IEEE/IEC standard shapes) ────────────────────────
function SchematicSymbol({ type, size, selected }: { type: SymbolType; size: number; selected: boolean }) {
  const s = size;
  const stroke = selected ? 'var(--text, #2a2a2a)' : '#999';
  const sw = selected ? 2 : 1.5;
  const fill = 'none';

  switch (type) {
    case 'motor':
      // Circle with M — standard motor symbol
      return <g>
        <circle cx={0} cy={0} r={s} fill={fill} stroke={stroke} strokeWidth={sw} />
        <text x={0} y={1} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: s * 0.9, fontWeight: 700, fill: stroke, fontFamily: 'Arial' }}>M</text>
      </g>;

    case 'relay':
      // Rectangle with coil symbol (diagonal line)
      return <g>
        <rect x={-s} y={-s * 0.7} width={s * 2} height={s * 1.4} fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.5} y1={s * 0.4} x2={s * 0.5} y2={-s * 0.4} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'switch':
      // Open contact arm — line with angled break
      return <g>
        <circle cx={-s * 0.7} cy={0} r={2} fill={stroke} />
        <line x1={-s * 0.7} y1={0} x2={s * 0.5} y2={-s * 0.6} stroke={stroke} strokeWidth={sw} />
        <circle cx={s * 0.7} cy={0} r={2} fill={stroke} />
      </g>;

    case 'fuse':
      // Rectangle with S-curve through center
      return <g>
        <rect x={-s} y={-s * 0.4} width={s * 2} height={s * 0.8} fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.6} y1={0} x2={s * 0.6} y2={0} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'sensor':
      // Diamond — standard sensor/transducer symbol
      return <g>
        <polygon points={`0,${-s} ${s},0 0,${s} ${-s},0`} fill={fill} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'temp_sensor':
      // Diamond with T
      return <g>
        <polygon points={`0,${-s} ${s},0 0,${s} ${-s},0`} fill={fill} stroke={stroke} strokeWidth={sw} />
        <text x={0} y={1} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: s * 0.7, fontWeight: 700, fill: stroke, fontFamily: 'Arial' }}>T</text>
      </g>;

    case 'pressure_sensor':
      // Diamond with P
      return <g>
        <polygon points={`0,${-s} ${s},0 0,${s} ${-s},0`} fill={fill} stroke={stroke} strokeWidth={sw} />
        <text x={0} y={1} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: s * 0.7, fontWeight: 700, fill: stroke, fontFamily: 'Arial' }}>P</text>
      </g>;

    case 'light':
      // Circle with X (rays) — standard lamp symbol
      return <g>
        <circle cx={0} cy={0} r={s * 0.8} fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.5} y1={-s * 0.5} x2={s * 0.5} y2={s * 0.5} stroke={stroke} strokeWidth={1} />
        <line x1={s * 0.5} y1={-s * 0.5} x2={-s * 0.5} y2={s * 0.5} stroke={stroke} strokeWidth={1} />
      </g>;

    case 'ground':
      // Three descending horizontal lines — standard ground
      return <g>
        <line x1={0} y1={-s * 0.5} x2={0} y2={-s * 0.1} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.7} y1={-s * 0.1} x2={s * 0.7} y2={-s * 0.1} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.45} y1={s * 0.2} x2={s * 0.45} y2={s * 0.2} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.2} y1={s * 0.5} x2={s * 0.2} y2={s * 0.5} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'battery':
      // Long/short parallel lines — standard battery
      return <g>
        <line x1={-s * 0.6} y1={-s * 0.3} x2={s * 0.6} y2={-s * 0.3} stroke={stroke} strokeWidth={sw * 1.5} />
        <line x1={-s * 0.35} y1={s * 0.3} x2={s * 0.35} y2={s * 0.3} stroke={stroke} strokeWidth={sw} />
        <text x={s * 0.8} y={-s * 0.3} style={{ fontSize: 6, fill: stroke, fontFamily: 'Arial' }}>+</text>
      </g>;

    case 'ecu':
    case 'pdm':
      // Rectangle with label — standard controller/module symbol
      return <g>
        <rect x={-s * 1.2} y={-s * 0.7} width={s * 2.4} height={s * 1.4} fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 1.2} y1={-s * 0.3} x2={s * 1.2} y2={-s * 0.3} stroke={stroke} strokeWidth={0.5} />
      </g>;

    case 'speaker':
      // Trapezoid — standard speaker symbol
      return <g>
        <polygon points={`${-s * 0.4},${-s * 0.5} ${s * 0.4},${-s * 0.8} ${s * 0.4},${s * 0.8} ${-s * 0.4},${s * 0.5}`}
          fill={fill} stroke={stroke} strokeWidth={sw} />
        <rect x={-s * 0.7} y={-s * 0.5} width={s * 0.3} height={s * 1} fill={fill} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'solenoid':
      // Rectangle with wavy line — coil/solenoid/injector
      return <g>
        <rect x={-s * 0.8} y={-s * 0.6} width={s * 1.6} height={s * 1.2} fill={fill} stroke={stroke} strokeWidth={sw} />
        <path d={`M ${-s * 0.4},0 Q ${-s * 0.2},${-s * 0.3} 0,0 Q ${s * 0.2},${s * 0.3} ${s * 0.4},0`}
          fill="none" stroke={stroke} strokeWidth={1} />
      </g>;

    case 'resistor':
      // Zigzag — standard resistor
      return <g>
        <path d={`M ${-s},0 L ${-s * 0.6},${-s * 0.4} L ${-s * 0.2},${s * 0.4} L ${s * 0.2},${-s * 0.4} L ${s * 0.6},${s * 0.4} L ${s},0`}
          fill="none" stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'connector':
      // Half circle — standard connector symbol
      return <g>
        <path d={`M 0,${-s * 0.6} A ${s * 0.6},${s * 0.6} 0 0,1 0,${s * 0.6}`}
          fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={0} y1={-s * 0.6} x2={0} y2={s * 0.6} stroke={stroke} strokeWidth={sw} />
      </g>;

    case 'camera':
      // Rectangle with lens circle
      return <g>
        <rect x={-s} y={-s * 0.6} width={s * 2} height={s * 1.2} fill={fill} stroke={stroke} strokeWidth={sw} />
        <circle cx={0} cy={0} r={s * 0.35} fill={fill} stroke={stroke} strokeWidth={1} />
      </g>;

    case 'display':
      // Rectangle with screen lines
      return <g>
        <rect x={-s * 1.2} y={-s * 0.7} width={s * 2.4} height={s * 1.4} fill={fill} stroke={stroke} strokeWidth={sw} />
        <line x1={-s * 0.8} y1={-s * 0.2} x2={s * 0.8} y2={-s * 0.2} stroke={stroke} strokeWidth={0.5} />
        <line x1={-s * 0.8} y1={s * 0.1} x2={s * 0.5} y2={s * 0.1} stroke={stroke} strokeWidth={0.5} />
        <line x1={-s * 0.8} y1={s * 0.4} x2={s * 0.3} y2={s * 0.4} stroke={stroke} strokeWidth={0.5} />
      </g>;

    default:
      // Simple circle — generic component
      return <circle cx={0} cy={0} r={s * 0.7} fill={fill} stroke={stroke} strokeWidth={sw} />;
  }
}

// ── Zoom Detail Tiers ──────────────────────────────────────────────────
// <0.3: dots only | 0.3-0.8: symbols no text | 0.8-1.5: symbols+name | >1.5: full detail
type ZoomTier = 'dot' | 'symbol' | 'named' | 'full';
function getZoomTier(zoom: number): ZoomTier {
  if (zoom < 0.3) return 'dot';
  if (zoom < 0.8) return 'symbol';
  if (zoom < 1.5) return 'named';
  return 'full';
}

// ── Props ──────────────────────────────────────────────────────────────
interface Props {
  device: ManifestDevice;
  wire?: WireSpec;
  isSelected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  canvasZoom: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, xPct: number, yPct: number) => void;
}

export { SYMBOL_SIZE as NODE_RADIUS };

export function WiringDeviceNode({
  device, wire, isSelected, canvasWidth, canvasHeight, canvasZoom,
  onSelect, onDragEnd,
}: Props) {
  const dragRef = useRef<{
    startX: number; startY: number;
    startPctX: number; startPctY: number;
    dragging: boolean;
  } | null>(null);

  const x = (device.pos_x_pct || 50) / 100 * canvasWidth;
  const y = (device.pos_y_pct || 50) / 100 * canvasHeight;

  const symbolType = classifySymbol(device);
  const tier = getZoomTier(canvasZoom);

  // Truncate label for canvas display
  const label = device.device_name.length > 22
    ? device.device_name.slice(0, 20) + '..'
    : device.device_name;

  // Full detail line (P/N + amps) for high zoom
  const detailLine = tier === 'full'
    ? [
        device.part_number,
        device.power_draw_amps ? `${device.power_draw_amps}A` : null,
      ].filter(Boolean).join(' · ')
    : '';

  // ── Drag Handlers ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(device.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPctX: device.pos_x_pct || 50,
      startPctY: device.pos_y_pct || 50,
      dragging: false,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [device.id, device.pos_x_pct, device.pos_y_pct, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / canvasZoom;
    const dy = (e.clientY - dragRef.current.startY) / canvasZoom;
    const dxPct = (dx / canvasWidth) * 100;
    const dyPct = (dy / canvasHeight) * 100;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.dragging = true;
    if (dragRef.current.dragging) {
      const newX = Math.max(0, Math.min(100, dragRef.current.startPctX + dxPct));
      const newY = Math.max(0, Math.min(100, dragRef.current.startPctY + dyPct));
      onDragEnd(device.id, newX, newY);
    }
  }, [device.id, canvasZoom, canvasWidth, canvasHeight, onDragEnd]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: 'pointer' }}
      data-device={device.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Selection highlight */}
      {isSelected && tier !== 'dot' && (
        <rect x={-SYMBOL_SIZE - 4} y={-SYMBOL_SIZE - 4}
          width={(SYMBOL_SIZE + 4) * 2} height={(SYMBOL_SIZE + 4) * 2 + 14}
          fill="none" stroke="var(--text, #2a2a2a)" strokeWidth={1} strokeDasharray="3 2" />
      )}

      {/* Dot tier: just a colored dot */}
      {tier === 'dot' && (
        <circle cx={0} cy={0} r={3}
          fill={isSelected ? 'var(--text, #2a2a2a)' : 'var(--text-secondary, #666)'}
        />
      )}

      {/* Symbol tier and above: schematic symbol */}
      {tier !== 'dot' && (
        <SchematicSymbol type={symbolType} size={SYMBOL_SIZE} selected={isSelected} />
      )}

      {/* Named tier (or selected): device name label */}
      {(tier === 'named' || tier === 'full' || isSelected) && tier !== 'dot' && (
        <text
          x={0} y={SYMBOL_SIZE + 10}
          textAnchor="middle"
          style={{
            fontSize: '7px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 400,
            fill: isSelected ? 'var(--text, #2a2a2a)' : 'var(--text-secondary, #666)',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          {label}
        </text>
      )}

      {/* Full tier: P/N + amps detail line */}
      {tier === 'full' && detailLine && (
        <text
          x={0} y={SYMBOL_SIZE + 19}
          textAnchor="middle"
          style={{
            fontSize: '5px',
            fontFamily: '"Courier New", monospace',
            fontWeight: 400,
            fill: 'var(--text-secondary, #666)',
            userSelect: 'none',
            pointerEvents: 'none',
            opacity: 0.7,
          }}
        >
          {detailLine}
        </text>
      )}

      {/* Native tooltip */}
      <title>
        {device.device_name}
        {device.manufacturer ? `\n${device.manufacturer} ${device.model_number || ''}` : ''}
        {(device.power_draw_amps || 0) > 0 ? `\n${device.power_draw_amps}A` : ''}
        {device.location_zone ? `\n${device.location_zone.replace(/_/g, ' ')}` : ''}
      </title>
    </g>
  );
}
